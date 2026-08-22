import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { TiptapTransformer } from '@hocuspocus/transformer'
import pg from 'pg'
import { createId } from '@paralleldrive/cuid2'
import http from 'http'
import crypto from 'crypto'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Auth: verify the same HS256 JWT the backend issues (@fastify/jwt), WITHOUT a
// jsonwebtoken dependency — a real-time service should stay lean. The collab WS
// is exposed to the internet via nginx (/collab), so every document open MUST
// prove who the user is and that they may touch this page — otherwise anyone who
// learns a page id can read+write its live Yjs doc across tenants.
const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET) {
  console.error('[collab] FATAL: JWT_SECRET is not set — every collab connection will be rejected.')
}

function verifyJwt(token) {
  if (!token || typeof token !== 'string' || !JWT_SECRET) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
    if (header.alg !== 'HS256') return null // block alg-confusion ("none" etc.)
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest()
    const got = Buffer.from(s, 'base64url')
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    if (payload.exp && Date.now() / 1000 > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

// May this user open this page? Access = member of the page's workspace OR of the
// specific project it lives in (projects can be shared independently). Mirrors the
// backend's access model (Workspace has no owner column — membership is the truth).
async function userMayAccessPage(pageId, userId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM pages p
       JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = $1 AND p.is_deleted = false
        AND (
          EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = pr.workspace_id AND wm.user_id = $2)
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pr.id AND pm.user_id = $2)
        )
      LIMIT 1`,
    [pageId, userId]
  )
  return rows.length > 0
}

// Страховка: для realtime-сервиса доступность важнее fail-fast. Одна ошибка в
// хуке (как было с onDisconnect) не должна ронять процесс и отдавать 502 всем —
// логируем и продолжаем жить. Настоящие баги всё равно видны в логе.
process.on('unhandledRejection', (e) => console.error('[collab] unhandledRejection:', e))
process.on('uncaughtException', (e) => console.error('[collab] uncaughtException:', e))
const MAX_VERSIONS = 50
// Save a version snapshot every 5 minutes of activity
const VERSION_INTERVAL_MS = 5 * 60 * 1000

// Track pending version saves: pageId → { timer, content, title }
const versionTimers = new Map()

async function saveVersion(pageId, title, content) {
  try {
    const { rows: [latest] } = await pool.query(
      'SELECT content FROM page_versions WHERE page_id = $1 ORDER BY version DESC LIMIT 1',
      [pageId]
    )
    // Skip if content unchanged
    const newStr = JSON.stringify(content)
    if (latest && JSON.stringify(latest.content) === newStr) return

    const { rows: [{ max }] } = await pool.query(
      'SELECT COALESCE(MAX(version), 0) as max FROM page_versions WHERE page_id = $1',
      [pageId]
    )

    const { rows: [page] } = await pool.query(
      'SELECT title FROM pages WHERE id = $1 LIMIT 1',
      [pageId]
    )
    const versionTitle = title || page?.title || 'Без названия'

    await pool.query(
      `INSERT INTO page_versions (id, page_id, title, content, version, saved_by, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'collab', NOW())`,
      [createId(), pageId, versionTitle, JSON.stringify(content), Number(max) + 1]
    )

    // Prune old versions
    const { rows: old } = await pool.query(
      `SELECT id FROM page_versions WHERE page_id = $1 ORDER BY version DESC OFFSET $2`,
      [pageId, MAX_VERSIONS]
    )
    if (old.length > 0) {
      await pool.query(
        'DELETE FROM page_versions WHERE id = ANY($1)',
        [old.map((r) => r.id)]
      )
    }
  } catch (e) {
    console.error('[collab] saveVersion failed:', e.message)
  }
}

function scheduleVersion(pageId, content) {
  const existing = versionTimers.get(pageId)
  if (existing) {
    // Update content but keep the timer
    existing.content = content
    return
  }
  const entry = { content, timer: null }
  entry.timer = setTimeout(() => {
    versionTimers.delete(pageId)
    saveVersion(pageId, null, entry.content)
  }, VERSION_INTERVAL_MS)
  versionTimers.set(pageId, entry)
}

const server = new Server({
  port: parseInt(process.env.PORT ?? '3012', 10),
  quiet: false,

  async onAuthenticate({ documentName, token }) {
    // 1) Who are you? A valid, unexpired JWT signed by our backend.
    const payload = verifyJwt(token)
    if (!payload?.id) throw new Error('Unauthorized: valid token required')
    // 2) May you touch THIS page? Membership of its workspace or project.
    if (!(await userMayAccessPage(documentName, payload.id))) {
      throw new Error('Forbidden: no access to this page')
    }
    // Hand context to later hooks (e.g. attribution) if ever needed.
    return { user: { id: payload.id, name: payload.name } }
  },

  async onDisconnect({ documentName, document: ydoc, clientsCount }) {
    // Присутствие берётся живьём из Yjs awareness (см. HTTP API ниже), отдельная
    // presence-мапа была мёртвым кодом — и её очистка через connection.readyState
    // роняла ВЕСЬ процесс на каждом отключении (connection здесь undefined в
    // Hocuspocus v4), из-за чего сервил уходил в петлю рестарта и отдавал 502.
    if (clientsCount > 0) return
    // Last client disconnected — save version immediately
    try {
      const content = TiptapTransformer.fromYdoc(ydoc, 'default')
      // Cancel pending timer — save immediately
      const existing = versionTimers.get(documentName)
      if (existing) {
        clearTimeout(existing.timer)
        versionTimers.delete(documentName)
      }
      await saveVersion(documentName, null, content)
    } catch (e) {
      console.error('[collab] onDisconnect version save failed:', e.message)
    }
  },

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const { rows } = await pool.query(
          'SELECT yjs_state FROM pages WHERE id = $1 AND is_deleted = false LIMIT 1',
          [documentName]
        )
        const row = rows[0]
        if (!row) return null
        // Return the stored Yjs state if present. For a page that has never been
        // collab-edited we return null (empty doc) — the FIRST client seeds it
        // from page.content with the full editor schema (server-side toYdoc would
        // need the whole TipTap extension set and drop custom nodes).
        if (row.yjs_state) return new Uint8Array(row.yjs_state)
        return null
      },

      store: async ({ documentName, state, document: ydoc }) => {
        const yjsState = Buffer.from(state)
        let content = null
        try {
          content = TiptapTransformer.fromYdoc(ydoc, 'default')
        } catch (e) {
          console.error('[collab] fromYdoc failed:', e.message)
        }

        if (content) {
          await pool.query(
            'UPDATE pages SET yjs_state = $1, content = $2::jsonb, updated_at = NOW() WHERE id = $3',
            [yjsState, JSON.stringify(content), documentName]
          )
          scheduleVersion(documentName, content)
        } else {
          await pool.query(
            'UPDATE pages SET yjs_state = $1, updated_at = NOW() WHERE id = $2',
            [yjsState, documentName]
          )
        }
      },
    }),
  ],
})

server.listen()
  .then(() => console.log(`[collab] Hocuspocus listening on port ${process.env.PORT ?? 3012}`))
  .catch((e) => { console.error('[collab] Failed to start:', e); process.exit(1) })

// ── Presence HTTP API ─────────────────────────────────────────────────────────
// GET /presence → { pageId: [{ name, color }] }
const httpServer = http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/presence') {
    res.writeHead(404); res.end(); return
  }

  const presence = {}
  try {
    // Read awareness states from all active Hocuspocus documents
    const docs = server.documents
    if (docs && typeof docs[Symbol.iterator] === 'function') {
      for (const [docName, doc] of docs) {
        const users = []
        if (doc.awareness) {
          for (const [, state] of doc.awareness.getStates()) {
            if (state.user) users.push(state.user)
          }
        }
        if (users.length > 0) presence[docName] = users
      }
    }
  } catch (e) {
    console.error('[collab] presence read error:', e.message)
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(presence))
})

httpServer.listen(3013, '0.0.0.0', () => console.log('[collab] Presence API on port 3013'))

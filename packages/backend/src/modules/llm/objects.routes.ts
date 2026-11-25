// ─── Objects published from SinoutX Code ──────────────────────────────────────
// An «object» is what the agent made on the user's computer: a picture, a
// document, a table, a 3D model, a site, a bundle of files. One button in the
// window turns it into a page in the SinoutX project named like the code
// project — created on first publish, updated in place on the next one.
//
//   POST /code/objects/publish          — create or update the page
//   POST /code/objects/:pageId/share    — public link on/off
//
// Files become ordinary attachments of the page. They are served from the app's
// own origin (/uploads/…), so anything a browser would EXECUTE there — HTML, SVG,
// scripts — is stored as a download, never as a live document: a published site
// must not be able to read the owner's session.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config/index.js'
import { uploadFile, deleteFile, getPublicUrl } from '../../lib/storage.js'
import { canUploadFile } from '../../lib/plans.js'
import { textToTipTap } from '../ai/ai.service.js'

const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_FILES = 200
/** Above this a document or table is linked, not poured into the page. */
const MAX_INLINE_TEXT = 200 * 1024
const MAX_TABLE_ROWS = 200
const MAX_TABLE_COLS = 20

/** Served as themselves; everything else goes out as a download. */
const SAFE_INLINE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json',
  'model/stl', 'model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/3mf',
  'application/zip', 'application/octet-stream',
])
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

const fileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  mime: z.string().trim().min(1).max(200),
  base64: z.string(),
})

const publishSchema = z.object({
  project: z.string().trim().min(1).max(200),
  objectId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  type: z.enum(['image', 'model3d', 'page', 'document', 'data', 'files']),
  entry: z.string().trim().max(500).optional(),
  files: z.array(fileSchema).max(MAX_FILES),
  preview: z.object({ mime: z.literal('image/png'), base64: z.string() }).optional(),
  pageId: z.string().trim().max(100).optional(),
})

const shareSchema = z.object({ on: z.boolean() })

const fail = (reply: FastifyReply, status: number, message: string) => reply.status(status).send({ error: { message } })

/** The workspace the key works in: its own scope, else the owner's first. */
async function workspaceOf(prisma: PrismaClient, req: FastifyRequest): Promise<string | null> {
  const scoped = req.authWorkspaceScope?.[0]
  if (scoped) return scoped
  const m = await prisma.workspaceMember.findFirst({
    where: { userId: req.authUser!.id }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true },
  })
  return m?.workspaceId ?? null
}

/** Where the app lives, for links handed back to the window. */
function appBase(req: FastifyRequest): string {
  if (config.APP_URL) return config.APP_URL.replace(/\/$/, '')
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
  return `${proto}://${host}`
}

function decode(b64: string): Buffer | null {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (clean && !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null
  return Buffer.from(clean, 'base64')
}

/** A name that is safe as the last segment of a storage key and a URL. ASCII
 *  only: nginx hands the DECODED path on to MinIO, and a raw non-ASCII byte or a
 *  space there breaks the request. The page still shows the original path. */
function safeName(path: string): string {
  const base = path.split(/[\\/]/).pop() || 'file'
  const ascii = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_')
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? ascii(base.slice(dot)).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12) : ''
  const stem = ascii(dot > 0 ? base.slice(0, dot) : base).replace(/^[._-]+|[._-]+$/g, '').slice(0, 100)
  return `${/[A-Za-z0-9]/.test(stem) ? stem : 'file'}${ext.length > 1 ? ext : ''}`
}

/** Markdown-safe text for a table cell or a link label. */
const cell = (s: string) => s.replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim()
const label = (s: string) => s.replace(/[[\]]/g, '')

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []; let field = ''; let quoted = false
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

function markdownTable(rows: string[][]): string | null {
  if (rows.length < 2 || rows.length > MAX_TABLE_ROWS + 1) return null
  const width = Math.max(...rows.map((r) => r.length))
  if (width < 1 || width > MAX_TABLE_COLS) return null
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '') || ' ').join(' | ')} |`
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
}

/** A small JSON array of flat objects reads best as a table. */
function jsonTable(text: string): string | null {
  let data: unknown
  try { data = JSON.parse(text) } catch { return null }
  if (!Array.isArray(data) || !data.length || !data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null
  const keys = [...new Set(data.flatMap((r) => Object.keys(r as object)))]
  const value = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return markdownTable([keys, ...data.map((r) => keys.map((k) => value((r as Record<string, unknown>)[k])))])
}

interface Stored { path: string; name: string; mime: string; key: string; url: string; size: number; buf: Buffer }

export async function codeObjectRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/code/objects/publish', { bodyLimit: 72 * 1024 * 1024 }, async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…) в Authorization: Bearer или x-api-key.')

    const parsed = publishSchema.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'files' && issue.code === 'too_big') return fail(reply, 413, `Слишком много файлов: не больше ${MAX_FILES}.`)
      return fail(reply, 400, `Неверный запрос: ${issue?.path.join('.')} ${issue?.message}`)
    }
    const body = parsed.data
    if (!body.files.length && !body.preview && !body.description) return fail(reply, 400, 'Неверный запрос: нечего публиковать — нет ни файлов, ни описания.')

    // ── Decode and size everything before touching the database ──
    const decoded: { path: string; mime: string; buf: Buffer }[] = []
    for (const f of body.files) {
      const buf = decode(f.base64)
      if (!buf) return fail(reply, 400, `Неверный запрос: файл ${f.path} не в base64.`)
      decoded.push({ path: f.path.replace(/\\/g, '/'), mime: f.mime.toLowerCase(), buf })
    }
    const previewBuf = body.preview ? decode(body.preview.base64) : null
    if (body.preview && !previewBuf) return fail(reply, 400, 'Неверный запрос: preview не в base64.')
    const total = decoded.reduce((s, f) => s + f.buf.byteLength, 0) + (previewBuf?.byteLength ?? 0)
    if (total > MAX_TOTAL_BYTES) return fail(reply, 413, `Объект больше 50 МБ (${Math.ceil(total / 1024 / 1024)} МБ): опубликуйте его частями или без крупных файлов.`)

    const ws = await workspaceOf(prisma, req)
    if (!ws) return fail(reply, 400, 'У владельца ключа нет пространства SinoutX.')

    // ── The page to update, if it still exists and is his ──
    let page = body.pageId
      ? await prisma.page.findFirst({
          where: { id: body.pageId, isDeleted: false, project: { workspaceId: ws } },
          select: { id: true, projectId: true, isPublic: true, publicToken: true },
        })
      : null

    const old = page
      ? await prisma.attachment.findMany({ where: { pageId: page.id }, select: { id: true, storagePath: true, size: true } })
      : []
    const oldBytes = old.reduce((s, a) => s + a.size, 0)
    const quota = await canUploadFile(prisma, ws, Math.max(0, total - oldBytes))
    if (!quota.ok) {
      return fail(reply, 402, `Не хватает места в SinoutX: занято ${quota.usedMb} из ${quota.limitMb} МБ. Освободите место или расширьте тариф.`)
    }

    // ── The project named like the code project (created on first publish) ──
    let projectId = page?.projectId
    if (!projectId) {
      const norm = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').trim()
      const want = norm(body.project)
      const existing = (await prisma.project.findMany({
        where: { workspaceId: ws, status: { not: 'ARCHIVED' }, isModule: false },
        select: { id: true, name: true }, orderBy: { createdAt: 'asc' },
      })).find((p) => norm(p.name) === want)
      if (existing) projectId = existing.id
      else {
        const last = await prisma.project.findFirst({ where: { workspaceId: ws }, orderBy: { position: 'desc' }, select: { position: true } })
        projectId = (await prisma.project.create({
          data: {
            workspaceId: ws, name: body.project, icon: 'lucide:Code',
            description: 'Объекты, опубликованные из SinoutX Code', position: (last?.position ?? -1) + 1,
          },
          select: { id: true },
        })).id
      }
    }

    // ── Store the files ──
    const stored: Stored[] = []
    const keys: string[] = []
    const store = async (path: string, mime: string, buf: Buffer): Promise<Stored> => {
      const name = safeName(path)
      const served = SAFE_INLINE.has(mime) ? mime : 'application/octet-stream'
      const key = `${ws}/${randomUUID()}/${name}`
      await uploadFile(key, buf, served, buf.byteLength)
      keys.push(key)
      // Encoded down to the parentheses: the URL ends up inside Markdown `(…)`.
      const url = getPublicUrl(key).split('/')
        .map((s, i) => (i < 2 ? s : encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)))
        .join('/')
      return { path, name, mime: served, key, url, size: buf.byteLength, buf }
    }
    let previewFile: Stored | null = null
    try {
      for (const f of decoded) stored.push(await store(f.path, f.mime, f.buf))
      if (previewBuf) previewFile = await store('preview.png', 'image/png', previewBuf)
    } catch (e) {
      await Promise.all(keys.map((k) => deleteFile(k).catch(() => null)))
      req.log.error({ err: e instanceof Error ? e.message : String(e) }, '[code/objects] storage failed')
      return fail(reply, 502, 'Не удалось сохранить файлы в хранилище SinoutX.')
    }

    // ── Page content ──
    const md: string[] = []
    if (body.description?.trim()) md.push(body.description.trim())
    const entry = (body.entry && stored.find((f) => f.path === body.entry || f.path.endsWith(`/${body.entry}`))) || null
    const text = (f: Stored) => f.buf.toString('utf8')
    let inlined: Stored | null = null

    if (body.type === 'image') {
      const images = stored.filter((f) => INLINE_IMAGE.has(f.mime))
      for (const f of images) md.push(`![${label(f.name)}](${f.url})`)
      if (!images.length && previewFile) md.push(`![${label(body.title)}](${previewFile.url})`)
    } else if (body.type === 'document') {
      const doc = entry ?? stored.find((f) => /\.(md|markdown|txt)$/i.test(f.name)) ?? null
      if (doc && /\.(md|markdown|txt)$/i.test(doc.name) && doc.size <= MAX_INLINE_TEXT) {
        md.push(text(doc).replace(/^﻿/, '').replace(/\r\n/g, '\n'))
        inlined = doc
      }
      for (const f of stored.filter((x) => INLINE_IMAGE.has(x.mime))) md.push(`![${label(f.name)}](${f.url})`)
    } else if (body.type === 'data') {
      const data = entry ?? stored.find((f) => /\.(csv|json)$/i.test(f.name)) ?? null
      if (data && data.size <= MAX_INLINE_TEXT) {
        const table = /\.json$/i.test(data.name) ? jsonTable(text(data)) : /\.csv$/i.test(data.name) ? markdownTable(csvRows(text(data).replace(/^﻿/, ''))) : null
        if (table) md.push(table)
      }
    } else if (previewFile) {
      md.push(`![${label(body.title)}](${previewFile.url})`)
    }

    // Every file stays downloadable — except a document already shown in full.
    const links = stored.filter((f) => f !== inlined && !(body.type === 'image' && INLINE_IMAGE.has(f.mime)))
    if (links.length) {
      md.push('## Файлы')
      md.push(links.map((f) => `- [${label(f.path)}](${f.url}) — ${f.size < 1024 * 1024 ? `${Math.max(1, Math.round(f.size / 1024))} КБ` : `${(f.size / 1024 / 1024).toFixed(1)} МБ`}`).join('\n'))
    }
    md.push('---')
    md.push(`_Опубликовано из SinoutX Code · ${body.project.replace(/[_*`]/g, ' ')}_`)
    const content = textToTipTap(md.join('\n\n'))

    // ── Create or update the page, then swap the attachments ──
    try {
      if (page) {
        await prisma.page.update({
          where: { id: page.id },
          // The editor loads Yjs, not `content`: drop the stale state or the
          // republished page would open with the old text.
          data: { title: body.title, content, yjsState: null },
        })
      } else {
        const last = await prisma.page.findFirst({
          where: { projectId, parentPageId: null }, orderBy: { position: 'desc' }, select: { position: true },
        })
        page = await prisma.page.create({
          data: { projectId, title: body.title, icon: 'lucide:Package', content, position: (last?.position ?? -1) + 1 },
          select: { id: true, projectId: true, isPublic: true, publicToken: true },
        })
      }
      const pageId = page.id
      await prisma.attachment.createMany({
        data: [...stored, ...(previewFile ? [previewFile] : [])].map((f) => ({
          workspaceId: ws, projectId, pageId,
          filename: f.name, description: f === previewFile ? 'Превью объекта SinoutX Code' : f.path,
          mimeType: f.mime, size: f.size, storagePath: f.key,
          metadata: { source: 'sinoutx-code', objectId: body.objectId, type: body.type, path: f.path },
        })),
      })
    } catch (e) {
      await Promise.all(keys.map((k) => deleteFile(k).catch(() => null)))
      throw e
    }
    if (old.length) {
      await prisma.attachment.deleteMany({ where: { id: { in: old.map((a) => a.id) } } })
      await Promise.all(old.map((a) => deleteFile(a.storagePath).catch(() => null)))
    }

    const base = appBase(req)
    return reply.send({
      pageId: page.id,
      projectId,
      url: `${base}/pages/${page.id}`,
      isPublic: page.isPublic,
      ...(page.isPublic && page.publicToken ? { publicUrl: `${base}/p/${page.publicToken}` } : {}),
    })
  })

  app.post<{ Params: { pageId: string } }>('/code/objects/:pageId/share', async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…) в Authorization: Bearer или x-api-key.')
    const parsed = shareSchema.safeParse(req.body)
    if (!parsed.success) return fail(reply, 400, 'Неверный запрос: нужно { "on": true | false }.')

    const ws = await workspaceOf(prisma, req)
    const page = ws
      ? await prisma.page.findFirst({
          where: { id: req.params.pageId, isDeleted: false, project: { workspaceId: ws } },
          select: { id: true, isPublic: true, publicToken: true },
        })
      : null
    if (!page) return fail(reply, 404, 'Страница не найдена.')

    let token = page.publicToken
    if (parsed.data.on && !(page.isPublic && token)) {
      token = randomBytes(16).toString('hex')
      await prisma.page.update({ where: { id: page.id }, data: { isPublic: true, publicToken: token } })
    } else if (!parsed.data.on && page.isPublic) {
      token = null
      await prisma.page.update({ where: { id: page.id }, data: { isPublic: false, publicToken: null } })
    }
    return reply.send(parsed.data.on ? { isPublic: true, publicUrl: `${appBase(req)}/p/${token}` } : { isPublic: false })
  })
}

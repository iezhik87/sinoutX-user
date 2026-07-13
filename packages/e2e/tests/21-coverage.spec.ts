import { test, expect, type Page } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

// Extra coverage for fixes/areas from QA-CHECKLIST. Self-cleaning where data is
// created. Run against any BASE_URL (server or local).

// 1x1 transparent PNG
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function apiCall(
  page: Page, method: string, path: string, body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
      const r = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      let data: unknown = null
      try { data = await r.json() } catch { /* none */ }
      return { ok: r.ok, status: r.status, data }
    },
    { method, path, body },
  )
}

function getWorkspaceId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('sinoutx-workspace')
      return raw ? (JSON.parse(raw)?.state?.currentWorkspaceId ?? null) : null
    } catch { return null }
  })
}

// ── SEC-04: guarded API rejects requests without a token ──────────────────────
test('SEC-04 — /api/v1 без токена возвращает 401', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const status = await page.evaluate(async (w) => {
    const r = await fetch(`/api/v1/workspaces/${w}/projects`) // no Authorization
    return r.status
  }, wid)
  expect(status).toBe(401)
})

// ── PG-08: attachment image embed is rendered with an auth token in src ───────
test('PG-08 — встроенная картинка-вложение рендерится с токеном (не 401)', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto('/')
  await page.waitForTimeout(800)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  // Upload a tiny PNG attachment
  const attId = await page.evaluate(
    async ({ wid, pid, b64 }) => {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const fd = new FormData()
      fd.append('file', new Blob([arr], { type: 'image/png' }), 'e2e.png')
      const r = await fetch(`/api/v1/upload?workspaceId=${wid}&projectId=${pid}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      const d = await r.json()
      return d?.id ?? null
    },
    { wid, pid, b64: PNG_1x1 },
  )
  if (!attId) test.skip(true, 'Не удалось загрузить вложение')

  // Create a page that embeds the attachment as a BARE /content image URL
  const pageRes = await apiCall(page, 'POST', '/pages', { projectId: pid, title: 'E2E Embed' })
  const pageId = (pageRes.data as { id: string }).id
  try {
    await apiCall(page, 'PATCH', `/pages/${pageId}`, {
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'image', attrs: { src: `/api/v1/attachments/${attId}/content` } },
        ],
      },
    })

    await page.goto(`/pages/${pageId}`)
    await page.waitForTimeout(1500)
    await dismissMorningBrief(page)

    const img = page.locator(`img[src*="/attachments/${attId}/content"]`).first()
    await expect(img).toBeVisible({ timeout: 6000 })
    const src = await img.getAttribute('src')
    expect(src).toContain('token=') // tokenized at render time, not baked into the doc
  } finally {
    await apiCall(page, 'DELETE', `/pages/${pageId}`)
    await apiCall(page, 'DELETE', `/attachments/${attId}`)
  }
})

// ── PG-17: a shared page is reachable publicly without auth ───────────────────
test('PG-17 — публичная страница доступна без авторизации', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto('/')
  await page.waitForTimeout(800)

  const pageRes = await apiCall(page, 'POST', '/pages', { projectId: pid, title: 'E2E Public' })
  const pageId = (pageRes.data as { id: string }).id
  try {
    const share = await apiCall(page, 'POST', `/pages/${pageId}/share`)
    const token = (share.data as { publicToken?: string })?.publicToken
    expect(token, 'share должен вернуть publicToken').toBeTruthy()

    // Fetch the public endpoint WITHOUT an Authorization header
    const res = await page.evaluate(async (tok) => {
      const r = await fetch(`/api/v1/share/${tok}`)
      return { status: r.status, data: await r.json().catch(() => null) }
    }, token)
    expect(res.status).toBe(200)
    expect((res.data as { title?: string })?.title).toBe('E2E Public')
  } finally {
    await apiCall(page, 'DELETE', `/pages/${pageId}`)
  }
})

// ── PRJ-06: deleting a project prunes its dangling nodes from canvases ─────────
test('PRJ-06 — удаление проекта убирает его узлы с доски', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(800)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  // Fresh project + page (so the main data is untouched)
  const projRes = await apiCall(page, 'POST', '/projects', { workspaceId: wid, name: 'E2E Prune' })
  if (!projRes.ok) test.skip(true, `Не удалось создать проект (HTTP ${projRes.status})`)
  const projectId = (projRes.data as { id: string }).id
  const pageRes = await apiCall(page, 'POST', '/pages', { projectId, title: 'E2E Prune Page' })
  const pageId = (pageRes.data as { id: string }).id

  // Fresh canvas with a node referencing that page
  const cvRes = await apiCall(page, 'POST', '/canvas', { workspaceId: wid, name: 'E2E Prune Canvas' })
  const canvasId = (cvRes.data as { id: string }).id
  await apiCall(page, 'PATCH', `/canvas/${canvasId}`, {
    nodes: [{ id: 'node-e2e', type: 'page', position: { x: 100, y: 100 }, data: { entityId: pageId, title: 'E2E Prune Page' } }],
    edges: [],
  })

  try {
    // Sanity: node is there before delete
    const before = await apiCall(page, 'GET', `/canvas/${canvasId}`)
    expect((before.data as { nodes: unknown[] }).nodes.length).toBe(1)

    // Delete the project — backend prunes dangling canvas nodes
    await apiCall(page, 'DELETE', `/projects/${projectId}`)
    await page.waitForTimeout(500)

    const after = await apiCall(page, 'GET', `/canvas/${canvasId}`)
    const nodes = (after.data as { nodes: { data?: { entityId?: string } }[] }).nodes
    expect(nodes.some((n) => n.data?.entityId === pageId)).toBe(false)
  } finally {
    await apiCall(page, 'DELETE', `/canvas/${canvasId}`)
    // project (and its page) already deleted; ignore if cleanup races
    await apiCall(page, 'DELETE', `/projects/${projectId}`)
  }
})

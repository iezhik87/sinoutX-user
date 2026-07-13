import { test, expect, type Page } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

// Regressions fixed in the canvas / editor / PWA work. Maps to QA-CHECKLIST IDs.
// These create and then delete their own data, so they are safe to run against
// a shared/staging instance. (Against production use a dedicated test account.)

// ── Small REST helper (same auth pattern as auth.setup.ts) ────────────────────
async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
      const r = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      let data: unknown = null
      try { data = await r.json() } catch { /* no body */ }
      return { ok: r.ok, status: r.status, data }
    },
    { method, path, body },
  )
}

// ── SYS-01: no caching service worker pins the bundle ─────────────────────────
test('SYS-01 — приложение не регистрирует кэширующий service worker', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1500)
  await dismissMorningBrief(page)

  const regCount = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 0
    const regs = await navigator.serviceWorker.getRegistrations()
    return regs.length
  })
  expect(regCount).toBe(0)
})

// ── CV-04: deleting a canvas node persists across reload ──────────────────────
test('CV-04 — удалённый узел доски не возвращается после перезагрузки', async ({ page }) => {
  await page.goto('/canvas')
  await page.waitForTimeout(2500)
  await dismissMorningBrief(page)

  if (!/\/canvas\/[^/]+/.test(page.url())) {
    test.skip(true, 'Нет ни одной доски в фикстуре')
  }

  const nodes = page.locator('.react-flow__node')
  const baseline = await nodes.count()

  // Add a note node
  const addNoteBtn = page.getByRole('button', { name: /^(Заметка|Note|Нататка)$/ }).first()
  await expect(addNoteBtn).toBeVisible({ timeout: 5000 })
  await addNoteBtn.click()
  await expect(nodes).toHaveCount(baseline + 1, { timeout: 5000 })

  // Select the new node and delete it (Delete key — ReactFlow deleteKeyCode)
  const newNode = nodes.last()
  await newNode.click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Delete')
  await expect(nodes).toHaveCount(baseline, { timeout: 5000 })

  // saveNow persists immediately — give the PATCH a moment, then hard reload
  await page.waitForTimeout(2000)
  await page.reload()
  await page.waitForTimeout(2500)
  await dismissMorningBrief(page)

  // The deleted node must NOT reappear
  await expect(page.locator('.react-flow__node')).toHaveCount(baseline, { timeout: 6000 })
})

// ── PG-04: a folder renders as a folder, not a blank editor ───────────────────
test('PG-04 — папка показывается как папка, а не пустая страница', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  // Need an authenticated context to call the API
  await page.goto('/')
  await page.waitForTimeout(1000)

  // Create a folder + a child page inside it
  const folderRes = await apiCall(page, 'POST', '/pages', {
    projectId: pid, title: 'E2E Folder', type: 'FOLDER',
  })
  if (!folderRes.ok) test.skip(true, `Не удалось создать папку (HTTP ${folderRes.status})`)
  const folderId = (folderRes.data as { id: string }).id

  const childTitle = 'E2E Child Page'
  try {
    await apiCall(page, 'POST', '/pages', {
      projectId: pid, title: childTitle, parentPageId: folderId,
    })

    await page.goto(`/pages/${folderId}`)
    await page.waitForTimeout(1500)
    await dismissMorningBrief(page)

    // Folder label is shown (ru locale → "Папка")
    await expect(page.getByText(/^(Папка|Folder)$/).first()).toBeVisible({ timeout: 6000 })
    // The child page is listed as a clickable item
    await expect(page.getByText(childTitle).first()).toBeVisible({ timeout: 6000 })
    // It is NOT a document editor
    await expect(page.locator('.ProseMirror')).toHaveCount(0)
  } finally {
    // Cleanup (cascade removes the child)
    await apiCall(page, 'DELETE', `/pages/${folderId}`)
  }
})

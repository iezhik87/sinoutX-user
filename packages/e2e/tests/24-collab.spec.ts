import { test, expect } from '@playwright/test'
import path from 'path'
import { getFirstProjectId, apiCall } from './helpers'

const storageState = path.join(__dirname, '../playwright/.auth/user.json')

// COLLAB-01: real-time co-editing — text typed in one client appears in another.
// Opens the same page in two browser contexts (same account) and verifies the
// shared Yjs document syncs through the collab-server.
test('COLLAB-01 — правка в одном клиенте появляется в другом (realtime)', async ({ browser, page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto('/'); await page.waitForTimeout(500)
  const created = await apiCall(page, 'POST', '/pages', { projectId: pid, title: 'E2E Collab' })
  expect(created.ok, `create page (HTTP ${created.status})`).toBeTruthy()
  const pageId = (created.data as { id: string }).id

  const ctxA = await browser.newContext({ storageState })
  const ctxB = await browser.newContext({ storageState })
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  try {
    await a.goto(`/pages/${pageId}`)
    await b.goto(`/pages/${pageId}`)

    const edA = a.locator('.ProseMirror').first()
    const edB = b.locator('.ProseMirror').first()
    await expect(edA).toBeVisible({ timeout: 10_000 })
    await expect(edB).toBeVisible({ timeout: 10_000 })
    // Give both providers time to connect & sync the empty doc
    await a.waitForTimeout(2500)
    await b.waitForTimeout(2500)

    const marker = `COLLAB_${Date.now()}`
    await edA.click()
    await edA.pressSequentially(marker, { delay: 20 })

    // The marker must propagate to client B via the collab-server
    await expect(edB).toContainText(marker, { timeout: 12_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
    await apiCall(page, 'DELETE', `/pages/${pageId}`)
  }
})

import type { Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const fixturesFile = path.join(__dirname, '../playwright/.auth/fixtures.json')

export function getFirstProjectId(_page: Page): Promise<string | null> {
  // Read pre-fetched project ID from fixtures file written by auth.setup.ts
  try {
    const fixtures = JSON.parse(fs.readFileSync(fixturesFile, 'utf-8'))
    return Promise.resolve(fixtures?.firstProjectId ?? null)
  } catch {
    return Promise.resolve(null)
  }
}

// Authenticated REST call from inside the page (same JWT pattern as auth.setup).
// Content-Type is only set when a body is present (fastify rejects empty JSON).
export async function apiCall(
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

export function getWorkspaceId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('sinoutx-workspace')
      return raw ? (JSON.parse(raw)?.state?.currentWorkspaceId ?? null) : null
    } catch { return null }
  })
}

export async function dismissMorningBrief(page: Page) {
  // Brief is suppressed via localStorage in auth.setup.ts, so it rarely shows.
  // Wait briefly to let the page render.
  await page.waitForTimeout(1000)
  const closeBtn = page.locator('[class*="inset-0"][class*="z-50"] button[class*="btn-ghost"]').first()
  if (await closeBtn.isVisible({ timeout: 800 }).catch(() => false)) {
    await closeBtn.click()
    await page.waitForTimeout(300)
    return
  }
  const hasOverlay = await page.locator('div[class*="backdrop-blur"]').isVisible({ timeout: 300 }).catch(() => false)
  if (hasOverlay) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

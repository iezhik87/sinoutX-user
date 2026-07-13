import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const authFile = path.join(__dirname, '../playwright/.auth/user.json')
const fixturesFile = path.join(__dirname, '../playwright/.auth/fixtures.json')

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_EMAIL ?? 'test@sinout.local'
  const password = process.env.TEST_PASSWORD ?? 'password123'

  await page.goto('/login')
  await expect(page.locator('input[type="email"]')).toBeVisible()

  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')

  // Ждём редирект на главную
  await page.waitForURL('/', { timeout: 15_000 })
  await expect(page).not.toHaveURL('/login')

  // Wait for the app to fetch workspace list and persist it to localStorage
  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('sinoutx-workspace')
      if (!raw) return false
      const store = JSON.parse(raw)
      return !!store?.state?.currentWorkspaceId
    } catch { return false }
  }, undefined, { timeout: 10_000 })

  // Dismiss OnboardingModal for all tests: key is sinoutx-onboarded-{userId}
  await page.evaluate(() => {
    try {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const userId = authRaw ? JSON.parse(authRaw)?.state?.user?.id : null
      if (userId) localStorage.setItem(`sinoutx-onboarded-${userId}`, '1')
    } catch { /* ignore */ }
  })

  // Pre-fetch first project ID and save to fixtures file for all tests to use
  const wsRaw = await page.evaluate(() => localStorage.getItem('sinoutx-workspace'))
  const authRaw = await page.evaluate(() => localStorage.getItem('sinoutx-auth'))
  const workspaceId = wsRaw ? (JSON.parse(wsRaw)?.state?.currentWorkspaceId ?? null) : null
  const token = authRaw ? (JSON.parse(authRaw)?.state?.token ?? null) : null

  let firstProjectId: string | null = null
  if (workspaceId && token) {
    const projectsResp = await page.evaluate(
      async ({ wid, tok }: { wid: string; tok: string }) => {
        const r = await fetch(`/api/v1/workspaces/${wid}/projects`, {
          headers: { Authorization: `Bearer ${tok}` },
        })
        return r.ok ? r.json() : []
      },
      { wid: workspaceId, tok: token }
    )
    firstProjectId = projectsResp?.[0]?.id ?? null

    // Self-sufficient suite: if the account has no projects (e.g. after a data
    // cleanup), create one so project-dependent specs don't all skip.
    if (!firstProjectId) {
      firstProjectId = await page.evaluate(
        async ({ wid, tok }: { wid: string; tok: string }) => {
          const r = await fetch('/api/v1/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ workspaceId: wid, name: 'E2E Sandbox' }),
          })
          const d = await r.json().catch(() => null)
          return d?.id ?? null
        },
        { wid: workspaceId, tok: token }
      )
    }
  }

  fs.mkdirSync(path.dirname(fixturesFile), { recursive: true })
  fs.writeFileSync(fixturesFile, JSON.stringify({ firstProjectId }))

  await page.context().storageState({ path: authFile })
})

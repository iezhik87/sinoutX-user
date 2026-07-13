import { test, expect, type Page } from '@playwright/test'
import { getWorkspaceId } from './helpers'

// Admin-area coverage. The default storageState session is a regular member
// (TEST_EMAIL); the admin account comes from TEST_ADMIN_EMAIL/PASSWORD.

async function loginToken(page: Page, email: string, password: string): Promise<string | null> {
  return page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const d = await r.json().catch(() => null)
    return r.ok ? (d?.token ?? null) : null
  }, { email, password })
}

async function authedGet(page: Page, path: string, token: string): Promise<number> {
  return page.evaluate(async ({ path, token }) => {
    const r = await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })
    return r.status
  }, { path, token })
}

// ── ADM-01: admin endpoints are reachable for the admin ───────────────────────
test('ADM-01 — админ видит stats/settings/users/projects', async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL
  const password = process.env.TEST_ADMIN_PASSWORD
  if (!email || !password) test.skip(true, 'Нет TEST_ADMIN_EMAIL/PASSWORD')

  await page.goto('/'); await page.waitForTimeout(400)
  const token = await loginToken(page, email!, password!)
  expect(token, 'админ должен залогиниться').toBeTruthy()

  for (const path of ['/admin/stats', '/admin/settings', '/admin/users', '/admin/projects']) {
    expect(await authedGet(page, path, token!), `GET ${path}`).toBe(200)
  }
})

// ── SEC-06: a non-admin is rejected from /admin (403) ─────────────────────────
test('SEC-06 — обычный пользователь не имеет доступа к /admin', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(400)
  // Default session = regular member (TEST_EMAIL)
  const status = await page.evaluate(async () => {
    const authRaw = localStorage.getItem('sinoutx-auth')
    const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
    const r = await fetch('/api/v1/admin/stats', { headers: { Authorization: `Bearer ${token}` } })
    return r.status
  })
  expect(status).toBe(403)
})

// ── ADM-02: admin creates a user; that user can authenticate ──────────────────
test('ADM-02 — админ создаёт пользователя, и он может войти', async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL
  const password = process.env.TEST_ADMIN_PASSWORD
  if (!email || !password) test.skip(true, 'Нет TEST_ADMIN_EMAIL/PASSWORD')

  await page.goto('/'); await page.waitForTimeout(400)
  const adminToken = await loginToken(page, email!, password!)
  expect(adminToken).toBeTruthy()

  const newEmail = `e2e_member_${Date.now()}@e2e.local`
  const newPass = 'member12345'
  const created = await page.evaluate(async ({ token, newEmail, newPass }) => {
    const r = await fetch('/api/v1/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: newEmail, name: 'E2E Member', password: newPass, role: 'MEMBER' }),
    })
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }
  }, { token: adminToken!, newEmail, newPass })
  expect(created.ok, `create user (HTTP ${created.status})`).toBeTruthy()
  const userId = (created.data as { id: string }).id

  try {
    // Admin-created users should be usable immediately (no email verification step)
    const userToken = await loginToken(page, newEmail, newPass)
    expect(userToken, 'созданный админом пользователь должен входить').toBeTruthy()
  } finally {
    await page.evaluate(async ({ token, userId }) => {
      await fetch(`/api/v1/admin/users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    }, { token: adminToken!, userId })
  }
})

// ── SEC-01/02 (admin path): VIEWER reads but cannot mutate ────────────────────
// Uses an admin-created member promoted to workspace VIEWER — avoids the email
// verification wall that blocks self-registration.
test('SEC-01/02 — VIEWER читает, но не может изменять (через админа)', async ({ page }) => {
  const adminEmail = process.env.TEST_ADMIN_EMAIL
  const adminPass = process.env.TEST_ADMIN_PASSWORD
  if (!adminEmail || !adminPass) test.skip(true, 'Нет TEST_ADMIN_EMAIL/PASSWORD')

  await page.goto('/'); await page.waitForTimeout(400)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')
  const adminToken = await loginToken(page, adminEmail!, adminPass!)
  expect(adminToken).toBeTruthy()

  // Admin creates a fresh member to act as the viewer
  const vEmail = `e2e_viewer_${Date.now()}@e2e.local`
  const vPass = 'viewer12345'
  const created = await page.evaluate(async ({ token, vEmail, vPass }) => {
    const r = await fetch('/api/v1/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: vEmail, name: 'E2E Viewer', password: vPass, role: 'MEMBER' }),
    })
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }
  }, { token: adminToken!, vEmail, vPass })
  if (!created.ok) test.skip(true, `Не удалось создать viewer (HTTP ${created.status})`)
  const viewerUserId = (created.data as { id: string }).id

  try {
    const viewerToken = await loginToken(page, vEmail, vPass)
    expect(viewerToken).toBeTruthy()

    // Disable the viewer's invite email so addMember doesn't send a real email
    // to the fake @e2e.local address (it would bounce to the SMTP inbox).
    await page.evaluate(async (tok) => {
      await fetch('/api/v1/auth/notification-prefs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ deadlineReminder: false, taskComment: false, workspaceInvite: false }),
      })
    }, viewerToken)

    // The default session owner adds the viewer to their workspace as VIEWER
    const add = await page.evaluate(async ({ wid, email }) => {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
      const r = await fetch(`/api/v1/workspaces/${wid}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, role: 'VIEWER' }),
      })
      return { ok: r.ok, status: r.status }
    }, { wid, email: vEmail })
    if (!add.ok && add.status !== 409) test.skip(true, `Не удалось добавить участника (HTTP ${add.status})`)

    const result = await page.evaluate(async ({ wid, tok }) => {
      const read = await fetch(`/api/v1/workspaces/${wid}/projects`, { headers: { Authorization: `Bearer ${tok}` } })
      const write = await fetch('/api/v1/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ workspaceId: wid, name: 'viewer-should-fail' }),
      })
      return { readStatus: read.status, writeStatus: write.status }
    }, { wid, tok: viewerToken })

    expect(result.readStatus).toBe(200)   // SEC-01: read allowed
    expect(result.writeStatus).toBe(403)  // SEC-02: mutation denied
  } finally {
    await page.evaluate(async ({ token, userId }) => {
      await fetch(`/api/v1/admin/users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    }, { token: adminToken!, userId: viewerUserId })
  }
})

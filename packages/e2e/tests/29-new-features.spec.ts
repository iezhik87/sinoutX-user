import { test, expect } from '@playwright/test'
import { apiCall, getWorkspaceId } from './helpers'

// Smoke tests for endpoints added recently: the public cloud flag (gates the
// mobile app/PWA), the module manager, and the reworked wallet (tariff, editable
// cap, top-up status polling). API-level so they're deterministic — unlike the
// LLM-driven chat behaviour, which E2E can't assert reliably.

test.describe('New features', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('NEW-01: GET /config returns the cloud flag', async ({ page }) => {
    const res = await apiCall(page, 'GET', '/config')
    expect(res.status).toBe(200)
    const data = res.data as { cloud?: unknown }
    expect(typeof data.cloud).toBe('boolean')
  })

  test('NEW-02: module catalog is an array', async ({ page }) => {
    const res = await apiCall(page, 'GET', '/modules/catalog')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.data)).toBe(true)
  })

  test('NEW-03: module manager (/modules/mine) lists this workspace', async ({ page }) => {
    const wid = await getWorkspaceId(page)
    expect(wid, 'workspace id available').toBeTruthy()
    const res = await apiCall(page, 'GET', `/modules/mine?workspaceId=${wid}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.data)).toBe(true)
    // Every entry carries what the manager renders.
    for (const m of res.data as Record<string, unknown>[]) {
      expect(m).toHaveProperty('projectId')
      expect(m).toHaveProperty('source')
    }
  })

  test('NEW-04: wallet exposes the tariff + cap fields', async ({ page }) => {
    const res = await apiCall(page, 'GET', '/wallet')
    expect(res.status).toBe(200)
    const w = res.data as Record<string, unknown>
    expect(w).toHaveProperty('balanceUsd')
    expect(w).toHaveProperty('monthlyCapUsd')
    expect(w).toHaveProperty('monthlyCapDefaultUsd')
    expect(w).toHaveProperty('tariff')
  })

  test('NEW-05: top-up status of a bogus order is pending (not completed)', async ({ page }) => {
    const res = await apiCall(page, 'GET', '/wallet/topup-status/sx-topup-does-not-exist')
    expect(res.status).toBe(200)
    const d = res.data as { status?: string }
    expect(d.status).toBe('pending')
  })

  test('NEW-06: monthly cap can be set and reset', async ({ page }) => {
    // Set an explicit cap…
    const set = await apiCall(page, 'POST', '/wallet/cap', { capUsd: 33 })
    expect(set.status).toBe(200)
    expect((set.data as { capUsd?: number }).capUsd).toBe(33)
    // …then reset to the instance default (null).
    const reset = await apiCall(page, 'POST', '/wallet/cap', { capUsd: null })
    expect(reset.status).toBe(200)
    expect(typeof (reset.data as { capUsd?: number }).capUsd).toBe('number')
  })
})

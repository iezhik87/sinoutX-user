import { test, expect } from '@playwright/test'
import { apiCall } from './helpers'

// Smoke tests for the public crypto-billing endpoint (NOWPayments).
// /billing/invoice is public, but apiCall needs the app origin to issue a
// same-origin fetch, so we land on the app first. These guard against the
// billing flow silently breaking on deploy (e.g. env not wired to the
// container, validation regressions).

test.describe('Billing — /billing/invoice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('BILL-01: rejects an unknown plan (400)', async ({ page }) => {
    const res = await apiCall(page, 'POST', '/billing/invoice', { plan: 'enterprise', email: 'buyer@example.com' })
    expect(res.status).toBe(400)
  })

  test('BILL-02: rejects an invalid email (400)', async ({ page }) => {
    const res = await apiCall(page, 'POST', '/billing/invoice', { plan: 'team', email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  // The "pro" plan was retired — the only paid plan is Team. A pro checkout must
  // now be rejected as an unknown plan, not issue an invoice.
  test('BILL-03: the retired "pro" plan is rejected (400)', async ({ page }) => {
    const res = await apiCall(page, 'POST', '/billing/invoice', { plan: 'pro', email: 'smoke+pro@example.com' })
    expect(res.status).toBe(400)
  })

  test('BILL-04: team checkout returns an invoice URL (or 503 when unconfigured)', async ({ page }) => {
    const res = await apiCall(page, 'POST', '/billing/invoice', { plan: 'team', email: 'smoke+team@example.com' })

    if (res.status === 503) {
      test.info().annotations.push({ type: 'note', description: 'NOWPayments not configured — invoice creation skipped' })
      return
    }

    expect(res.status).toBe(200)
    const data = res.data as { invoiceUrl?: string; orderId?: string }
    expect(data.invoiceUrl).toMatch(/^https?:\/\//)
    expect(data.orderId).toMatch(/^sx-team-/)
  })

  test('BILL-05: webhook rejects a forged/missing signature (401)', async ({ page }) => {
    // No x-nowpayments-sig header → must be rejected, never issue a key.
    const res = await apiCall(page, 'POST', '/billing/webhook', {
      payment_id: 'forged-123', payment_status: 'finished', order_id: 'sx-pro-forged',
    })
    expect(res.status).toBe(401)
  })
})

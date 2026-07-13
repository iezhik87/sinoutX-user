import { test, expect } from '@playwright/test'
import { apiCall } from './helpers'

// Email-notification preferences round-trip. (Actual email delivery is driven by
// cron/events + SMTP and isn't asserted here — it needs a mail sink.)
test('NOTIF-01 — настройки email-уведомлений сохраняются', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)

  const before = await apiCall(page, 'GET', '/auth/notification-prefs')
  expect(before.ok, `GET prefs (HTTP ${before.status})`).toBeTruthy()
  const orig = before.data as { deadlineReminder: boolean; taskComment: boolean; workspaceInvite: boolean }

  // Flip taskComment and persist
  const target = !orig.taskComment
  const upd = await apiCall(page, 'PATCH', '/auth/notification-prefs', { ...orig, taskComment: target })
  expect(upd.ok).toBeTruthy()

  const after = await apiCall(page, 'GET', '/auth/notification-prefs')
  expect((after.data as { taskComment: boolean }).taskComment).toBe(target)

  // Restore original
  await apiCall(page, 'PATCH', '/auth/notification-prefs', orig)
})

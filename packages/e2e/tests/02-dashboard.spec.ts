import { test, expect } from '@playwright/test'

test('дашборд загружается', async ({ page }) => {
  await page.goto('/')
  // Sidebar виден
  await expect(page.locator('nav, aside').first()).toBeVisible()
  // Нет спиннеров бесконечной загрузки
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('кнопки плавающей панели видны', async ({ page }) => {
  await page.goto('/')
  // Закрываем morning brief если открылся автоматически
  const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Закрыть"), button:has-text("Close")').first()
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click()
  }
  await page.waitForTimeout(500)
  // Кнопка AI (плавающая панель)
  await expect(page.locator('button[title="AI Assistant (Ctrl+Shift+A)"]')).toBeVisible()
  // Помодоро
  await expect(page.locator('button[title="Pomodoro Timer"]')).toBeVisible()
})

test('Транскрипция открывается', async ({ page }) => {
  await page.goto('/')
  await page.click('button[title="Meeting Transcription"]')
  await expect(page.locator('text=/Транскрипция|Transcription/i')).toBeVisible()
})

test('AI сайдбар открывается', async ({ page }) => {
  await page.goto('/')
  // Закрываем morning brief если открылся
  const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Закрыть"), button:has-text("Close")').first()
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click()
    await page.waitForTimeout(300)
  }
  await page.click('button[title="AI Assistant (Ctrl+Shift+A)"]')
  // AI сайдбар открылся — видно поле ввода или кнопку нового чата
  await expect(
    page.locator('textarea, button[title="Новый чат"], button[title="История чатов"]').first()
  ).toBeVisible({ timeout: 8_000 })
})

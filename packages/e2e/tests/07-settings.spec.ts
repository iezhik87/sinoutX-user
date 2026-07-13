import { test, expect } from '@playwright/test'

test('страница настроек загружается', async ({ page }) => {
  await page.goto('/settings')
  await page.waitForTimeout(1500)
  await expect(page.locator('text=/Настройки|Settings/i').first()).toBeVisible()
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('вкладка AI ассистента видна в настройках', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.locator('text=/AI|Ассистент/i').first()).toBeVisible()
})

test('страница шаблонов загружается', async ({ page }) => {
  await page.goto('/templates')
  await page.waitForTimeout(1500)
  await expect(page.locator('text=/Шаблон|Template/i').first()).toBeVisible()
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('страница дедлайнов загружается', async ({ page }) => {
  await page.goto('/deadlines')
  await page.waitForTimeout(1500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('страница привычек загружается', async ({ page }) => {
  await page.goto('/habits')
  await page.waitForTimeout(1500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('дневник загружается', async ({ page }) => {
  await page.goto('/journal')
  await page.waitForTimeout(1500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

test('OKR загружается', async ({ page }) => {
  await page.goto('/okr')
  await page.waitForTimeout(1500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
})

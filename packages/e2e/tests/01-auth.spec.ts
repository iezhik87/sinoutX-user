import { test, expect } from '@playwright/test'

// Этот тест без сессии — тестирует страницу логина
test.use({ storageState: { cookies: [], origins: [] } })

test('страница логина открывается', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('text=SinoutX').first()).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('неверный пароль показывает ошибку', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'wrong@example.com')
  await page.fill('input[type="password"]', 'wrongpassword')
  await page.click('button[type="submit"]')
  // Остаёмся на /login
  await expect(page).toHaveURL('/login')
})

test('редирект с / на /login без авторизации', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/login')
})

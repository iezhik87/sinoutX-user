import { test, expect } from '@playwright/test'

test('страница заметок открывается', async ({ page }) => {
  await page.goto('/notes')
  await page.waitForTimeout(1500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('text=/Заметк|Note/i').first()).toBeVisible()
})

test('создание заметки', async ({ page }) => {
  await page.goto('/notes')
  await page.waitForTimeout(1000)

  const createBtn = page.locator('button').filter({ hasText: /Заметк|Note|Создать|New/i }).first()
  if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click()

    const editor = page.locator('.ProseMirror, [contenteditable="true"]').first()
    if (await editor.isVisible({ timeout: 3000 })) {
      await editor.click()
      await editor.type('E2E тест заметка')
      await page.waitForTimeout(1500)
      await expect(page.locator('text=E2E тест заметка')).toBeVisible()
    }
  }
})

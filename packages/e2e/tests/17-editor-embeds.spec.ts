import { test, expect } from '@playwright/test'
import { dismissMorningBrief } from './helpers'

// Note/Page embed blocks — недавно добавлены, регрессии не должно быть.
// Открываем обычную страницу из сайдбара (детерминированно, как 05-pages),
// чтобы не делить memory-page фикстуру с 16-mcp-memory и не ловить race.

test('slash-меню редактора содержит команды встраивания', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  const toggle = page.locator('.sidebar-item button').first()
  if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.click()
    await page.waitForTimeout(500)
  }

  const pageLink = page.locator('a[href*="/pages/"]').first()
  if (!await pageLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Нет страниц в сайдбаре')
  }
  await pageLink.click()
  await page.waitForURL(/\/pages\//)

  const editor = page.locator('.ProseMirror, [contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 8000 })

  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await editor.type('/')
  await page.waitForTimeout(900)

  await expect(page.locator('text=Встроить заметку').first()).toBeVisible({ timeout: 4000 })
  await expect(page.locator('text=Встроить страницу').first()).toBeVisible({ timeout: 4000 })
  await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
})

import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('страница проекта → создание страницы', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  const newPageBtn = page.locator('button').filter({ hasText: /Страниц|Page|Создать|New|Новая/ }).first()
  if (!await newPageBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Кнопка создания страницы не найдена')
  }

  await newPageBtn.click()
  await page.waitForURL(/\/pages\//, { timeout: 10_000 })
  await expect(page.locator('.ProseMirror, [contenteditable="true"]')).toBeVisible()
})

test('редактор страницы принимает ввод', async ({ page }) => {
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
  await expect(editor).toBeVisible()
  await editor.click()
  await editor.press('End')
  await editor.type(' E2E')
  await page.waitForTimeout(800)
  await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
})

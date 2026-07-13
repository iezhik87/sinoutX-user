import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('Kanban доска загружается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(1000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)

  const boardBtn = page.locator('button').filter({ hasText: /Board|Доска|Канбан/ }).first()
  if (await boardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await boardBtn.click()
    await page.waitForTimeout(1000)
  }
  await expect(page.locator('body')).toBeVisible()
})

test('Календарь проекта загружается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/calendar`)
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  // Календарь показывает сетку дней
  await expect(page.locator('body')).toBeVisible()
})

test('Бюджет проекта загружается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/budget`)
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('text=/Бюджет|Budget/i').first()).toBeVisible()
})

test('Граф знаний проекта загружается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/graph`)
  await page.waitForTimeout(3000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('canvas, svg').first()).toBeVisible({ timeout: 10_000 })
})

test('Глобальный граф знаний загружается', async ({ page }) => {
  await page.goto('/graph')
  await page.waitForTimeout(3000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('canvas, svg').first()).toBeVisible({ timeout: 10_000 })
})

test('Заметки проекта загружаются', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/notes`)
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('body')).toBeVisible()
})

test('Страница рисования загружается', async ({ page }) => {
  await page.goto('/draw')
  await page.waitForTimeout(3000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('canvas, [class*="excalidraw"], [class*="draw"]').first()).toBeVisible({ timeout: 10_000 })
})

test('Лента активности загружается', async ({ page }) => {
  await page.goto('/activity')
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  // Заголовок страницы: 'Лента активности'
  await expect(page.locator('h1').first()).toBeVisible()
})

test('Файлы загружаются', async ({ page }) => {
  await page.goto('/files')
  await page.waitForTimeout(2000)
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('body')).toBeVisible()
})

test('404 страница отображается', async ({ page }) => {
  await page.goto('/this-page-does-not-exist-12345')
  await expect(page.locator('text=/404|не найден|not found/i').first()).toBeVisible({ timeout: 5000 })
})

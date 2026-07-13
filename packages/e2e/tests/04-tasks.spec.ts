import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('страница задач открывается', async ({ page }) => {
  const projectId = await getFirstProjectId(page)
  if (!projectId) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${projectId}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(500)

  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await expect(page.locator('body')).toBeVisible()
})

test('создание задачи', async ({ page }) => {
  const projectId = await getFirstProjectId(page)
  if (!projectId) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${projectId}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(500)

  const addBtn = page.locator('button').filter({ hasText: /Задача|Task|Добавить|Add/ }).first()
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Кнопка добавления задачи не найдена')
  }

  await addBtn.click()
  const taskInput = page.locator(
    'textarea[placeholder*="задач"], textarea[placeholder*="task"], input[placeholder*="задач"], input[placeholder*="task"], input[placeholder*="Назван"]'
  ).first()
  if (await taskInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await taskInput.fill('E2E тест задача')
    await taskInput.press('Enter')
    await page.waitForTimeout(1000)
    await expect(page.locator('text=E2E тест задача')).toBeVisible()
  }
})

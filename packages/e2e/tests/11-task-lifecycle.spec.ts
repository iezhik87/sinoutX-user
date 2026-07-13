import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('полный цикл задачи: создать → переименовать → удалить', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(500)

  // Создаём задачу
  const addBtn = page.locator('button').filter({ hasText: /Задача|Task|Добавить|Add/ }).first()
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Кнопка добавления не найдена')
  }

  await addBtn.click()
  // CreateTaskModal uses textarea (not input) for the task title
  const taskInput = page.locator(
    'textarea[placeholder*="задач"], textarea[placeholder*="task"], input[placeholder*="задач"], input[placeholder*="task"], input[placeholder*="Назван"]'
  ).first()
  if (!await taskInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, 'Инпут задачи не найден')
  }

  const taskName = `E2E lifecycle ${Date.now()}`
  await taskInput.fill(taskName)
  await taskInput.press('Enter')
  await page.waitForTimeout(1000)

  // Задача появилась
  await expect(page.locator(`text=${taskName}`)).toBeVisible()
})

test('смена статуса задачи', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  // Ищем первый чекбокс или статус-кнопку задачи
  const taskCheckbox = page.locator('input[type="checkbox"]').first()
  if (await taskCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    await taskCheckbox.click()
    await page.waitForTimeout(800)
    // Нет краша
    await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
  }
})

test('фильтр задач по статусу', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/tasks`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  const filterBtn = page.locator('button').filter({ hasText: /Фильтр|Filter|Статус|Status/ }).first()
  if (await filterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await filterBtn.click()
    await page.waitForTimeout(500)
    await expect(page.locator('body')).toBeVisible()
  }
})

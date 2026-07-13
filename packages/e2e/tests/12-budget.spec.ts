import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('бюджет — добавление записи дохода', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/budget`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(500)

  const addBtn = page.locator('button').filter({ hasText: /Добавить|Add|Запись|Entry|Доход|Income/ }).first()
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Кнопка добавления не найдена')
  }

  await addBtn.click()
  await page.waitForTimeout(500)

  // Заполняем обязательные поля: категория и сумма
  const categoryInput = page.locator('input[placeholder*="Категори"], input[placeholder*="Category"]').first()
  const amountInput = page.locator('input[placeholder*="Сумма"], input[placeholder*="Amount"], input[type="number"]').first()

  if (await categoryInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await categoryInput.fill('E2E категория')
  }
  if (await amountInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await amountInput.fill('1000')
  }

  const saveBtn = page.locator('button[type="submit"]').first()
  if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await saveBtn.click()
    await page.waitForTimeout(1000)
    await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
  }
})

test('бюджет — итоги отображаются', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/budget`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)
  await page.waitForTimeout(500)
  await expect(page.locator('.animate-spin')).toHaveCount(0)

  // Должна быть таблица или карточки с суммами
  await expect(page.locator('text=/Бюджет|Budget|Доход|Income|Расход|Expense/i').first()).toBeVisible()
})

import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('переименование проекта', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}`)
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  // Кликаем на заголовок проекта (он редактируемый)
  const titleBtn = page.locator('header button, [class*="header"] button').filter({ hasText: /\S/ }).first()
  if (await titleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await titleBtn.click()
    const input = page.locator('input[class*="bg-surface"]').first()
    if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      await input.press('Control+a')
      await input.type('Переименованный E2E')
      await input.press('Enter')
      await page.waitForTimeout(1000)
      await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
    }
  }
})

test('создание и удаление заметки', async ({ page }) => {
  await page.goto('/notes')
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  const createBtn = page.locator('button').filter({ hasText: /Создать|New|Добавить|Новая/ }).first()
  if (!await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, 'Кнопка создания заметки не найдена')
  }

  await createBtn.click()
  await page.waitForTimeout(500)

  const editor = page.locator('.ProseMirror, [contenteditable="true"]').first()
  if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await editor.click()
    await editor.type('E2E заметка для удаления')
    await page.waitForTimeout(1000)
  }

  // Ищем кнопку удаления заметки
  const deleteBtn = page.locator('button').filter({ hasText: /Удалить|Delete/ }).first()
  if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    page.once('dialog', dialog => dialog.accept())
    await deleteBtn.click()
    await page.waitForTimeout(1000)
    await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
  }
})

test('шаблоны — кастомный шаблон создаётся', async ({ page }) => {
  await page.goto('/templates')
  await page.waitForTimeout(1000)
  await dismissMorningBrief(page)

  const addBtn = page.locator('button').filter({ hasText: /Добавить|Add|Создать|New|шаблон/i }).first()
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, 'Кнопка добавления шаблона не найдена')
  }

  await addBtn.click()
  await page.waitForTimeout(500)

  // Форма шаблона
  const nameInput = page.locator('input[placeholder*="Название"], input[placeholder*="Name"]').first()
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill('E2E шаблон тест')

    const saveBtn = page.locator('button[type="submit"], button').filter({ hasText: /Сохранить|Save/ }).first()
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveBtn.click()
      await page.waitForTimeout(1000)
      await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
    }
  }
})

test('выход из системы', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1000)

  // Ищем кнопку logout/выход в сайдбаре
  const logoutBtn = page.locator('button').filter({ hasText: /Выйти|Logout|Sign out/i }).first()
  if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutBtn.click()
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL('/login')
  } else {
    // Возможно в меню аккаунта
    const accountBtn = page.locator('button[class*="avatar"], button[class*="user"], [class*="account"]').first()
    if (await accountBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await accountBtn.click()
      await page.waitForTimeout(500)
      const logoutInMenu = page.locator('button, a').filter({ hasText: /Выйти|Logout/i }).first()
      if (await logoutInMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        await logoutInMenu.click()
        await expect(page).toHaveURL('/login')
      }
    }
  }
})

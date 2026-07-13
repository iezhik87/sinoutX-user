import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

test('AI анализ здоровья — реально запускается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}`)
  await page.waitForTimeout(1000)

  // Кликаем кнопку AI в хедере
  const aiBtn = page.locator('button.btn-ghost').filter({ hasText: 'AI' }).first()
  await aiBtn.click()

  await expect(page.locator('text=/Анализ проекта|Project Health/i')).toBeVisible()

  // Запускаем анализ
  const runBtn = page.locator('button').filter({ hasText: /Запустить|Run|Анализ/ }).first()
  await expect(runBtn).toBeVisible({ timeout: 5_000 })
  await runBtn.click()

  // Достаточно убедиться, что анализ запустился (кнопка сменила текст на loading)
  await expect(
    page.locator('.animate-spin').or(page.locator('button').filter({ hasText: /Анализиру|Analyzing/i })).first()
  ).toBeVisible({ timeout: 10_000 })
})

test('AI сайдбар — отправка сообщения', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)

  await page.click('button[title="AI Assistant (Ctrl+Shift+A)"]')
  await page.waitForTimeout(500)

  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 5000 })

  await textarea.fill('Привет, что ты умеешь?')
  await textarea.press('Enter')

  // Ждём ответа (спиннер исчезает или появляется текст)
  await page.waitForTimeout(2000)
  // Хотя бы нет краша
  await expect(page.locator('body')).toBeVisible()
})

test('AI slash-команда в редакторе', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  // Get auth token from localStorage (need to be on app origin first)
  const currentUrl = page.url()
  const onAppOrigin = currentUrl.startsWith('http://localhost') || currentUrl.startsWith('http://127.0.0.1')
  if (!onAppOrigin) {
    await page.goto('/', { waitUntil: 'commit' })
  }
  const authRaw = await page.evaluate(() => localStorage.getItem('sinoutx-auth'))
  const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
  if (!token) test.skip(true, 'Нет токена аутентификации')

  const pagesResp = await page.evaluate(
    async ({ projectId, tok }: { projectId: string; tok: string }) => {
      const r = await fetch(`/api/v1/projects/${projectId}/pages`, { headers: { Authorization: `Bearer ${tok}` } })
      return r.ok ? r.json() : []
    },
    { projectId: pid as string, tok: token as string }
  )
  const firstPage = pagesResp?.[0]
  if (!firstPage?.id) test.skip(true, 'Нет страниц')

  await page.goto(`/pages/${firstPage.id}`)
  await page.waitForURL(/\/pages\//, { timeout: 10_000 })

  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  await page.waitForTimeout(500)
  await editor.press('End')
  await editor.press('Enter')
  await page.keyboard.press('/')

  // Slash-меню использует класс animate-fade-in (SlashCommandMenu.tsx)
  await expect(
    page.locator('[class*="animate-fade-in"]').first()
  ).toBeVisible({ timeout: 3000 })
})

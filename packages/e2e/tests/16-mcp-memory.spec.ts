import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

// AI Память проекта — ключевой дифференциатор (MCP двусторонняя память).
// Регрессия здесь критична: на этом строится всё позиционирование.
// Проверка "редактор принимает ввод" покрыта 05-pages на обычной странице
// и не дублируется здесь, чтобы не делить shared memory-page между
// параллельными воркерами (давало flake под полной нагрузкой).

test('AI Память проекта открывается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/memory`)
  await page.waitForTimeout(1500)
  await dismissMorningBrief(page)

  const heading = page.locator('h1', { hasText: /Память|Memory/ }).first()
  await expect(heading).toBeVisible({ timeout: 8000 })

  // Editor mounts after the memory-page query resolves — proves the route
  // wires Claude's memory document through BlockEditor without errors.
  const editor = page.locator('.ProseMirror, [contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 10000 })

  await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
})

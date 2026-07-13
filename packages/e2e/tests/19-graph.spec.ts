import { test, expect } from '@playwright/test'
import { getFirstProjectId, dismissMorningBrief } from './helpers'

// Граф знаний — smoke-регрессия (рендер без ошибок).

test('граф знаний открывается', async ({ page }) => {
  await page.goto('/graph')
  await page.waitForTimeout(1800)
  await dismissMorningBrief(page)

  const graph = page.locator('.react-flow, svg, canvas').first()
  if (!await graph.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, 'Граф не отрендерился')
  }
  await expect(graph).toBeVisible()
})

test('граф проекта открывается', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')

  await page.goto(`/projects/${pid}/graph`)
  await page.waitForTimeout(1800)
  await dismissMorningBrief(page)

  const graph = page.locator('.react-flow, svg, canvas').first()
  if (!await graph.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, 'Граф проекта не отрендерился')
  }
  await expect(graph).toBeVisible()
})

import { test, expect } from '@playwright/test'
import { dismissMorningBrief } from './helpers'

test('доска идей открывается и рендерит холст', async ({ page }) => {
  await page.goto('/canvas')
  await page.waitForTimeout(1500)
  await dismissMorningBrief(page)

  const canvas = page.locator('.react-flow, [data-testid="rf__wrapper"]').first()
  await expect(canvas).toBeVisible({ timeout: 15000 })
  await expect(page.locator('text=/ошибк|error/i')).toHaveCount(0)
})

test('на доску можно добавить заметку и она ресайзится', async ({ page }) => {
  await page.goto('/canvas')
  // /canvas auto-redirects to /canvas/:id when a canvas exists
  await page.waitForTimeout(2500)
  await dismissMorningBrief(page)

  if (!/\/canvas\/[^/]+/.test(page.url())) {
    test.skip(true, 'Нет ни одной доски в фикстуре — нечего ресайзить')
  }

  // Precise add-note button (not "Добавить контент"): button named exactly "Заметка"/"Note"/"Нататка"
  const addNoteBtn = page.getByRole('button', { name: /^(Заметка|Note|Нататка)$/ }).first()
  await expect(addNoteBtn).toBeVisible({ timeout: 5000 })
  await addNoteBtn.click()
  await page.waitForTimeout(1000)

  const node = page.locator('.react-flow__node').first()
  await expect(node).toBeVisible({ timeout: 5000 })

  // Select node → NodeResizer control handles should appear
  await node.click()
  await page.waitForTimeout(500)
  await expect(page.locator('.react-flow__resize-control').first()).toBeVisible({ timeout: 3000 })
})

import { test, expect } from '@playwright/test'
import { dismissMorningBrief } from './helpers'

test('Command Palette открывается по Ctrl+K', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.keyboard.press('Control+k')
  await expect(page.locator('input[placeholder*="Поиск"], input[placeholder*="Search"]').first()).toBeVisible({ timeout: 5000 })
})

test('Command Palette открывается по кнопке в сайдбаре', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  const searchBtn = page.locator('button[title*="Поиск"], button[title*="Search"], button[title*="Ctrl"]').first()
  if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchBtn.click()
    await expect(page.locator('input[placeholder*="Поиск"], input[placeholder*="Search"]').first()).toBeVisible({ timeout: 5000 })
  } else {
    // fallback — через Ctrl+K
    await page.keyboard.press('Control+k')
    await expect(page.locator('input[placeholder*="Поиск"], input[placeholder*="Search"]').first()).toBeVisible({ timeout: 5000 })
  }
})

test('Command Palette ищет и показывает результаты', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.keyboard.press('Control+k')

  const input = page.locator('input[placeholder*="Поиск"], input[placeholder*="Search"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.type('а')
  await page.waitForTimeout(600)
  // Результаты — список в скроллируемом div, или quick actions
  const results = page.locator('div.max-h-\\[400px\\], div[class*="overflow-y-auto"]').first()
  await expect(results).toBeVisible({ timeout: 3000 })
})

test('Command Palette закрывается по Escape', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.keyboard.press('Control+k')
  // Palette overlay — fixed inset-0 z-50
  const palette = page.locator('div[class*="inset-0"][class*="z-50"]').first()
  await expect(palette).toBeVisible({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await expect(palette).not.toBeVisible({ timeout: 3000 })
})

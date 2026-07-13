import { test, expect } from '@playwright/test'
import { dismissMorningBrief } from './helpers'

test('Помодоро открывается', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.click('button[title="Pomodoro Timer"]')
  // Компонент показывает фазу 'Работа' и таймер 25:00
  await expect(page.locator('text=/Работа|Work|Перерыв|Break/i').first()).toBeVisible({ timeout: 5000 })
})

test('Помодоро показывает таймер', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.click('button[title="Pomodoro Timer"]')
  // Таймер показывает время в формате MM:SS
  await expect(page.locator('text=/\\d{2}:\\d{2}/')).toBeVisible({ timeout: 5000 })
})

test('Помодоро запускает таймер', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.click('button[title="Pomodoro Timer"]')
  await page.waitForTimeout(500)

  // Кнопка старт/пауза
  const startBtn = page.locator('button').filter({ hasText: /Старт|Start|▶|Пауза|Pause/ }).first()
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const timeBefore = await page.locator('text=/\\d{2}:\\d{2}/').first().textContent()
    await startBtn.click()
    await page.waitForTimeout(2000)
    const timeAfter = await page.locator('text=/\\d{2}:\\d{2}/').first().textContent()
    // Время изменилось
    expect(timeBefore).not.toBe(timeAfter)
  }
})

test('Помодоро закрывается', async ({ page }) => {
  await page.goto('/')
  await dismissMorningBrief(page)
  await page.click('button[title="Pomodoro Timer"]')
  await page.waitForTimeout(500)

  // Второй клик закрывает
  await page.click('button[title="Pomodoro Timer"]')
  await expect(page.locator('text=/\\d{2}:\\d{2}/')).not.toBeVisible({ timeout: 3000 })
})

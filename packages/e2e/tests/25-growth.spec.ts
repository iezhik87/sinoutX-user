import { test, expect } from '@playwright/test'
import { getWorkspaceId, apiCall } from './helpers'

// Growth AI-tools: verify the new habit/OKR/journal tools are exposed in the AI
// tool catalog. (The underlying REST endpoints are exercised by 22-coverage-full
// GW-02/03/04; invoking the tools via the AI chat needs a configured AI key.)
test('GW-AI-01 — каталог AI-инструментов содержит Growth-тулы', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const res = await apiCall(page, 'GET', `/ai/settings?workspaceId=${wid}`)
  expect(res.ok, `GET /ai/settings (HTTP ${res.status})`).toBeTruthy()
  const catalog = (res.data as { catalog?: { name: string }[] })?.catalog ?? []
  const names = new Set(catalog.map((t) => t.name))

  for (const tool of ['create_habit', 'check_habit', 'create_objective', 'add_key_result', 'create_journal_entry']) {
    expect(names.has(tool), `tool ${tool} в каталоге`).toBe(true)
  }
})

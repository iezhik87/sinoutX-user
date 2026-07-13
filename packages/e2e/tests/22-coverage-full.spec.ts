import { test, expect } from '@playwright/test'
import { getFirstProjectId, getWorkspaceId, apiCall } from './helpers'

// Broad API-grounded coverage for the remaining QA-CHECKLIST sections.
// Everything is created and then deleted, so it's safe on a shared instance.

// ── TSK-01/08: task create → update → delete ──────────────────────────────────
test('TSK-01/08 — задача: создать, обновить статус, удалить', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')
  await page.goto('/'); await page.waitForTimeout(500)

  const created = await apiCall(page, 'POST', '/tasks', { projectId: pid, title: 'E2E Task', priority: 'MEDIUM' })
  expect(created.ok, `create task (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const upd = await apiCall(page, 'PATCH', `/tasks/${id}`, { status: 'DONE' })
    expect(upd.ok).toBeTruthy()
    expect((upd.data as { status: string }).status).toBe('DONE')
  } finally {
    const del = await apiCall(page, 'DELETE', `/tasks/${id}`)
    expect(del.status).toBeLessThan(400)
  }
})

// ── NT-01/02: note create → update → delete ───────────────────────────────────
test('NT-01/02 — заметка: создать, обновить, удалить', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'E2E note' }] }] }
  const created = await apiCall(page, 'POST', '/notes', { workspaceId: wid, content: doc, tags: ['e2e'] })
  expect(created.ok, `create note (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const upd = await apiCall(page, 'PATCH', `/notes/${id}`, { pinned: true })
    expect(upd.ok).toBeTruthy()
    expect((upd.data as { pinned: boolean }).pinned).toBe(true)
  } finally {
    expect((await apiCall(page, 'DELETE', `/notes/${id}`)).status).toBeLessThan(400)
  }
})

// ── CAL-01: event create → appears in list → delete ───────────────────────────
test('CAL-01 — событие: создать и увидеть в списке', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')
  await page.goto('/'); await page.waitForTimeout(500)

  const start = new Date(Date.now() + 86_400_000).toISOString()
  const created = await apiCall(page, 'POST', '/events', { projectId: pid, title: 'E2E Event', startAt: start })
  expect(created.ok, `create event (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const list = await apiCall(page, 'GET', `/events?projectId=${pid}`)
    expect(list.ok).toBeTruthy()
    expect((list.data as { id: string }[]).some((e) => e.id === id)).toBe(true)
  } finally {
    expect((await apiCall(page, 'DELETE', `/events/${id}`)).status).toBeLessThan(400)
  }
})

// ── GW-02: habit create → toggle → stats → delete ─────────────────────────────
test('GW-02 — привычка: создать, отметить, статистика, удалить', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const created = await apiCall(page, 'POST', `/workspaces/${wid}/habits`, { name: 'E2E Habit' })
  expect(created.ok, `create habit (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const today = new Date().toISOString().slice(0, 10)
    const toggle = await apiCall(page, 'POST', `/habits/${id}/check/${today}`)
    expect(toggle.ok).toBeTruthy()
    const stats = await apiCall(page, 'GET', `/habits/${id}/stats`)
    expect(stats.ok).toBeTruthy()
  } finally {
    expect((await apiCall(page, 'DELETE', `/habits/${id}`)).status).toBeLessThan(400)
  }
})

// ── GW-03: objective create → add key result → delete ─────────────────────────
test('GW-03 — цель (OKR): создать, добавить KR, удалить', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const created = await apiCall(page, 'POST', `/workspaces/${wid}/objectives`, { title: 'E2E Objective' })
  expect(created.ok, `create objective (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const kr = await apiCall(page, 'POST', `/objectives/${id}/key-results`, { title: 'E2E KR', target: 100, current: 50 })
    expect(kr.ok).toBeTruthy()
  } finally {
    expect((await apiCall(page, 'DELETE', `/objectives/${id}`)).status).toBeLessThan(400)
  }
})

// ── GW-04: journal save → read → delete ───────────────────────────────────────
test('GW-04 — дневник: сохранить запись, прочитать, удалить', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)

  const date = new Date().toISOString().slice(0, 10)
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'E2E journal' }] }] }
  const saved = await apiCall(page, 'PUT', `/journal/${date}`, { content: doc, mood: 'good' })
  expect(saved.ok, `save journal (HTTP ${saved.status})`).toBeTruthy()
  try {
    const got = await apiCall(page, 'GET', `/journal/${date}`)
    expect(got.ok).toBeTruthy()
  } finally {
    expect((await apiCall(page, 'DELETE', `/journal/${date}`)).status).toBeLessThan(400)
  }
})

// ── WS-02/04/05: workspace create → rename → delete ───────────────────────────
test('WS-02/04/05 — workspace: создать, переименовать, удалить', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(500)

  const created = await apiCall(page, 'POST', '/workspaces', { name: 'E2E WS' })
  // Free plan limits workspaces — a 403 here is a plan limit, not a bug.
  if (created.status === 403) test.skip(true, 'План ограничивает число воркспейсов')
  expect(created.ok, `create ws (HTTP ${created.status})`).toBeTruthy()
  const id = (created.data as { id: string }).id
  try {
    const upd = await apiCall(page, 'PATCH', `/workspaces/${id}`, { name: 'E2E WS renamed' })
    expect(upd.ok).toBeTruthy()
    expect((upd.data as { name: string }).name).toBe('E2E WS renamed')
  } finally {
    expect((await apiCall(page, 'DELETE', `/workspaces/${id}`)).status).toBeLessThan(400)
  }
})

// ── SR-01: full-text search finds a freshly created page (Meili async) ─────────
test('SR-01 — полнотекстовый поиск находит созданную страницу', async ({ page }) => {
  const pid = await getFirstProjectId(page)
  if (!pid) test.skip(true, 'Нет проектов')
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)
  if (!wid) test.skip(true, 'Нет workspace')

  const marker = `E2EFIND${Date.now()}`
  const created = await apiCall(page, 'POST', '/pages', { projectId: pid, title: marker })
  expect(created.ok).toBeTruthy()
  const id = (created.data as { id: string }).id
  await apiCall(page, 'PATCH', `/pages/${id}`, {
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }] },
  })
  try {
    // Pages aren't indexed on write — index this page explicitly, then poll.
    await apiCall(page, 'POST', `/search/index/page/${id}`)
    let found = false
    for (let i = 0; i < 20 && !found; i++) {
      await page.waitForTimeout(1000)
      const res = await apiCall(page, 'GET', `/search?q=${marker}&workspaceId=${wid}`)
      const list = (res.data as { results?: { id: string }[] })?.results ?? []
      found = Array.isArray(list) && list.some((r) => r.id === id)
    }
    expect(found, 'страница должна находиться в поиске после индексации').toBe(true)
  } finally {
    await apiCall(page, 'DELETE', `/pages/${id}`)
  }
})

// SEC-01/02 (VIEWER read-only) lives in 23-admin.spec.ts — it needs an
// admin-created (verified) account, since self-registration requires email
// verification before login.

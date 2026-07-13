import axios from 'axios'
import { AsyncLocalStorage } from 'node:async_hooks'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3010'
// Single-tenant fallback: an operator can set one key in env. Per-request
// keys (from the caller's x-api-key header) always take priority.
const FALLBACK_API_KEY = process.env.MCP_API_KEY ?? process.env.BACKEND_API_KEY ?? ''

// Holds the API key for the current MCP request so every backend call runs
// as the caller's own user — multi-user safe.
const apiKeyStore = new AsyncLocalStorage<string>()

/** Run `fn` with the given API key bound to the async context. */
export function runWithApiKey<T>(apiKey: string | undefined, fn: () => Promise<T>): Promise<T> {
  return apiKeyStore.run(apiKey || FALLBACK_API_KEY, fn)
}

export function currentApiKey(): string {
  return apiKeyStore.getStore() || FALLBACK_API_KEY
}

export const http = axios.create({
  baseURL: `${BACKEND_URL}/api/v1`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// Inject the current request's API key on every call.
http.interceptors.request.use((config) => {
  const key = currentApiKey()
  if (key) config.headers['X-API-Key'] = key
  // Bodyless GET/DELETE must NOT carry Content-Type: application/json, or Fastify
  // rejects them with FST_ERR_CTP_EMPTY_JSON_BODY (empty body for json content-type).
  const m = (config.method ?? '').toLowerCase()
  if ((m === 'get' || m === 'delete') && config.data == null && config.headers) {
    const h = config.headers as any
    if (typeof h.delete === 'function') h.delete('Content-Type'); else delete h['Content-Type']
  }
  return config
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.error ?? err.message ?? 'Unknown error'
    throw new Error(`Sinout API error: ${msg}`)
  },
)

// ─── Workspaces ───────────────────────────────────────────────────────────────
export const workspaces = {
  list: () => http.get('/workspaces').then((r) => r.data),
  personal: () => http.get('/workspaces/personal').then((r) => r.data),
  getById: (id: string) => http.get(`/workspaces/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string }) =>
    http.post('/workspaces', data).then((r) => r.data),
  update: (id: string, data: Partial<{ name: string; description: string; icon: string; color: string }>) =>
    http.patch(`/workspaces/${id}`, data).then((r) => r.data),
}

// ─── Projects ─────────────────────────────────────────────────────────────────
export const projects = {
  listByWorkspace: (workspaceId: string) =>
    http.get(`/workspaces/${workspaceId}/projects`).then((r) => r.data),
  getById: (id: string) => http.get(`/projects/${id}`).then((r) => r.data),
  create: (data: { workspaceId: string; name: string; description?: string }) =>
    http.post('/projects', data).then((r) => r.data),
  update: (id: string, data: Partial<{ name: string; description: string; status: string }>) =>
    http.patch(`/projects/${id}`, data).then((r) => r.data),
}

// ─── Pages ────────────────────────────────────────────────────────────────────
export const pages = {
  listByProject: (projectId: string) =>
    http.get(`/projects/${projectId}/pages`).then((r) => r.data),
  getTree: (projectId: string) =>
    http.get(`/projects/${projectId}/pages/tree`).then((r) => r.data),
  getById: (id: string) => http.get(`/pages/${id}`).then((r) => r.data),
  create: (data: { projectId: string; title: string; parentPageId?: string; content?: object }) =>
    http.post('/pages', data).then((r) => r.data),
  update: (id: string, data: Partial<{ title: string; content: object }>) =>
    http.patch(`/pages/${id}`, data).then((r) => r.data),
  delete: (id: string) => http.delete(`/pages/${id}`).then((r) => r.data),
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = {
  list: (params: { projectId?: string; status?: string; priority?: string; boardId?: string }) =>
    http.get('/tasks', { params }).then((r) => r.data),
  getById: (id: string) => http.get(`/tasks/${id}`).then((r) => r.data),
  create: (data: {
    projectId: string
    title: string
    status?: string
    priority?: string
    startDate?: string
    dueDate?: string
    pageId?: string
    parentTaskId?: string
  }) => http.post('/tasks', data).then((r) => r.data),
  update: (id: string, data: Partial<{ title: string; status: string; priority: string; startDate: string; dueDate: string; description: Record<string, unknown> }>) =>
    http.patch(`/tasks/${id}`, data).then((r) => r.data),
  getAnalytics: (projectId: string) =>
    http.get(`/projects/${projectId}/tasks/analytics`).then((r) => r.data),
}

// ─── Boards ───────────────────────────────────────────────────────────────────
export const boards = {
  listByProject: (projectId: string) =>
    http.get('/boards', { params: { projectId } }).then((r) => r.data),
  getById: (id: string) => http.get(`/boards/${id}`).then((r) => r.data),
}

// ─── Search ───────────────────────────────────────────────────────────────────
export const search = {
  query: (q: string, params?: { workspaceId?: string; projectId?: string; limit?: number }) =>
    http.get('/search', { params: { q, ...params } }).then((r) => r.data),
  reindex: () => http.post('/search/reindex').then((r) => r.data),
}

// ─── Graph ────────────────────────────────────────────────────────────────────
export const graph = {
  get: (params: { workspaceId?: string; projectId?: string }) =>
    http.get('/graph', { params }).then((r) => r.data),
  createLink: (data: { sourceType: string; sourceId: string; targetType: string; targetId: string; linkType: string }) =>
    http.post('/links', data).then((r) => r.data),
  deleteLink: (id: string) => http.delete(`/links/${id}`).then((r) => r.data),
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
export const calendar = {
  list: (params: { projectId?: string; workspaceId?: string; from?: string; to?: string }) =>
    http.get('/events', { params }).then((r) => r.data),
  getUpcoming: (workspaceId: string, limit = 10) =>
    http.get('/events/upcoming', { params: { workspaceId, limit } }).then((r) => r.data),
  create: (data: {
    projectId: string
    title: string
    startAt: string
    endAt?: string
    allDay?: boolean
    description?: string
  }) => http.post('/events', data).then((r) => r.data),
  update: (id: string, data: Partial<{ title: string; startAt: string; endAt: string; description: string }>) =>
    http.patch(`/events/${id}`, data).then((r) => r.data),
}

// ─── Budget ───────────────────────────────────────────────────────────────────
export const budget = {
  list: (params: { projectId?: string; type?: string }) =>
    http.get('/budget', { params }).then((r) => r.data),
  getSummary: (params: { projectId?: string; workspaceId?: string }) =>
    http.get('/budget/summary', { params }).then((r) => r.data),
  create: (data: {
    projectId: string
    type: string
    category: string
    amount: number
    currency?: string
    date: string
    description?: string
  }) => http.post('/budget', data).then((r) => r.data),
}

// ─── Modules ──────────────────────────────────────────────────────────────────
export const modules = {
  installed: (workspaceId: string) =>
    http.get('/modules/installed', { params: { workspaceId } }).then((r) => r.data),
  install: (workspaceId: string, moduleId: string) =>
    http.post('/modules/install', { workspaceId, moduleId }).then((r) => r.data),
}

// ─── Collections (реестры — typed datasets inside modules) ────────────────────
export const collections = {
  listByProject: (projectId: string) =>
    http.get(`/projects/${projectId}/collections`).then((r) => r.data),
  records: (collectionId: string) =>
    http.get(`/collections/${collectionId}/records`).then((r) => r.data),
  createRecord: (collectionId: string, data: Record<string, unknown>) =>
    http.post(`/collections/${collectionId}/records`, { data }).then((r) => r.data),
  createRecordsBatch: (collectionId: string, items: Record<string, unknown>[]) =>
    http.post(`/collections/${collectionId}/records/batch`, { items }).then((r) => r.data),
  updateRecord: (recordId: string, data: Record<string, unknown>) =>
    http.patch(`/records/${recordId}`, { data }).then((r) => r.data),
  deleteRecord: (recordId: string) =>
    http.delete(`/records/${recordId}`).then((r) => r.data),
  deleteRecordsBatch: (ids: string[]) =>
    http.post('/records/batch-delete', { ids }).then((r) => r.data),
  recall: (workspaceId: string, query: string, collectionIds: string[], limit: number, since?: string, until?: string) =>
    http.post('/collections/recall', { workspaceId, query, collectionIds, limit, since, until }).then((r) => r.data),
  consolidate: (workspaceId: string) =>
    http.post('/collections/consolidate', { workspaceId }).then((r) => r.data),
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────
export async function askAI(
  question: string,
  context?: { workspaceId?: string; projectId?: string; projectName?: string },
): Promise<string> {
  const url = `${BACKEND_URL}/api/v1/ai/chat`
  const body = JSON.stringify({
    messages: [{ role: 'user', content: question }],
    context: { ...(context ?? {}), userLanguage: 'ru' },
  })

  const key = currentApiKey()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body,
  })

  if (!res.ok || !res.body) {
    throw new Error(`AI chat error: ${res.status} ${res.statusText}`)
  }

  const chunks: string[] = []
  const decoder = new TextDecoder()
  const reader = res.body.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const raw = decoder.decode(value, { stream: true })
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6)) as { type: string; text?: string }
        if (event.type === 'text' && event.text) chunks.push(event.text)
        if (event.type === 'done') break
        if (event.type === 'error' && event.text) throw new Error(event.text)
      } catch {
        // skip malformed lines
      }
    }
  }

  return chunks.join('')
}

// ─── Notes ────────────────────────────────────────────────────────────────────
export const notes = {
  list: (params: { workspaceId?: string; pinned?: boolean }) =>
    http.get('/notes', { params }).then((r) => r.data),
  getById: (id: string) => http.get(`/notes/${id}`).then((r) => r.data),
  create: (data: { workspaceId: string; content?: object; tags?: string[]; pinned?: boolean }) =>
    http.post('/notes', data).then((r) => r.data),
  update: (id: string, data: Partial<{ content: object; tags: string[]; pinned: boolean }>) =>
    http.patch(`/notes/${id}`, data).then((r) => r.data),
  delete: (id: string) => http.delete(`/notes/${id}`).then((r) => r.data),
}

// ─── Growth: habits / OKR / journal ─────────────────────────────────────────────
export const habits = {
  list: (workspaceId: string) =>
    http.get(`/workspaces/${workspaceId}/habits`).then((r) => r.data),
  create: (workspaceId: string, data: { name: string; description?: string; icon?: string; period?: string }) =>
    http.post(`/workspaces/${workspaceId}/habits`, data).then((r) => r.data),
  check: (id: string, date: string) =>
    http.post(`/habits/${id}/check/${date}`).then((r) => r.data),
}

export const okr = {
  list: (workspaceId: string) =>
    http.get(`/workspaces/${workspaceId}/objectives`).then((r) => r.data),
  createObjective: (workspaceId: string, data: { title: string; description?: string; quarter?: string; deadline?: string }) =>
    http.post(`/workspaces/${workspaceId}/objectives`, data).then((r) => r.data),
  addKeyResult: (objectiveId: string, data: { title: string; target?: number; current?: number; unit?: string }) =>
    http.post(`/objectives/${objectiveId}/key-results`, data).then((r) => r.data),
}

export const journal = {
  save: (date: string, content: object, mood?: string) =>
    http.put(`/journal/${date}`, { content, mood }).then((r) => r.data),
}

// ─── Files / attachments (binary) ──────────────────────────────────────────────
export const files = {
  list: (params: { workspaceId?: string; projectId?: string }) =>
    http.get('/attachments', { params }).then((r) => r.data),
  remove: (id: string) => http.delete(`/attachments/${id}`).then((r) => r.data),

  upload: async (opts: { filename: string; mimeType: string; base64: string; workspaceId: string; projectId?: string; description?: string }) => {
    const buf = Buffer.from(opts.base64, 'base64')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buf)], { type: opts.mimeType || 'application/octet-stream' }), opts.filename)
    const qs = new URLSearchParams({ workspaceId: opts.workspaceId, ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.description ? { description: opts.description } : {}) })
    const key = currentApiKey()
    const res = await fetch(`${BACKEND_URL}/api/v1/upload?${qs.toString()}`, { method: 'POST', headers: { ...(key ? { 'X-API-Key': key } : {}) }, body: form })
    if (!res.ok) throw new Error(`Sinout upload error ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  },

  getContent: async (id: string) => {
    const key = currentApiKey()
    const res = await fetch(`${BACKEND_URL}/api/v1/attachments/${id}/content`, { headers: { ...(key ? { 'X-API-Key': key } : {}) } })
    if (!res.ok) throw new Error(`Sinout get-file error ${res.status}`)
    const mimeType = res.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await res.arrayBuffer())
    return { mimeType, bytes: buf.byteLength, base64: buf.toString('base64') }
  },
}

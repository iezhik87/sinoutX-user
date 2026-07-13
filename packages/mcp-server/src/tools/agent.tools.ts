import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })
const slim = (c: any) => ({ id: c.id, key: c.key, name: c.name, fields: c.fields })

// Resolve the Memory module project + a key→collectionId map for a workspace.
async function resolveMemory(workspaceId?: string): Promise<{ wsId: string; projectId: string; byKey: Record<string, string> }> {
  let wsId = workspaceId
  if (!wsId) {
    // Default to the user's canonical Personal workspace (memory lives there,
    // the same across all their workspaces); fall back to the first visible one.
    const personal = (await api.workspaces.personal().catch(() => null)) as any
    if (personal?.id) wsId = String(personal.id)
    else {
      const list = (await api.workspaces.list()) as any[]
      if (!Array.isArray(list) || !list[0]?.id) throw new Error('No workspace visible for this API key — make sure you are using the key whose account OWNS your memory workspace (or pass workspaceId explicitly / call sinout_setup_memory).')
      wsId = String(list[0].id)
    }
  }
  const projects = (await api.projects.listByWorkspace(wsId)) as any[]
  const proj = projects.find((p) => p.moduleId === 'memory')
  if (!proj) throw new Error(`No memory module in workspace ${wsId} (this key sees ${projects.length} project(s)). Use the API key whose account owns the data, or call sinout_setup_memory.`)
  const cols = (await api.collections.listByProject(proj.id)) as any[]
  const byKey: Record<string, string> = {}
  for (const c of cols) byKey[c.key] = c.id
  return { wsId, projectId: proj.id, byKey }
}

const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])

const pageText = (content: unknown): string => {
  const parts: string[] = []
  const walk = (n: any) => { if (n?.type === 'text' && typeof n.text === 'string') parts.push(n.text); if (Array.isArray(n?.content)) n.content.forEach(walk) }
  walk(content); return parts.join('\n')
}

// Keyword-scan pages (recall covers collection records; pages are a separate model).
async function scanPages(wsId: string, memProjectId: string, scope: string, qTok: Set<string>, qLower: string): Promise<any[]> {
  const projIds = scope === 'all' ? ((await api.projects.listByWorkspace(wsId)) as any[]).map((p) => p.id) : [memProjectId]
  const metas: { id: string; title: string }[] = []
  for (const pid of projIds) {
    const list = (await api.pages.listByProject(pid)) as any[]
    for (const m of list) { metas.push({ id: m.id, title: m.title }); if (metas.length >= 25) break }
    if (metas.length >= 25) break
  }
  const hits: any[] = []
  for (const m of metas.slice(0, 25)) {
    const full = (await api.pages.getById(m.id)) as any
    const body = pageText(full.content)
    const text = `${m.title}\n${body}`.toLowerCase()
    let score = 0; for (const w of qTok) if (text.includes(w)) score++
    if (qLower && text.includes(qLower)) score += 2
    if (score > 0) hits.push({ kind: 'page', pageId: m.id, title: m.title, score, excerpt: body.slice(0, 300) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 5)
}

export function registerAgentTools(server: McpServer) {
  // Onboard: make sure this agent has its own memory workspace with the Memory module.
  server.tool(
    'sinout_setup_memory',
    'Ensure this agent has its own memory workspace with the Memory («Память») module installed. Creates a workspace if none exists and installs the module (idempotent). Call once at the start of a session. Returns workspaceId and the memory collections (core/facts/entities/episodes) with their field schema.',
    {
      workspaceId: z.string().optional().describe('Use this workspace (else first existing, else create one)'),
      name: z.string().optional().describe('Name for a new workspace if one must be created'),
    },
    async ({ workspaceId, name }) => {
      let wsId: string = workspaceId ?? ''
      if (!wsId) {
        const personal = (await api.workspaces.personal().catch(() => null)) as any
        if (personal?.id) wsId = String(personal.id)
        else {
          const list = (await api.workspaces.list()) as any[]
          wsId = Array.isArray(list) && list[0]?.id
            ? String(list[0].id)
            : String(((await api.workspaces.create({ name: name || 'Agent Memory' })) as any).id)
        }
      }
      let projects = (await api.projects.listByWorkspace(wsId)) as any[]
      if (!projects.some((p) => p.moduleId === 'memory')) {
        await api.modules.install(wsId, 'memory').catch(() => {})
        projects = (await api.projects.listByWorkspace(wsId)) as any[]
      }
      const memProj = projects.find((p) => p.moduleId === 'memory')
      const collections = memProj ? ((await api.collections.listByProject(memProj.id)) as any[]).map(slim) : []
      return ok({ workspaceId: wsId, memoryProjectId: memProj?.id, collections })
    },
  )

  // One-call bootstrap — self-provisioning. START HERE every session.
  server.tool(
    'sinout_init_agent',
    'START HERE. Bootstrap EVERYTHING in one call: ensures you have a memory workspace (creates one + installs the Memory module if you have none — works from scratch), then returns your workspace, all module projects with their collections (by NAME + field schema, so no hardcoded IDs), your memory Core (soul rules), recent facts, and whether semantic recall is active. Idempotent — safe to call at the start of every session instead of setup_memory + reading resources + recall separately.',
    {
      workspaceId: z.string().optional().describe('Use this workspace (else your first one, else a new one is created)'),
      agentName: z.string().optional().describe('Name for the workspace if one must be created (default "Agent memory")'),
    },
    async ({ workspaceId, agentName }) => {
      // 1. Ensure workspace. Default to the user's canonical Personal workspace
      // (memory lives there, shared across all their workspaces); else first
      // visible; else create from scratch.
      const list = (await api.workspaces.list()) as any[]
      let wsId = workspaceId ?? ''
      let wsName = ''
      if (!wsId) {
        const personal = (await api.workspaces.personal().catch(() => null)) as any
        const existing = personal?.id ? personal : (Array.isArray(list) ? list[0] : null)
        if (existing?.id) { wsId = String(existing.id); wsName = existing.name ?? '' }
        else { const c = (await api.workspaces.create({ name: agentName || 'Agent memory' })) as any; wsId = String(c.id); wsName = c.name }
      } else {
        wsName = (Array.isArray(list) ? list.find((w) => w.id === wsId)?.name : '') ?? ''
      }
      // 2. Ensure the Memory module is installed.
      let projects = (await api.projects.listByWorkspace(wsId)) as any[]
      if (!projects.some((p) => p.moduleId === 'memory')) {
        await api.modules.install(wsId, 'memory').catch(() => {})
        projects = (await api.projects.listByWorkspace(wsId)) as any[]
      }
      // 3. Projects + collections (by name), build memory key→id map.
      const byKey: Record<string, string> = {}
      const projOut: any[] = []
      for (const p of projects.filter((p) => p.isModule || p.moduleId)) {
        const cols = (await api.collections.listByProject(p.id)) as any[]
        if (p.moduleId === 'memory') for (const c of cols) byKey[c.key] = c.id
        projOut.push({ id: p.id, name: p.name, moduleId: p.moduleId, collections: cols.map(slim) })
      }
      // 4. Core (soul rules) + recent facts.
      let core: any[] = []
      let recentFacts: any[] = []
      if (byKey.core) core = ((await api.collections.records(byKey.core)) as any[]).map((r) => ({ key: r.data?.key, content: r.data?.content })).filter((x) => x.content)
      if (byKey.facts) recentFacts = ((await api.collections.records(byKey.facts)) as any[])
        .sort((a, b) => String(b.data?.date ?? b.createdAt).localeCompare(String(a.data?.date ?? a.createdAt)))
        .slice(0, 10)
        .map((r) => ({ id: r.id, text: r.data?.text, topic: r.data?.topic, importance: r.data?.importance }))
      // 5. Is semantic recall active? (entitlement/BYOK surface — recall reports it.)
      let embeddings = false
      const memCols = Object.values(byKey)
      if (memCols.length) { try { embeddings = !!((await api.collections.recall(wsId, 'init', memCols, 1)) as any)?.semantic } catch {} }

      return ok({
        workspace: { id: wsId, name: wsName },
        projects: projOut,
        core,
        recentFacts,
        embeddings,
        hints: `Write memories immediately: sinout_remember (kind fact|core|entity|episode). Recall before answering: sinout_recall. Bulk ops: sinout_create_records / sinout_delete_records. Distil episodes: sinout_consolidate_memory. ${embeddings ? 'Semantic recall is ACTIVE.' : 'Semantic recall is OFF — add an embeddings key in Settings → AI for semantic memory (keyword recall still works).'}`,
      })
    },
  )

  // Delegate to the built-in SinoutX assistant.
  server.tool(
    'sinout_ask_assistant',
    'Delegate a question or task to the built-in SinoutX assistant. It knows the workspace deeply and has 60+ tools (pages, tasks, search, modules/records, export to PDF/DOCX, Telegram, deep research). Use it for things it does better than you, or to act inside a workspace you share.',
    {
      question: z.string().describe('What to ask or instruct the assistant to do'),
      workspaceId: z.string().optional().describe('Workspace context'),
      projectId: z.string().optional().describe('Project context'),
    },
    async ({ question, workspaceId, projectId }) => {
      let text = ''
      try { text = await api.askAI(question, { workspaceId, projectId }) } catch (e) {
        return ok(`Built-in assistant error: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!text.trim()) {
        return ok('Built-in assistant returned no text. The target workspace likely has no AI provider configured — set one in Settings → AI (BYOK), or pass a workspaceId that already has a provider.')
      }
      return ok(text)
    },
  )

  // Low-friction capture — persist a memory in ONE call so nothing is lost.
  server.tool(
    'sinout_remember',
    'Persist a memory immediately and reliably (one call — no need to look up collections). Use this THE MOMENT something worth remembering appears; do not wait. kind: fact (default) | core (compact pinned context, UPSERTED by key — no duplicates) | entity | episode.',
    {
      content: z.string().describe('What to remember'),
      kind: z.enum(['fact', 'core', 'entity', 'episode']).default('fact').describe('Memory kind'),
      workspaceId: z.string().optional().describe('Workspace (else your first one)'),
      key: z.string().optional().describe('For kind=core: unique key (upsert overwrites the same key — no duplicate, no loss)'),
      topic: z.string().optional().describe('For kind=fact: topic/tag'),
      importance: z.enum(['low', 'medium', 'high']).optional().describe('For kind=fact'),
      name: z.string().optional().describe('For kind=entity: entity name'),
      type: z.string().optional().describe('For kind=entity: person|project|concept|place|org|other'),
    },
    async ({ content, kind, workspaceId, key, topic, importance, name, type }) => {
      const { byKey } = await resolveMemory(workspaceId)
      const now = new Date().toISOString()
      if (kind === 'core') {
        const cid = byKey['core']; if (!cid) throw new Error('core collection missing')
        const k = key || 'note'
        const recs = (await api.collections.records(cid)) as any[]
        const existing = recs.find((r) => r.data?.key === k)
        const data = { key: k, content, pinned: 'yes' }
        const saved = existing ? await api.collections.updateRecord(existing.id, data) : await api.collections.createRecord(cid, data)
        return ok({ saved: 'core', upsert: !!existing, record: saved })
      }
      if (kind === 'entity') {
        const cid = byKey['entities']; if (!cid) throw new Error('entities collection missing')
        return ok(await api.collections.createRecord(cid, { name: name || content.slice(0, 60), type: type || 'other', attributes: content }))
      }
      if (kind === 'episode') {
        const cid = byKey['episodes']; if (!cid) throw new Error('episodes collection missing')
        return ok(await api.collections.createRecord(cid, { when: now, event: content }))
      }
      const cid = byKey['facts']; if (!cid) throw new Error('facts collection missing')
      return ok(await api.collections.createRecord(cid, { text: content, topic, importance, date: now }))
    },
  )

  // Reliable recall — scans ALL memory collections and ranks, so nothing is forgotten.
  server.tool(
    'sinout_recall',
    'Reliable recall: scans ALL your memory collections (core/facts/entities/episodes) and ranks by relevance — so anything you stored is found, not forgotten. Call BEFORE answering anything that may depend on past context. scope=all also scans other modules (Finance/Medical Record/…).',
    {
      query: z.string().describe('What to recall'),
      workspaceId: z.string().optional(),
      scope: z.enum(['memory', 'all']).default('memory').describe('memory = your memory only; all = also other modules'),
      limit: z.number().default(10).describe('Max results'),
      since: z.string().optional().describe('ISO date (e.g. 2026-06-01) — only memories created on/after'),
      until: z.string().optional().describe('ISO date — only memories created on/before'),
      includePages: z.boolean().default(true).describe('Also scan pages you created (not just collection records)'),
    },
    async ({ query, workspaceId, scope, limit, since, until, includePages }) => {
      const { wsId, projectId, byKey } = await resolveMemory(workspaceId)
      const qTok = new Set(tokens(query)); const qLower = query.toLowerCase()
      const sinceT = since ? Date.parse(since) : NaN
      const untilT = until ? Date.parse(until) : NaN
      const inRange = (r: any) => { const t = Date.parse(r.createdAt ?? r.created_at ?? ''); if (!isNaN(sinceT) && t < sinceT) return false; if (!isNaN(untilT) && t > untilT) return false; return true }
      const targets: { collectionId: string; collectionKey: string }[] = Object.entries(byKey).map(([k, id]) => ({ collectionId: id, collectionKey: k }))
      if (scope === 'all') {
        const projects = (await api.projects.listByWorkspace(wsId)) as any[]
        for (const p of projects) {
          if (p.id === projectId || !(p.isModule || p.moduleId)) continue
          const cols = (await api.collections.listByProject(p.id)) as any[]
          for (const c of cols) targets.push({ collectionId: c.id, collectionKey: `${p.moduleId}:${c.key}` })
        }
      }
      const labelById = new Map(targets.map((t) => [t.collectionId, t.collectionKey]))

      // 1) Records — semantic first (when embeddings configured), keyword fallback.
      let recordResults: any[] = []
      try {
        const sem = (await api.collections.recall(wsId, query, targets.map((t) => t.collectionId), limit, since, until)) as { semantic: boolean; results: any[] }
        if (sem?.semantic && sem.results?.length) {
          recordResults = sem.results.map((r) => ({ collection: labelById.get(r.collectionId) ?? r.collectionId, recordId: r.recordId, data: r.data, score: r.score, via: 'semantic' }))
        }
      } catch { /* fall back to keyword */ }
      if (!recordResults.length) {
        const scored: any[] = []
        for (const t of targets) {
          const recs = (await api.collections.records(t.collectionId)) as any[]
          for (const r of recs) {
            if (!inRange(r)) continue
            const text = JSON.stringify(r.data ?? {}).toLowerCase()
            let score = 0; for (const w of qTok) if (text.includes(w)) score++
            if (qLower && text.includes(qLower)) score += 2
            scored.push({ collection: t.collectionKey, recordId: r.id, data: r.data, score })
          }
        }
        scored.sort((a, b) => b.score - a.score)
        const hits = scored.filter((s) => s.score > 0).slice(0, limit)
        recordResults = hits.length ? hits : scored.slice(0, Math.min(limit, 5)).map((s) => ({ ...s, note: 'no keyword match — showing most recent' }))
      }

      // 2) Pages — recall covers records; also surface pages the agent created.
      const pageHits = includePages ? await scanPages(wsId, projectId, scope, qTok, qLower).catch(() => []) : []

      return ok([...recordResults, ...pageHits])
    },
  )

  // Read a page together with all its nested children — deep context in one call.
  server.tool(
    'sinout_read_page_with_children',
    'Read a page together with ALL its nested child pages (full subtree) in one call — for deep context recall on a topic.',
    { pageId: z.string().describe('Root page ID') },
    async ({ pageId }) => {
      const page = (await api.pages.getById(pageId)) as any
      const tree = (await api.pages.getTree(page.projectId)) as any[]
      const ids: string[] = []
      const collect = (n: any) => { ids.push(n.id); (n.children ?? []).forEach(collect) }
      const find = (nodes: any[]): boolean => { for (const n of nodes) { if (n.id === pageId) { collect(n); return true } if (n.children && find(n.children)) return true } return false }
      find(tree)
      if (!ids.length) ids.push(pageId)
      const out: any[] = []
      for (const id of ids.slice(0, 50)) { const p = (await api.pages.getById(id)) as any; out.push({ id, title: p.title, text: pageText(p.content) }) }
      return ok(out)
    },
  )

  // Run memory consolidation now (episodes → durable facts/entities).
  server.tool(
    'sinout_consolidate_memory',
    'Consolidate memory NOW: distil fresh `episodes` into durable `facts`/`entities` (normally runs nightly at 04:00). Returns how many episodes were processed and facts/entities created — or a `skipped` reason (e.g. "AI provider error" = no chat model / no balance on this workspace). Use to flush episodes on demand or to diagnose why nightly consolidation produced nothing.',
    { workspaceId: z.string().optional().describe('Workspace (else your memory workspace)') },
    async ({ workspaceId }) => {
      const { wsId } = await resolveMemory(workspaceId)
      return ok(await api.collections.consolidate(wsId))
    },
  )
}

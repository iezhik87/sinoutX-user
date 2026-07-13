import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as api from '../client.js'

function extractText(doc: Record<string, unknown>): string {
  const parts: string[] = []
  function walk(node: Record<string, unknown>) {
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) {
      for (const c of node.content as Record<string, unknown>[]) walk(c)
    }
  }
  walk(doc)
  return parts.join('\n')
}

function renderTree(nodes: Record<string, unknown>[], indent = 0): string {
  return nodes
    .map((n) => {
      const prefix = '  '.repeat(indent) + (indent > 0 ? '└─ ' : '')
      const children = n.children as Record<string, unknown>[] | undefined
      const childStr = children?.length ? '\n' + renderTree(children, indent + 1) : ''
      return `${prefix}${n.title} (${n.id})${childStr}`
    })
    .join('\n')
}

const MEMORY_GUIDE = `# SinoutX как твоя память — руководство

SinoutX — твоя постоянная память и рабочее пространство. Подключился → действуй так.

## На входе сессии
1. \`sinout_setup_memory\` — гарантирует твой воркспейс + модуль «Память», вернёт реестры со схемой полей.
2. Прочитай Ядро: ресурс \`sinout://memory/{workspaceId}/core\` или \`sinout_recall\` по теме.

## Как устроена память (реестры модуля «Память»)
- **core (Ядро)** — компактный always-load контекст: кто ты, устойчивые предпочтения, указатели. Поля: key, content, pinned. Держи коротким.
- **facts (Факты)** — атомарные знания: text, topic, importance (low|medium|high), source, date.
- **entities (Сущности)** — знание о вещах: name, type (person|project|concept|place|org|other), attributes, notes.
- **episodes (Эпизоды)** — лог событий: when, event, refs.

## Чтобы НИЧЕГО не терять и не забывать
- **Сохраняй СРАЗУ**: \`sinout_remember(content, kind)\` — fact | core (key→upsert, без дублей) | entity | episode. Один вызов, не откладывай.
- **Перед ответом**: \`sinout_recall(query)\` — семантический поиск по всей памяти (если задан embeddings-ключ) с keyword-фолбэком. scope=all — заглянуть и в другие модули.

## Кросс-модульность
Другие модули (Финансы, Бюджет, Медкарта, будущие) видны через \`sinout_list_collections\` по workspaceId. Записал факт о деньгах → свяжи с записью модуля через \`sinout_create_link\` (sourceType=record). Читай их \`sinout_query_records\`.

## Ты не один
- Встроенный агент SinoutX (60+ тулов) — делегируй через \`sinout_ask_assistant\`.
- В общих воркспейсах могут работать другие агенты — уважай их данные, можно вести общий реестр «Agents» и связи через граф.

## Дисциплина
Ядро компактно; важное сохраняй немедленно; перед ответом — recall; не дублируй (ищи перед созданием).`

export function registerResources(server: McpServer) {
  // ─── sinout://memory/guide — how to use SinoutX as memory ────────────────────
  server.resource('memory-guide', 'sinout://memory/guide', async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: MEMORY_GUIDE }],
  }))

  // ─── sinout://memory/{workspaceId}/core — the agent's pinned Core memory ─────
  server.resource(
    'memory-core',
    new ResourceTemplate('sinout://memory/{workspaceId}/core', { list: undefined }),
    async (uri, { workspaceId }) => {
      const wsId = workspaceId as string
      const projects = (await api.projects.listByWorkspace(wsId)) as Record<string, unknown>[]
      const proj = projects.find((p) => p.moduleId === 'memory')
      if (!proj) return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: '_Memory module not installed — call sinout_setup_memory._' }] }
      const cols = (await api.collections.listByProject(proj.id as string)) as Record<string, unknown>[]
      const core = cols.find((c) => c.key === 'core')
      const recs = core ? ((await api.collections.records(core.id as string)) as Record<string, unknown>[]) : []
      const lines = ['# Core memory', ...recs.map((r) => { const d = (r.data ?? {}) as Record<string, unknown>; return `- **${d.key ?? ''}**: ${d.content ?? ''}` })]
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: recs.length ? lines.join('\n') : '# Core memory\n_empty — populate with sinout_remember(kind:"core")_' }] }
    },
  )

  // ─── sinout://workspace/{id}/overview ────────────────────────────────────────
  server.resource(
    'workspace-overview',
    new ResourceTemplate('sinout://workspace/{id}/overview', { list: undefined }),
    async (uri, { id }) => {
      const workspaceId = id as string

      const [ws, projectsData] = await Promise.all([
        api.workspaces.getById(workspaceId),
        api.projects.listByWorkspace(workspaceId),
      ])

      const text = [
        `# Workspace: ${ws.name}`,
        ws.description ? `\n${ws.description}` : '',
        `\n**ID:** ${ws.id}`,
        `**Projects:** ${projectsData.length}`,
        '',
        '## Projects',
        ...projectsData.map(
          (p: Record<string, unknown>) =>
            `- **${p.name}** (${p.status}) — ID: ${p.id}`,
        ),
      ].join('\n')

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // ─── sinout://project/{id}/structure ─────────────────────────────────────────
  server.resource(
    'project-structure',
    new ResourceTemplate('sinout://project/{id}/structure', { list: undefined }),
    async (uri, { id }) => {
      const projectId = id as string

      const [project, tree, analytics] = await Promise.all([
        api.projects.getById(projectId),
        api.pages.getTree(projectId),
        api.tasks.getAnalytics(projectId),
      ])

      const treeStr = renderTree(tree)
      const byStatus = analytics.byStatus as Record<string, unknown>[]

      const text = [
        `# Project: ${project.name}`,
        project.description ? `\n${project.description}` : '',
        `\n**Status:** ${project.status}`,
        '',
        '## Page Structure',
        treeStr || '_No pages_',
        '',
        '## Task Summary',
        ...(byStatus ?? []).map(
          (s: Record<string, unknown>) => `- ${s.status}: ${s._count}`,
        ),
      ].join('\n')

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // ─── sinout://page/{id}/content ──────────────────────────────────────────────
  server.resource(
    'page-content',
    new ResourceTemplate('sinout://page/{id}/content', { list: undefined }),
    async (uri, { id }) => {
      const pageId = id as string
      const page = await api.pages.getById(pageId)
      const content = page.content ? extractText(page.content) : '_Empty page_'

      const text = [
        `# ${page.title}`,
        '',
        content,
        '',
        `---`,
        `_ID: ${page.id} | Updated: ${page.updatedAt}_`,
      ].join('\n')

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // ─── sinout://project/{id}/tasks ─────────────────────────────────────────────
  server.resource(
    'project-tasks',
    new ResourceTemplate('sinout://project/{id}/tasks', { list: undefined }),
    async (uri, { id }) => {
      const projectId = id as string
      const data = await api.tasks.list({ projectId })
      const taskList = data.tasks ?? data

      const grouped = taskList.reduce((acc: Record<string, unknown[]>, t: Record<string, unknown>) => {
        const s = t.status as string
        if (!acc[s]) acc[s] = []
        acc[s].push(t)
        return acc
      }, {})

      const lines = ['# Tasks']
      for (const [status, items] of Object.entries(grouped)) {
        lines.push(`\n## ${status}`)
        for (const t of items as Record<string, unknown>[]) {
          const due = t.dueDate ? ` (due: ${new Date(t.dueDate as string).toLocaleDateString()})` : ''
          lines.push(`- [${t.priority}] ${t.title}${due} — ID: ${t.id}`)
        }
      }

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: lines.join('\n') }],
      }
    },
  )

  // ─── sinout://project/{id}/graph ─────────────────────────────────────────────
  server.resource(
    'project-graph',
    new ResourceTemplate('sinout://project/{id}/graph', { list: undefined }),
    async (uri, { id }) => {
      const projectId = id as string
      const graphData = await api.graph.get({ projectId })
      const { nodes, edges } = graphData

      const lines = [
        '# Knowledge Graph',
        `\n**Nodes:** ${nodes.length} | **Edges:** ${edges.length}`,
        '\n## Nodes',
        ...nodes.map((n: Record<string, unknown>) => `- [${n.type}] ${n.label} (${n.id})`),
        '\n## Connections',
        ...edges.map(
          (e: Record<string, unknown>) => `- ${e.sourceId} —[${e.linkType}]→ ${e.targetId}`,
        ),
      ]

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: lines.join('\n') }],
      }
    },
  )
}

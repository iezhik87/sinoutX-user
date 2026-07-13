import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
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
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function registerSearchTools(server: McpServer) {
  server.tool(
    'sinout_search',
    'Full-text search across pages, tasks, and notes',
    {
      query: z.string().min(1).describe('Search query'),
      workspaceId: z.string().optional().describe('Limit to workspace'),
      projectId: z.string().optional().describe('Limit to project'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Max results'),
    },
    async ({ query, workspaceId, projectId, limit }) => {
      const results = await api.search.query(query, { workspaceId, projectId, limit })
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_context',
    'Aggregate all relevant knowledge for a topic from a project. Returns matching pages (with content), tasks, and notes in one call. Use this as the first step when a coding agent needs context before implementing a feature or making decisions.',
    {
      query: z.string().min(1).describe('Topic or feature to look up (e.g. "authentication", "user profile", "payment flow")'),
      projectId: z.string().optional().describe('Project ID to scope context to (recommended for coding tasks)'),
      workspaceId: z.string().optional().describe('Workspace ID (used when projectId is not known)'),
      includeAllTasks: z.boolean().optional().default(false).describe('If true, also include all project tasks (not just search matches) to show full task board state'),
    },
    async ({ query, projectId, workspaceId, includeAllTasks }) => {
      const searchLimit = 15

      // Run search and optionally fetch all tasks in parallel
      const [searchResults, allTasks] = await Promise.all([
        api.search.query(query, { workspaceId, projectId, limit: searchLimit }),
        includeAllTasks && projectId ? api.tasks.list({ projectId }) : Promise.resolve(null),
      ])

      // Separate results by type
      const hits: Record<string, unknown>[] = Array.isArray(searchResults?.hits)
        ? searchResults.hits
        : Array.isArray(searchResults)
        ? searchResults
        : []

      const pageHits = hits.filter((h: Record<string, unknown>) => h.type === 'page' || h.index === 'pages')
      const taskHits = hits.filter((h: Record<string, unknown>) => h.type === 'task' || h.index === 'tasks')
      const noteHits = hits.filter((h: Record<string, unknown>) => h.type === 'note' || h.index === 'notes')

      // Fetch full page content for top page matches (up to 5)
      const topPageIds = pageHits.slice(0, 5).map((h: Record<string, unknown>) => h.id as string).filter(Boolean)
      const fullPages = await Promise.all(
        topPageIds.map((id) => api.pages.getById(id).catch(() => null)),
      )

      const pagesContext = fullPages
        .filter(Boolean)
        .map((p: Record<string, unknown> | null) => {
          if (!p) return null
          const text = p.content ? extractText(p.content as Record<string, unknown>) : ''
          return {
            id: p.id,
            title: p.title,
            projectId: p.projectId,
            updatedAt: p.updatedAt,
            excerpt: text.slice(0, 800) + (text.length > 800 ? '…' : ''),
          }
        })
        .filter(Boolean)

      // Build task context
      const tasksFromSearch = taskHits.map((h: Record<string, unknown>) => ({
        id: h.id,
        title: h.title,
        status: h.status,
        priority: h.priority,
        source: 'search',
      }))

      let allTasksContext: Record<string, unknown>[] = []
      if (allTasks) {
        const taskList: Record<string, unknown>[] = Array.isArray(allTasks?.data)
          ? allTasks.data
          : Array.isArray(allTasks)
          ? allTasks
          : []
        allTasksContext = taskList.map((t: Record<string, unknown>) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate ?? null,
          description: t.description ? extractText(t.description as Record<string, unknown>) : null,
        }))
      }

      const context = {
        query,
        projectId: projectId ?? null,
        summary: `Found ${pagesContext.length} relevant pages, ${tasksFromSearch.length} matching tasks, ${noteHits.length} notes`,
        pages: pagesContext,
        matchingTasks: tasksFromSearch,
        ...(allTasksContext.length > 0 ? { allProjectTasks: allTasksContext } : {}),
        notes: noteHits.slice(0, 5).map((h: Record<string, unknown>) => ({
          id: h.id,
          content: h.content ?? h.text ?? '',
          tags: h.tags ?? [],
        })),
        usage: 'Use the page excerpts above as knowledge context. Check matchingTasks for related work items. Call sinout_get_page for full content of any specific page.',
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_ask',
    'Ask Sinout\'s AI a question and get a synthesized answer using the knowledge base. Use this when sinout_get_context returns insufficient or unclear data, when you need to understand business logic, or when you need a decision recommendation based on project knowledge. The AI has access to all Sinout tools (search, pages, tasks, graph) and will research before answering.',
    {
      question: z.string().min(1).describe('The question to ask (in any language). Be specific: include feature name, component, or topic.'),
      projectId: z.string().optional().describe('Project ID to scope the AI\'s knowledge search'),
      workspaceId: z.string().optional().describe('Workspace ID'),
      projectName: z.string().optional().describe('Project name (helps AI understand context)'),
    },
    async ({ question, projectId, workspaceId, projectName }) => {
      const answer = await api.askAI(question, { workspaceId, projectId, projectName })
      return {
        content: [{ type: 'text', text: answer || '(No response from AI)' }],
      }
    },
  )

  server.tool(
    'sinout_get_graph',
    'Get knowledge graph nodes and edges for a workspace or project',
    {
      workspaceId: z.string().optional().describe('Workspace ID (returns full workspace graph)'),
      projectId: z.string().optional().describe('Project ID (returns project-scoped graph)'),
    },
    async ({ workspaceId, projectId }) => {
      const graphData = await api.graph.get({ workspaceId, projectId })
      const { nodes, edges } = graphData
      const summary = {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        nodeTypes: nodes.reduce((acc: Record<string, number>, n: Record<string, unknown>) => {
          const t = n.type as string
          acc[t] = (acc[t] ?? 0) + 1
          return acc
        }, {}),
        edgeTypes: edges.reduce((acc: Record<string, number>, e: Record<string, unknown>) => {
          const t = e.linkType as string
          acc[t] = (acc[t] ?? 0) + 1
          return acc
        }, {}),
        nodes,
        edges,
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_create_link',
    'Create a link between two entities — pages, tasks, notes, and module records/collections (use type "record" to connect a memory record to a Finance/Medical-Record record, "collection" for a whole реестр).',
    {
      sourceType: z.enum(['page', 'task', 'note', 'event', 'record', 'collection']).describe('Source entity type (record = a collection record, collection = a реестр)'),
      sourceId: z.string().describe('Source entity ID'),
      targetType: z.enum(['page', 'task', 'note', 'event', 'record', 'collection']).describe('Target entity type'),
      targetId: z.string().describe('Target entity ID'),
      linkType: z
        .enum(['REFERENCE', 'EMBED', 'DEPENDS_ON', 'BLOCKS', 'RELATED'])
        .default('RELATED')
        .describe('Type of relationship'),
    },
    async ({ sourceType, sourceId, targetType, targetId, linkType }) => {
      const link = await api.graph.createLink({ sourceType, sourceId, targetType, targetId, linkType })
      return {
        content: [{ type: 'text', text: JSON.stringify(link, null, 2) }],
      }
    },
  )
}

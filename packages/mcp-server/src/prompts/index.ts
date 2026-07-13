import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

export function registerPrompts(server: McpServer) {
  // ─── sinout_analyze_project ─────────────────────────────────────────────────
  server.prompt(
    'sinout_analyze_project',
    'Analyze a project: review pages, tasks, and provide insights',
    {
      projectId: z.string().describe('Project ID to analyze'),
    },
    async ({ projectId }) => {
      const [project, tree, analytics] = await Promise.all([
        api.projects.getById(projectId),
        api.pages.getTree(projectId),
        api.tasks.getAnalytics(projectId),
      ])

      const byStatus = analytics.byStatus ?? []
      const byPriority = analytics.byPriority ?? []
      const overdue = analytics.overdue ?? 0

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please analyze the following Sinout project and provide actionable insights:

## Project: ${project.name}
${project.description ? `Description: ${project.description}` : ''}
Status: ${project.status}

## Page Structure
${tree.length ? JSON.stringify(tree, null, 2) : 'No pages yet'}

## Task Analytics
By Status: ${JSON.stringify(byStatus)}
By Priority: ${JSON.stringify(byPriority)}
Overdue Tasks: ${overdue}

Please provide:
1. A brief summary of the project's current state
2. What's going well and what needs attention
3. Concrete next steps based on the task backlog
4. Any structural suggestions for the knowledge base`,
            },
          },
        ],
      }
    },
  )

  // ─── sinout_daily_summary ───────────────────────────────────────────────────
  server.prompt(
    'sinout_daily_summary',
    'Generate a daily summary of upcoming tasks and events for a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const [ws, upcomingEvents] = await Promise.all([
        api.workspaces.getById(workspaceId),
        api.calendar.getUpcoming(workspaceId, 10),
      ])

      const projectsData = await api.projects.listByWorkspace(workspaceId)

      const allTasks: unknown[] = []
      await Promise.all(
        projectsData.slice(0, 5).map(async (p: Record<string, unknown>) => {
          const data = await api.tasks.list({ projectId: p.id as string, status: 'IN_PROGRESS' })
          const tasks = data.tasks ?? data
          allTasks.push(...tasks.slice(0, 5))
        }),
      )

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a concise daily briefing for the workspace "${ws.name}":

## Upcoming Events (next 10)
${JSON.stringify(upcomingEvents, null, 2)}

## In-Progress Tasks (sample)
${JSON.stringify(allTasks, null, 2)}

## Projects
${projectsData.map((p: Record<string, unknown>) => `- ${p.name} (${p.status})`).join('\n')}

Please generate:
1. Today's focus: what needs attention right now
2. Upcoming deadlines and events (next 3 days)
3. In-progress work to continue
4. Brief motivational summary`,
            },
          },
        ],
      }
    },
  )

  // ─── sinout_brainstorm ──────────────────────────────────────────────────────
  server.prompt(
    'sinout_brainstorm',
    'Brainstorm ideas for a page or project topic using existing knowledge base',
    {
      topic: z.string().describe('Topic or question to brainstorm'),
      projectId: z.string().optional().describe('Optional: scope brainstorm to a specific project'),
      workspaceId: z.string().optional().describe('Optional: workspace ID for search context'),
    },
    async ({ topic, projectId, workspaceId }) => {
      const searchResults = await api.search.query(topic, {
        projectId,
        workspaceId,
        limit: 10,
      })

      const hits = (searchResults.results ?? [])
        .flatMap((r: Record<string, unknown>) => (r.hits as unknown[]) ?? [])
        .slice(0, 10)

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I want to brainstorm about: "${topic}"

Here's what I already have in my Sinout knowledge base related to this topic:
${hits.length > 0 ? JSON.stringify(hits, null, 2) : 'No existing content found.'}

Please help me:
1. Identify what I already know about this topic (from the search results)
2. Find gaps in my current knowledge base
3. Generate 5-10 new ideas or subtopics to explore
4. Suggest what pages/tasks I should create in Sinout to capture these ideas
5. Point out any connections to existing content I might have missed`,
            },
          },
        ],
      }
    },
  )

  // ─── sinout_write_page ──────────────────────────────────────────────────────
  server.prompt(
    'sinout_write_page',
    'Draft content for a new or existing page',
    {
      title: z.string().describe('Page title to write about'),
      context: z.string().optional().describe('Additional context or instructions'),
      projectId: z.string().optional().describe('Project ID for context search'),
    },
    async ({ title, context, projectId }) => {
      let relatedContent = ''
      if (projectId) {
        const results = await api.search.query(title, { projectId, limit: 5 })
        const hits = (results.results ?? []).flatMap((r: Record<string, unknown>) => r.hits ?? []).slice(0, 5)
        if (hits.length > 0) {
          relatedContent = `\n\nRelated existing content:\n${JSON.stringify(hits, null, 2)}`
        }
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please write a comprehensive page for my Sinout knowledge base.

**Page Title:** ${title}
${context ? `**Additional Context:** ${context}` : ''}
${relatedContent}

Requirements:
- Write in clear, well-structured markdown
- Include relevant sections with headings
- Be concise but thorough
- Include actionable items where appropriate
- Make it useful as a reference document`,
            },
          },
        ],
      }
    },
  )
}

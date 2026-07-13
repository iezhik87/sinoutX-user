import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

const TaskStatus = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])
const TaskPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

// Tasks belong to a project. Accept a workspaceId and route to a general project
// (created if none) so callers that only have a workspace can still create tasks.
async function resolveTaskProject(projectId?: string, workspaceId?: string): Promise<string> {
  if (projectId) return projectId
  if (!workspaceId) throw new Error('Provide projectId or workspaceId')
  const projects = (await api.projects.listByWorkspace(workspaceId)) as Record<string, unknown>[]
  const p = projects.find((x) => !x.isModule && !x.isSystem) ?? projects.find((x) => !x.isModule)
  if (p) return p.id as string
  return ((await api.projects.create({ workspaceId, name: 'Tasks' })) as Record<string, unknown>).id as string
}

// Accept common status/priority words and normalise to the backend enums.
const STATUS_MAP: Record<string, string> = {
  pending: 'TODO', todo: 'TODO', open: 'TODO', new: 'TODO', backlog: 'TODO',
  doing: 'IN_PROGRESS', in_progress: 'IN_PROGRESS', wip: 'IN_PROGRESS', started: 'IN_PROGRESS', active: 'IN_PROGRESS',
  review: 'IN_REVIEW', in_review: 'IN_REVIEW',
  done: 'DONE', completed: 'DONE', complete: 'DONE', closed: 'DONE', finished: 'DONE',
  cancelled: 'CANCELLED', canceled: 'CANCELLED',
}
const normStatus = (s?: string): string => {
  if (!s) return 'TODO'
  const u = s.toUpperCase()
  if (['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'].includes(u)) return u
  return STATUS_MAP[s.toLowerCase().replace(/[\s-]+/g, '_')] ?? 'TODO'
}
const PRIO_MAP: Record<string, string> = { low: 'LOW', med: 'MEDIUM', medium: 'MEDIUM', normal: 'MEDIUM', high: 'HIGH', urgent: 'URGENT', critical: 'URGENT' }
const normPriority = (p?: string): string => {
  if (!p) return 'MEDIUM'
  const u = p.toUpperCase()
  if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(u)) return u
  return PRIO_MAP[p.toLowerCase()] ?? 'MEDIUM'
}

export function registerTaskTools(server: McpServer) {
  server.tool(
    'sinout_list_tasks',
    'List tasks in a project with optional filters',
    {
      projectId: z.string().describe('Project ID'),
      status: z.string().optional().describe('Filter by status (todo|in_progress|in_review|done|cancelled; aliases accepted)'),
      priority: z.string().optional().describe('Filter by priority (low|medium|high|urgent)'),
      boardId: z.string().optional().describe('Filter by board ID'),
    },
    async ({ projectId, status, priority, boardId }) => {
      const data = await api.tasks.list({ projectId, status: status ? normStatus(status) : undefined, priority: priority ? normPriority(priority) : undefined, boardId })
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_task',
    'Get full task details by ID',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      const task = await api.tasks.getById(taskId)
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_create_task',
    'Create a task. Pass projectId, OR workspaceId (the task goes to a general project, created if none exists). Status accepts common words (pending, todo, in progress, done, completed…) and is normalised automatically.',
    {
      title: z.string().min(1).describe('Task title'),
      projectId: z.string().optional().describe('Project ID (or pass workspaceId)'),
      workspaceId: z.string().optional().describe('Workspace ID — task goes to a general project'),
      status: z.string().optional().describe('todo | in_progress | in_review | done | cancelled (aliases like pending/open/completed accepted)'),
      priority: z.string().optional().describe('low | medium | high | urgent'),
      startDate: z.string().optional().describe('Start date in ISO format (e.g. 2025-12-01)'),
      dueDate: z.string().optional().describe('Due date in ISO format (e.g. 2025-12-31)'),
      pageId: z.string().optional().describe('Link task to a page'),
    },
    async ({ title, projectId, workspaceId, status, priority, startDate, dueDate, pageId }) => {
      const pid = await resolveTaskProject(projectId, workspaceId)
      const task = await api.tasks.create({
        projectId: pid,
        title,
        status: normStatus(status),
        priority: normPriority(priority),
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        pageId,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_update_task',
    'Update task status, priority, title, due date, or implementation notes. Use implementationNotes to document what was built, decisions made, or code locations — this creates a permanent record in the task description visible in the Sinout UI.',
    {
      taskId: z.string().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      status: z.string().optional().describe('New status (todo|in_progress|in_review|done|cancelled; aliases accepted)'),
      priority: z.string().optional().describe('New priority (low|medium|high|urgent)'),
      startDate: z.string().optional().describe('New start date in ISO format'),
      dueDate: z.string().optional().describe('New due date in ISO format'),
      implementationNotes: z.string().optional().describe('Notes from a coding agent: what was implemented, file paths changed, decisions made, how to test. Written to the task description field — visible in Sinout UI.'),
    },
    async ({ taskId, title, status, priority, startDate, dueDate, implementationNotes }) => {
      const updates: Record<string, unknown> = {}
      if (title) updates.title = title
      if (status) updates.status = normStatus(status)
      if (priority) updates.priority = normPriority(priority)
      if (startDate) updates.startDate = new Date(startDate).toISOString()
      if (dueDate) updates.dueDate = new Date(dueDate).toISOString()
      if (implementationNotes) {
        // Convert plain text notes to TipTap doc format for the description field
        updates.description = {
          type: 'doc',
          content: implementationNotes
            .split('\n\n')
            .filter(Boolean)
            .map((para) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: para }],
            })),
        }
      }
      const task = await api.tasks.update(taskId, updates)
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_task_analytics',
    'Get task analytics for a project (count by status, priority, overdue)',
    {
      projectId: z.string().describe('Project ID'),
    },
    async ({ projectId }) => {
      const analytics = await api.tasks.getAnalytics(projectId)
      return {
        content: [{ type: 'text', text: JSON.stringify(analytics, null, 2) }],
      }
    },
  )
}

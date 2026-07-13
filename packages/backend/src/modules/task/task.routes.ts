import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { TaskService } from './task.service.js'
import { applyAutomations } from './automation.routes.js'
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
  taskParamsSchema,
} from './task.schema.js'
import { z } from 'zod'
import { fireWebhooks } from '../../lib/webhook.js'
import { denyIfNotMember, denyIfNoProjectAccess, getProjectWorkspaceId } from '../../lib/requireAccess.js'

export async function taskRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new TaskService(prisma)

  // GET /tasks?projectId=&status=&priority=&page=&limit=
  fastify.get('/tasks', async (req, reply) => {
    const query = listTasksQuerySchema.parse(req.query)
    if (query.projectId) {
      if (await denyIfNoProjectAccess(prisma, query.projectId, req.authUser!.id, reply)) return
    }
    return reply.send(await service.list(query))
  })

  // GET /tasks/:id
  fastify.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const { id } = taskParamsSchema.parse(req.params)
    const task = await service.getById(id)
    if (!task || task.isDeleted) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Task not found' })
    }
    if (await denyIfNoProjectAccess(prisma, task.projectId, req.authUser!.id, reply)) return
    return reply.send(task)
  })

  // POST /tasks
  fastify.post('/tasks', async (req, reply) => {
    const data = createTaskSchema.parse(req.body)
    const wsId = await getProjectWorkspaceId(prisma, data.projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNoProjectAccess(prisma, data.projectId, req.authUser!.id, reply, { write: true })) return
    const task = await service.create(data)
    applyAutomations(prisma, task.id, {}, true).catch(() => {})
    fireWebhooks(prisma, wsId, 'task.created', { id: task.id, title: task.title, status: task.status, projectId: task.projectId }).catch(() => null)
    return reply.status(201).send(task)
  })

  // PATCH /tasks/:id
  fastify.patch<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const { id } = taskParamsSchema.parse(req.params)

    // Load old values for activity logging + access check
    const old = await prisma.task.findUnique({
      where: { id },
      select: { status: true, priority: true, title: true, assignee: true, dueDate: true, projectId: true },
    })
    if (!old) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, old.projectId)
    if (await denyIfNoProjectAccess(prisma, old.projectId, req.authUser!.id, reply, { write: true })) return

    const data = updateTaskSchema.parse(req.body)
    const updated = await service.update(id, data)

    const activities: { action: string; oldValue: string | null; newValue: string | null }[] = []
    if (data.status !== undefined && data.status !== old.status)
      activities.push({ action: 'status_changed', oldValue: old.status, newValue: data.status })
    if (data.priority !== undefined && data.priority !== old.priority)
      activities.push({ action: 'priority_changed', oldValue: old.priority, newValue: data.priority })
    if (data.title !== undefined && data.title !== old.title)
      activities.push({ action: 'title_changed', oldValue: old.title, newValue: data.title })
    if (data.assignee !== undefined && data.assignee !== old.assignee)
      activities.push({ action: 'assignee_changed', oldValue: old.assignee ?? null, newValue: data.assignee ?? null })
    if (data.dueDate !== undefined) {
      const oldDue = old.dueDate?.toISOString().split('T')[0] ?? null
      const newDue = data.dueDate ? new Date(data.dueDate).toISOString().split('T')[0] : null
      if (oldDue !== newDue)
        activities.push({ action: 'due_date_changed', oldValue: oldDue, newValue: newDue })
    }
    if (activities.length > 0) {
      await prisma.taskActivity.createMany({
        data: activities.map((a) => ({ taskId: id, ...a })),
      })
    }

    // Apply automation rules (fire-and-forget — don't block response)
    const automationChanges: Record<string, unknown> = {}
    if (data.status !== undefined) automationChanges.status = data.status
    if (data.priority !== undefined) automationChanges.priority = data.priority
    if ('assignee' in data) automationChanges.assignee = data.assignee ?? null
    if (Object.keys(automationChanges).length > 0) {
      applyAutomations(prisma, id, automationChanges as any).catch(() => {})
    }

    if (wsId) {
      fireWebhooks(prisma, wsId, 'task.updated', { id: updated.id, title: updated.title, status: updated.status, projectId: updated.projectId }).catch(() => null)
    }

    return reply.send(updated)
  })

  // DELETE /tasks/:id (soft)
  fastify.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const { id } = taskParamsSchema.parse(req.params)
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true, title: true } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, task.projectId)
    if (await denyIfNoProjectAccess(prisma, task.projectId, req.authUser!.id, reply, { write: true })) return
    await service.delete(id)
    if (wsId) {
      fireWebhooks(prisma, wsId, 'task.deleted', { id, title: task.title, projectId: task.projectId }).catch(() => null)
    }
    return reply.status(204).send()
  })

  // POST /tasks/:id/move — переместить в другую колонку канбана
  fastify.post<{ Params: { id: string } }>('/tasks/:id/move', async (req, reply) => {
    const { id } = taskParamsSchema.parse(req.params)
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, task.projectId, req.authUser!.id, reply, { write: true })) return
    const { boardId, boardColumnId, position } = z
      .object({
        boardId: z.string().cuid(),
        boardColumnId: z.string(),
        position: z.number().int().min(0),
      })
      .parse(req.body)
    return reply.send(await service.moveToColumn(id, boardId, boardColumnId, position))
  })

  // POST /projects/:projectId/tasks/import — CSV import
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/tasks/import',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply, { write: true })) return
      const body = req.body as { rows: Record<string, string>[] }
      const rows = z.array(z.record(z.string())).parse(body.rows)

      const STATUS_MAP: Record<string, string> = {
        todo: 'TODO', 'to do': 'TODO', 'in progress': 'IN_PROGRESS', inprogress: 'IN_PROGRESS',
        review: 'REVIEW', done: 'DONE', completed: 'DONE', cancelled: 'CANCELLED', canceled: 'CANCELLED',
      }
      const PRIORITY_MAP: Record<string, string> = {
        low: 'LOW', medium: 'MEDIUM', normal: 'MEDIUM', high: 'HIGH', urgent: 'URGENT', critical: 'URGENT',
      }

      const pick = (row: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) {
          const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
          if (v !== undefined && v !== '') return v
        }
        return undefined
      }

      const created: string[] = []
      for (const row of rows) {
        const title = pick(row, 'title', 'name', 'task', 'Title', 'Name', 'Task')
        if (!title) continue

        const rawStatus = (pick(row, 'status', 'Status', 'state') ?? '').toLowerCase().replace(/[\s_-]/g, ' ').trim()
        const rawPriority = (pick(row, 'priority', 'Priority') ?? '').toLowerCase().trim()
        const rawDue = pick(row, 'dueDate', 'due_date', 'due', 'Due Date', 'deadline', 'Deadline')
        const rawStart = pick(row, 'startDate', 'start_date', 'start', 'Start Date')
        const assignee = pick(row, 'assignee', 'Assignee', 'assigned_to', 'owner')
        const description = pick(row, 'description', 'Description', 'notes', 'Notes', 'comment')

        const task = await prisma.task.create({
          data: {
            projectId,
            title,
            status: (STATUS_MAP[rawStatus] ?? 'TODO') as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED',
            priority: (PRIORITY_MAP[rawPriority] ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
            dueDate: rawDue ? new Date(rawDue) : null,
            startDate: rawStart ? new Date(rawStart) : null,
            assignee: assignee ?? null,
            description: description ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
            position: 0,
          },
        })
        created.push(task.id)
      }

      return reply.send({ imported: created.length })
    },
  )

  // GET /tasks/:id/activity
  fastify.get<{ Params: { id: string } }>('/tasks/:id/activity', async (req, reply) => {
    const { id } = taskParamsSchema.parse(req.params)
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, task.projectId, req.authUser!.id, reply)) return
    const activities = await prisma.taskActivity.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return reply.send(activities)
  })

  // GET /projects/:projectId/tasks/analytics
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/tasks/analytics',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return
      return reply.send(await service.getAnalytics(projectId))
    },
  )

  // GET /workspaces/:workspaceId/deadline-tracker
  fastify.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/deadline-tracker',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
      const now = new Date()
      const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      const tasks = await prisma.task.findMany({
        where: {
          isDeleted: false,
          status: { notIn: ['DONE', 'CANCELLED'] },
          dueDate: { lte: in30days },
          project: { workspaceId },
        },
        include: { project: { select: { id: true, name: true, color: true } } },
        orderBy: { dueDate: 'asc' },
      })
      const overdue = tasks.filter((t) => t.dueDate! < now)
      const today = tasks.filter((t) => t.dueDate! >= now && t.dueDate! < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
      const week = tasks.filter((t) => t.dueDate! >= new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) && t.dueDate! <= in7days)
      const later = tasks.filter((t) => t.dueDate! > in7days)
      return reply.send({ overdue, today, week, later })
    },
  )

  // GET /projects/:projectId/burndown
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/burndown',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return

      const tasks = await prisma.task.findMany({
        where: { projectId, isDeleted: false, parentTaskId: null },
        select: { createdAt: true, updatedAt: true, status: true },
        orderBy: { createdAt: 'asc' },
      })

      if (tasks.length === 0) return reply.send({ days: [], remaining: [], ideal: [] })

      const startDate = new Date(tasks[0].createdAt)
      startDate.setHours(0, 0, 0, 0)
      const today = new Date()
      today.setHours(23, 59, 59, 999)

      const totalDays = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / 86400000))
      const days: string[] = []
      const remaining: number[] = []
      const ideal: number[] = []

      for (let i = 0; i <= totalDays; i++) {
        const dayEnd = new Date(startDate.getTime() + i * 86400000)
        dayEnd.setHours(23, 59, 59, 999)

        const created = tasks.filter((t) => t.createdAt <= dayEnd).length
        const done = tasks.filter(
          (t) => (t.status === 'DONE' || t.status === 'CANCELLED') && t.updatedAt <= dayEnd,
        ).length

        days.push(dayEnd.toISOString().split('T')[0])
        remaining.push(Math.max(0, created - done))
        ideal.push(Math.round(tasks.length * (1 - i / totalDays)))
      }

      return reply.send({ days, remaining, ideal, total: tasks.length })
    },
  )
}

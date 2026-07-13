import { FastifyInstance } from 'fastify'
import { PrismaClient, AutomationRule } from '@prisma/client'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

const TRIGGERS = ['status_changed_to', 'priority_changed_to', 'task_created', 'task_assigned'] as const
const ACTIONS  = ['set_status', 'set_priority', 'set_due_today', 'add_tag', 'send_notification'] as const

const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  trigger: z.enum(TRIGGERS),
  triggerValue: z.string().max(100).optional().nullable(),
  action: z.enum(ACTIONS),
  actionValue: z.string().max(100).optional().nullable(),
})

export async function automationRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/automations',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      const wsId = await getProjectWorkspaceId(prisma, projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
      return prisma.automationRule.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
    },
  )

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/automations',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      const wsId = await getProjectWorkspaceId(prisma, projectId)
      if (!wsId) return reply.status(404).send({ error: 'Project not found' })
      if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
      const data = ruleSchema.parse(req.body)
      const rule = await prisma.automationRule.create({
        data: { id: randomUUID(), projectId, ...data, triggerValue: data.triggerValue ?? null, actionValue: data.actionValue ?? null },
      })
      return reply.status(201).send(rule)
    },
  )

  app.patch<{ Params: { id: string } }>('/automations/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const rule = await prisma.automationRule.findUnique({ where: { id }, select: { projectId: true } })
    if (!rule) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, rule.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const data = ruleSchema.partial().parse(req.body)
    return prisma.automationRule.update({ where: { id }, data })
  })

  app.delete<{ Params: { id: string } }>('/automations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const rule = await prisma.automationRule.findUnique({ where: { id }, select: { projectId: true } })
    if (!rule) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, rule.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.automationRule.delete({ where: { id } })
    return reply.status(204).send()
  })
}

// ─── Engine: apply rules after a task update ─────────────────────────────────

export async function applyAutomations(
  prisma: PrismaClient,
  taskId: string,
  changes: Partial<{ status: string; priority: string; assignee: string | null }>,
  isNew = false,
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true, status: true, priority: true, assignee: true } })
  if (!task) return

  const rules = await prisma.automationRule.findMany({
    where: { projectId: task.projectId, enabled: true },
  })

  const updates: Record<string, unknown> = {}

  for (const rule of rules) {
    if (!matchesTrigger(rule, changes, isNew)) continue

    switch (rule.action) {
      case 'set_status':
        if (rule.actionValue && rule.actionValue !== changes.status) updates.status = rule.actionValue
        break
      case 'set_priority':
        if (rule.actionValue && rule.actionValue !== changes.priority) updates.priority = rule.actionValue
        break
      case 'set_due_today':
        updates.dueDate = new Date()
        break
      case 'add_tag':
        break
      case 'send_notification':
        break
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.task.update({ where: { id: taskId }, data: updates })
  }
}

function matchesTrigger(
  rule: AutomationRule,
  changes: Partial<{ status: string; priority: string; assignee: string | null }>,
  isNew: boolean,
): boolean {
  switch (rule.trigger) {
    case 'task_created':
      return isNew
    case 'status_changed_to':
      return !!changes.status && changes.status === rule.triggerValue
    case 'priority_changed_to':
      return !!changes.priority && changes.priority === rule.triggerValue
    case 'task_assigned':
      return 'assignee' in changes && changes.assignee !== null
    default:
      return false
  }
}

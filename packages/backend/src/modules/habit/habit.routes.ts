import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { denyIfNotMember } from '../../lib/requireAccess.js'

export async function habitRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // List habits for workspace
  app.get<{ Params: { workspaceId: string }; Querystring: { includeArchived?: string } }>(
    '/workspaces/:workspaceId/habits',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
      const includeArchived = req.query.includeArchived === 'true'
      return prisma.habit.findMany({
        where: { workspaceId, archived: includeArchived ? undefined : false },
        include: { entries: { orderBy: { date: 'desc' }, take: 90 } },
        orderBy: { createdAt: 'asc' },
      })
    },
  )

  // Create habit
  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/habits', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const data = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      icon: z.string().max(8).optional(),
      color: z.string().max(20).optional(),
      period: z.enum(['forever', 'week', 'month', 'year']).optional().default('forever'),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body)

    const habit = await prisma.habit.create({
      data: { id: randomUUID(), workspaceId, ...data },
      include: { entries: true },
    })
    return reply.status(201).send(habit)
  })

  // Update habit
  app.patch<{ Params: { id: string } }>('/habits/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const habit = await prisma.habit.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!habit) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, habit.workspaceId, req.authUser!.id, reply)) return
    const data = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      icon: z.string().max(8).nullable().optional(),
      color: z.string().max(20).nullable().optional(),
      archived: z.boolean().optional(),
      period: z.enum(['forever', 'week', 'month', 'year']).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }).parse(req.body)
    return prisma.habit.update({
      where: { id },
      data,
      include: { entries: { orderBy: { date: 'desc' }, take: 90 } },
    })
  })

  // Delete habit
  app.delete<{ Params: { id: string } }>('/habits/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const habit = await prisma.habit.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!habit) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, habit.workspaceId, req.authUser!.id, reply)) return
    await prisma.habit.delete({ where: { id } })
    return reply.status(204).send()
  })

  // Toggle check-in for a date
  app.post<{ Params: { id: string; date: string } }>('/habits/:id/check/:date', async (req, reply) => {
    const { id, date } = z.object({ id: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params)
    const habit = await prisma.habit.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!habit) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, habit.workspaceId, req.authUser!.id, reply)) return
    const existing = await prisma.habitEntry.findUnique({ where: { habitId_date: { habitId: id, date } } })
    if (existing) {
      await prisma.habitEntry.delete({ where: { id: existing.id } })
      return reply.send({ checked: false, date })
    }
    const entry = await prisma.habitEntry.create({
      data: { id: randomUUID(), habitId: id, date },
    })
    return reply.status(201).send({ checked: true, date, entry })
  })

  // Habit stats: streak + 30-day completion
  app.get<{ Params: { id: string } }>('/habits/:id/stats', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const habit = await prisma.habit.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!habit) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, habit.workspaceId, req.authUser!.id, reply)) return
    const entries = await prisma.habitEntry.findMany({
      where: { habitId: id },
      orderBy: { date: 'desc' },
    })
    const dateSet = new Set(entries.map((e) => e.date))

    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      if (dateSet.has(ds)) streak++
      else if (i > 0) break
    }

    const last30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      return d.toISOString().slice(0, 10)
    })
    const completed30 = last30.filter((d) => dateSet.has(d)).length

    return { streak, completed30, total: entries.length, rate30: Math.round((completed30 / 30) * 100) }
  })
}

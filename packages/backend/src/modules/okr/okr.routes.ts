import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const objectiveInclude = {
  keyResults: { orderBy: { createdAt: 'asc' as const } },
}

export async function okrRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // List objectives for workspace
  app.get<{ Params: { workspaceId: string }; Querystring: { quarter?: string } }>(
    '/workspaces/:workspaceId/objectives',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
      const where = req.query.quarter
        ? { workspaceId, quarter: req.query.quarter }
        : { workspaceId }
      return prisma.objective.findMany({
        where,
        include: objectiveInclude,
        orderBy: [{ createdAt: 'desc' }],
      })
    },
  )

  // Create objective
  app.post<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/objectives',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
      const data = z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        quarter: z.string().optional().default(''),
        deadline: z.string().datetime({ offset: true }).optional(),
        progressMode: z.enum(['kr', 'time', 'manual']).optional().default('kr'),
        manualProgress: z.number().min(0).max(100).optional().default(0),
      }).parse(req.body)
      const obj = await prisma.objective.create({
        data: {
          id: randomUUID(),
          workspaceId,
          title: data.title,
          description: data.description,
          quarter: data.quarter,
          deadline: data.deadline ? new Date(data.deadline) : undefined,
          progressMode: data.progressMode,
          manualProgress: data.manualProgress,
        },
        include: objectiveInclude,
      })
      return reply.status(201).send(obj)
    },
  )

  // Update objective
  app.patch<{ Params: { id: string } }>('/objectives/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const obj = await prisma.objective.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!obj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, obj.workspaceId, req.authUser!.id, reply)) return
    const raw = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      quarter: z.string().optional(),
      status: z.enum(['active', 'completed', 'cancelled']).optional(),
      deadline: z.string().datetime({ offset: true }).nullable().optional(),
      progressMode: z.enum(['kr', 'time', 'manual']).optional(),
      manualProgress: z.number().min(0).max(100).optional(),
    }).parse(req.body)
    const data: Record<string, unknown> = { ...raw }
    if ('deadline' in raw) data.deadline = raw.deadline ? new Date(raw.deadline) : null
    return prisma.objective.update({ where: { id }, data, include: objectiveInclude })
  })

  // Delete objective
  app.delete<{ Params: { id: string } }>('/objectives/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const obj = await prisma.objective.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!obj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, obj.workspaceId, req.authUser!.id, reply)) return
    await prisma.objective.delete({ where: { id } })
    return reply.status(204).send()
  })

  // Create key result
  app.post<{ Params: { id: string } }>('/objectives/:id/key-results', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const obj = await prisma.objective.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!obj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, obj.workspaceId, req.authUser!.id, reply)) return
    const data = z.object({
      title: z.string().min(1).max(200),
      target: z.number().positive().optional().default(100),
      current: z.number().min(0).optional().default(0),
      unit: z.string().max(20).optional(),
    }).parse(req.body)
    const kr = await prisma.keyResult.create({
      data: { id: randomUUID(), objectiveId: id, ...data },
    })
    return reply.status(201).send(kr)
  })

  // Update key result
  app.patch<{ Params: { id: string } }>('/key-results/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const kr = await prisma.keyResult.findUnique({ where: { id }, select: { objective: { select: { workspaceId: true } } } })
    if (!kr) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, kr.objective.workspaceId, req.authUser!.id, reply)) return
    const data = z.object({
      title: z.string().min(1).max(200).optional(),
      target: z.number().positive().optional(),
      current: z.number().min(0).optional(),
      unit: z.string().max(20).nullable().optional(),
      status: z.enum(['active', 'completed', 'cancelled']).optional(),
    }).parse(req.body)
    return prisma.keyResult.update({ where: { id }, data })
  })

  // Delete key result
  app.delete<{ Params: { id: string } }>('/key-results/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const kr = await prisma.keyResult.findUnique({ where: { id }, select: { objective: { select: { workspaceId: true } } } })
    if (!kr) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, kr.objective.workspaceId, req.authUser!.id, reply)) return
    await prisma.keyResult.delete({ where: { id } })
    return reply.status(204).send()
  })
}

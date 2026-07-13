import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { BudgetService } from './budget.service.js'
import {
  createBudgetEntrySchema,
  updateBudgetEntrySchema,
  listBudgetQuerySchema,
  budgetParamsSchema,
} from './budget.schema.js'
import { z } from 'zod'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

export async function budgetRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new BudgetService(prisma)

  // GET /budget?projectId=&type=&from=&to=
  fastify.get('/budget', async (req, reply) => {
    const query = listBudgetQuerySchema.parse(req.query)
    if (query.workspaceId) {
      if (await denyIfNotMember(prisma, query.workspaceId, req.authUser!.id, reply)) return
    } else if (query.projectId) {
      const wsId = await getProjectWorkspaceId(prisma, query.projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    }
    return reply.send(await service.list(query))
  })

  // GET /budget/summary?projectId=&workspaceId=&from=&to=
  fastify.get('/budget/summary', async (req, reply) => {
    const query = z.object({
      projectId: z.string().cuid().optional(),
      workspaceId: z.string().cuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).parse(req.query)
    if (query.workspaceId) {
      if (await denyIfNotMember(prisma, query.workspaceId, req.authUser!.id, reply)) return
    } else if (query.projectId) {
      const wsId = await getProjectWorkspaceId(prisma, query.projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    }
    return reply.send(await service.getSummary(query))
  })

  // GET /projects/:projectId/budget/chart?year=2025
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/budget/chart',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      const wsId = await getProjectWorkspaceId(prisma, projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
      const { year } = z.object({ year: z.coerce.number().int().default(new Date().getFullYear()) }).parse(req.query)
      return reply.send(await service.getMonthlyChart(projectId, year))
    },
  )

  // GET /budget/:id
  fastify.get<{ Params: { id: string } }>('/budget/:id', async (req, reply) => {
    const { id } = budgetParamsSchema.parse(req.params)
    const entry = await service.getById(id)
    if (!entry) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Budget entry not found' })
    const wsId = await getProjectWorkspaceId(prisma, entry.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    return reply.send(entry)
  })

  // POST /budget
  fastify.post('/budget', async (req, reply) => {
    const data = createBudgetEntrySchema.parse(req.body)
    const wsId = await getProjectWorkspaceId(prisma, data.projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    return reply.status(201).send(await service.create(data))
  })

  // PATCH /budget/:id
  fastify.patch<{ Params: { id: string } }>('/budget/:id', async (req, reply) => {
    const { id } = budgetParamsSchema.parse(req.params)
    const entry = await prisma.budgetEntry.findUnique({ where: { id }, select: { projectId: true } })
    if (!entry) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, entry.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    return reply.send(await service.update(id, updateBudgetEntrySchema.parse(req.body)))
  })

  // DELETE /budget/:id
  fastify.delete<{ Params: { id: string } }>('/budget/:id', async (req, reply) => {
    const { id } = budgetParamsSchema.parse(req.params)
    const entry = await prisma.budgetEntry.findUnique({ where: { id }, select: { projectId: true } })
    if (!entry) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, entry.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await service.delete(id)
    return reply.status(204).send()
  })
}

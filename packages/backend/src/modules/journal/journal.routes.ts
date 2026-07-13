import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createAuthMiddleware } from '../../middleware/authenticate.js'

export async function journalRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const authenticate = createAuthMiddleware(prisma)

  // List entries for current user (optional month filter)
  app.get<{ Querystring: { month?: string } }>('/journal', { preHandler: authenticate }, async (req) => {
    const userId = req.authUser!.id
    const { month } = req.query
    const where = month
      ? { userId, date: { startsWith: month } }
      : { userId }
    return prisma.journalEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      select: { id: true, date: true, mood: true, updatedAt: true },
    })
  })

  // Get single entry by date
  app.get<{ Params: { date: string } }>('/journal/:date', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.authUser!.id
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params)
    const entry = await prisma.journalEntry.findUnique({
      where: { userId_date: { userId, date } },
    })
    if (!entry) return reply.status(404).send({ error: 'Not found' })
    return entry
  })

  // Upsert entry for a date
  app.put<{ Params: { date: string } }>('/journal/:date', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.authUser!.id
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params)
    const { content, mood } = z.object({
      content: z.record(z.unknown()),
      mood: z.string().max(20).optional().nullable(),
    }).parse(req.body)

    const entry = await prisma.journalEntry.upsert({
      where: { userId_date: { userId, date } },
      create: { id: randomUUID(), userId, date, content: content as object, mood: mood ?? null },
      update: { content: content as object, mood: mood ?? null },
    })
    return reply.status(200).send(entry)
  })

  // Delete entry
  app.delete<{ Params: { date: string } }>('/journal/:date', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.authUser!.id
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params)
    await prisma.journalEntry.deleteMany({ where: { userId, date } })
    return reply.status(204).send()
  })
}

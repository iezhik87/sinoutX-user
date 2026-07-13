import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { createAuthMiddleware } from '../../middleware/authenticate.js'
import { NotificationService } from './notification.service.js'

export async function notificationRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const authenticate = createAuthMiddleware(prisma)
  const service = new NotificationService(prisma)

  // GET /notifications?workspaceId=&limit=
  fastify.get('/notifications', { preHandler: authenticate }, async (req, reply) => {
    const { workspaceId, limit } = z.object({
      workspaceId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query)

    const userId = req.authUser!.id
    const [items, unread] = await Promise.all([
      service.list(userId, workspaceId, limit),
      service.unreadCount(userId, workspaceId),
    ])
    return reply.send({ items, unread })
  })

  // PATCH /notifications/:id/read
  fastify.patch<{ Params: { id: string } }>(
    '/notifications/:id/read',
    { preHandler: authenticate },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params)
      const notif = await prisma.notification.findUnique({ where: { id }, select: { userId: true } })
      if (!notif) return reply.status(404).send({ error: 'Not found' })
      if (notif.userId !== null && notif.userId !== req.authUser!.id) return reply.status(403).send({ error: 'Forbidden' })
      await service.markRead(id)
      return reply.status(204).send()
    },
  )

  // POST /notifications/read-all?workspaceId=
  fastify.post('/notifications/read-all', { preHandler: authenticate }, async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query)
    await service.markAllRead(req.authUser!.id, workspaceId)
    return reply.status(204).send()
  })

  // DELETE /notifications/:id
  fastify.delete<{ Params: { id: string } }>(
    '/notifications/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params)
      const notif = await prisma.notification.findUnique({ where: { id }, select: { userId: true } })
      if (!notif) return reply.status(404).send({ error: 'Not found' })
      if (notif.userId !== null && notif.userId !== req.authUser!.id) return reply.status(403).send({ error: 'Forbidden' })
      await service.delete(id)
      return reply.status(204).send()
    },
  )
}

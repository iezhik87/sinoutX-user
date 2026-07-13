import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

export async function auditRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /workspaces/:workspaceId/audit-log?limit=50&cursor=&action=
  app.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/audit-log',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.params)

      // Only OWNER or ADMIN can view audit logs
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: req.authUser!.id } },
        select: { role: true },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
      if (member.role === 'MEMBER') return reply.status(403).send({ error: 'Admin access required to view audit log' })

      const { limit = 50, cursor, action } = z.object({
        limit: z.coerce.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
        action: z.string().optional(),
      }).parse(req.query)

      const where: Record<string, unknown> = { workspaceId }
      if (action) where.action = action
      if (cursor) where.createdAt = { lt: new Date(cursor) }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      })

      const hasMore = logs.length > limit
      const items = hasMore ? logs.slice(0, limit) : logs
      const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

      return reply.send({ items, nextCursor, hasMore })
    },
  )
}

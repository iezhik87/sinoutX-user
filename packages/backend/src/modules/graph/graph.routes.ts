import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { GraphService } from './graph.service.js'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const linkTypeEnum = z.enum(['REFERENCE', 'EMBED', 'DEPENDS_ON', 'BLOCKS', 'RELATED'])

export async function graphRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new GraphService(prisma)

  // GET /graph?workspaceId=...&projectId=...
  fastify.get('/graph', async (req, reply) => {
    const query = z
      .object({
        workspaceId: z.string().cuid(),
        projectId: z.string().cuid().optional(),
        depth: z.coerce.number().int().min(1).max(5).default(2),
      })
      .parse(req.query)

    if (await denyIfNotMember(prisma, query.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await service.getGraph(query))
  })

  // GET /graph/node/:type/:id — связи конкретной ноды
  fastify.get<{ Params: { type: string; id: string } }>(
    '/graph/node/:type/:id',
    async (req, reply) => {
      const { type, id } = z
        .object({ type: z.string(), id: z.string().cuid() })
        .parse(req.params)
      return reply.send(await service.getNodeLinks(type, id))
    },
  )

  // POST /links — создать связь (workspaceId опционален — определяется из sourceId)
  fastify.post('/links', async (req, reply) => {
    const data = z
      .object({
        workspaceId: z.string().cuid().optional(),
        sourceType: z.string(),
        sourceId: z.string().cuid(),
        targetType: z.string(),
        targetId: z.string().cuid(),
        linkType: linkTypeEnum,
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(req.body)

    let workspaceId: string | null | undefined = data.workspaceId
    if (!workspaceId) {
      workspaceId = await service.resolveWorkspaceId(data.sourceType, data.sourceId)
    }
    if (!workspaceId) {
      return reply.status(400).send({ error: 'Cannot resolve workspaceId from source entity' })
    }

    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    return reply.status(201).send(await service.createLink({ ...data, workspaceId }))
  })

  // DELETE /links/:id
  fastify.delete<{ Params: { id: string } }>('/links/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params)
    const link = await prisma.link.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!link) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, link.workspaceId, req.authUser!.id, reply)) return
    await service.deleteLink(id)
    return reply.status(204).send()
  })
}

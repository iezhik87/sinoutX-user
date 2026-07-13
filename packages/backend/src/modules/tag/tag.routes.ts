import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const createTagSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function tagRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  // GET /tags?workspaceId=
  fastify.get<{ Querystring: { workspaceId: string } }>('/tags', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const tags = await prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    })
    return reply.send(tags)
  })

  // POST /tags
  fastify.post('/tags', async (req, reply) => {
    const data = createTagSchema.parse(req.body)
    if (await denyIfNotMember(prisma, data.workspaceId, req.authUser!.id, reply)) return
    const tag = await prisma.tag.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        color: data.color ?? '#6366f1',
      },
    })
    return reply.status(201).send(tag)
  })

  // PATCH /tags/:id
  fastify.patch<{ Params: { id: string } }>('/tags/:id', async (req, reply) => {
    const { id } = req.params
    const tag = await prisma.tag.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!tag) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, tag.workspaceId, req.authUser!.id, reply)) return
    const data = updateTagSchema.parse(req.body)
    return reply.send(await prisma.tag.update({ where: { id }, data }))
  })

  // DELETE /tags/:id
  fastify.delete<{ Params: { id: string } }>('/tags/:id', async (req, reply) => {
    const { id } = req.params
    const tag = await prisma.tag.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!tag) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, tag.workspaceId, req.authUser!.id, reply)) return
    await prisma.tag.delete({ where: { id } })
    return reply.status(204).send()
  })
}

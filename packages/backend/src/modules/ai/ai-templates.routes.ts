import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const createSchema = z.object({
  name:         z.string().min(1).max(200),
  description:  z.string().max(500).optional().default(''),
  icon:         z.string().optional().default('lucide:FolderKanban'),
  instructions: z.string().min(1),
})

const updateSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  description:  z.string().max(500).optional(),
  icon:         z.string().optional(),
  instructions: z.string().min(1).optional(),
})

export async function aiTemplateRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /ai/templates?workspaceId=xxx
  app.get('/ai/templates', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const templates = await prisma.aiProjectTemplate.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send(templates)
  })

  // POST /ai/templates
  app.post('/ai/templates', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const { workspaceId } = req.query as { workspaceId?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const template = await prisma.aiProjectTemplate.create({
      data: { workspaceId, ...body },
    })
    return reply.status(201).send(template)
  })

  // PATCH /ai/templates/:id
  app.patch('/ai/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const tmpl = await prisma.aiProjectTemplate.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!tmpl) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, tmpl.workspaceId, req.authUser!.id, reply)) return
    const body = updateSchema.parse(req.body)
    const template = await prisma.aiProjectTemplate.update({ where: { id }, data: body })
    return reply.send(template)
  })

  // DELETE /ai/templates/:id
  app.delete('/ai/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const tmpl = await prisma.aiProjectTemplate.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!tmpl) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, tmpl.workspaceId, req.authUser!.id, reply)) return
    await prisma.aiProjectTemplate.delete({ where: { id } })
    return reply.status(204).send()
  })
}

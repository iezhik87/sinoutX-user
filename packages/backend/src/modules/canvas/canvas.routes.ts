import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
  width: z.number().optional(),
  height: z.number().optional(),
  selected: z.boolean().optional(),
}).passthrough()

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  label: z.string().optional(),
  style: z.record(z.unknown()).optional(),
}).passthrough()

const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
})

export async function canvasRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // List canvases for workspace
  app.get('/canvas', async (req, reply) => {
    const workspaceId = (req.query as Record<string, string>).workspaceId
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return

    const canvases = await prisma.canvas.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, updatedAt: true },
    })
    return reply.send(canvases)
  })

  // Get single canvas
  app.get('/canvas/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const canvas = await prisma.canvas.findUnique({ where: { id } })
    if (!canvas) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, canvas.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(canvas)
  })

  // Create canvas
  app.post('/canvas', async (req, reply) => {
    const body = req.body as { workspaceId: string; name?: string }
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, body.workspaceId, req.authUser!.id, reply)) return

    const canvas = await prisma.canvas.create({
      data: {
        workspaceId: body.workspaceId,
        name: body.name ?? 'Моя доска',
      },
    })
    return reply.status(201).send(canvas)
  })

  // Update canvas (nodes, edges, viewport, name)
  app.patch('/canvas/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const canvas = await prisma.canvas.findUnique({ where: { id } })
    if (!canvas) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, canvas.workspaceId, req.authUser!.id, reply)) return

    const body = req.body as {
      name?: string
      nodes?: unknown[]
      edges?: unknown[]
      viewport?: { x: number; y: number; zoom: number }
    }

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.nodes !== undefined) {
      updateData.nodes = z.array(NodeSchema.passthrough()).parse(body.nodes)
    }
    if (body.edges !== undefined) {
      updateData.edges = z.array(EdgeSchema.passthrough()).parse(body.edges)
    }
    if (body.viewport !== undefined) {
      updateData.viewport = ViewportSchema.parse(body.viewport)
    }

    const updated = await prisma.canvas.update({ where: { id }, data: updateData })
    return reply.send(updated)
  })

  // Delete canvas
  app.delete('/canvas/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const canvas = await prisma.canvas.findUnique({ where: { id } })
    if (!canvas) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, canvas.workspaceId, req.authUser!.id, reply)) return
    await prisma.canvas.delete({ where: { id } })
    return reply.status(204).send()
  })
}

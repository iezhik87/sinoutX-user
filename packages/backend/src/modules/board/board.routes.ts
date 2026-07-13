import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { BoardService } from './board.service.js'
import { createBoardSchema, updateBoardSchema, boardParamsSchema } from './board.schema.js'
import { z } from 'zod'
import { denyIfNoProjectAccess } from '../../lib/requireAccess.js'

export async function boardRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new BoardService(prisma)

  // GET /projects/:projectId/boards
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/boards',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return
      return reply.send(await service.listByProject(projectId))
    },
  )

  // GET /boards/:id — с задачами по колонкам
  fastify.get<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const { id } = boardParamsSchema.parse(req.params)
    const board = await service.getById(id)
    if (!board) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    }
    if (await denyIfNoProjectAccess(prisma, board.projectId, req.authUser!.id, reply)) return
    return reply.send(board)
  })

  // POST /boards
  fastify.post('/boards', async (req, reply) => {
    const data = createBoardSchema.parse(req.body)
    if (await denyIfNoProjectAccess(prisma, data.projectId, req.authUser!.id, reply, { write: true })) return
    return reply.status(201).send(await service.create(data))
  })

  // PATCH /boards/:id
  fastify.patch<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const { id } = boardParamsSchema.parse(req.params)
    const board = await prisma.board.findUnique({ where: { id }, select: { projectId: true } })
    if (!board) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, board.projectId, req.authUser!.id, reply, { write: true })) return
    const data = updateBoardSchema.parse(req.body)
    return reply.send(await service.update(id, data))
  })

  // DELETE /boards/:id
  fastify.delete<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const { id } = boardParamsSchema.parse(req.params)
    const board = await prisma.board.findUnique({ where: { id }, select: { projectId: true } })
    if (!board) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, board.projectId, req.authUser!.id, reply, { write: true })) return
    await service.delete(id)
    return reply.status(204).send()
  })

  // POST /boards/:id/columns/:columnId/reorder
  fastify.post<{ Params: { id: string; columnId: string } }>(
    '/boards/:id/columns/:columnId/reorder',
    async (req, reply) => {
      const { id, columnId } = z
        .object({ id: z.string().cuid(), columnId: z.string() })
        .parse(req.params)
      const board = await prisma.board.findUnique({ where: { id }, select: { projectId: true } })
      if (!board) return reply.status(404).send({ error: 'Not found' })
      if (await denyIfNoProjectAccess(prisma, board.projectId, req.authUser!.id, reply, { write: true })) return
      const { taskIds } = z.object({ taskIds: z.array(z.string().cuid()) }).parse(req.body)
      await service.reorderColumn(id, columnId, taskIds)
      return reply.status(204).send()
    },
  )
}

import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { SearchService } from './search.service.js'
import { z } from 'zod'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  workspaceId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
  types: z
    .string()
    .optional()
    .transform((v) => v?.split(',').filter(Boolean) as ('page' | 'task' | 'note')[] | undefined),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function searchRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new SearchService(prisma)

  // GET /search?q=...&workspaceId=...&projectId=...&types=page,task
  fastify.get('/search', async (req, reply) => {
    const { q, workspaceId, projectId, types, limit } = searchQuerySchema.parse(req.query)

    const resolvedWsId = workspaceId ?? (projectId ? await getProjectWorkspaceId(prisma, projectId) : undefined)
    if (!resolvedWsId) return reply.status(400).send({ error: 'workspaceId or projectId required' })
    if (await denyIfNotMember(prisma, resolvedWsId, req.authUser!.id, reply, { allowViewer: true })) return

    const results = await service.search(q, { workspaceId, projectId, types, limit })
    return reply.send(results)
  })

  // POST /search/reindex — полная переиндексация (только OWNER/ADMIN)
  fastify.post('/search/reindex', async (req, reply) => {
    const role = req.authUser?.role
    if (role !== 'OWNER' && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' })
    }
    const counts = await service.reindexAll()
    return reply.send({ ok: true, indexed: counts })
  })

  // POST /search/index/page/:id — индексировать одну страницу
  fastify.post<{ Params: { id: string } }>('/search/index/page/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params)
    const page = await prisma.page.findUnique({ where: { id }, select: { project: { select: { workspaceId: true } } } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, page.project.workspaceId, req.authUser!.id, reply)) return
    await service.indexPage(id)
    return reply.status(204).send()
  })

  // POST /search/index/task/:id — индексировать одну задачу
  fastify.post<{ Params: { id: string } }>('/search/index/task/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params)
    const task = await prisma.task.findUnique({ where: { id }, select: { project: { select: { workspaceId: true } } } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, task.project.workspaceId, req.authUser!.id, reply)) return
    await service.indexTask(id)
    return reply.status(204).send()
  })
}

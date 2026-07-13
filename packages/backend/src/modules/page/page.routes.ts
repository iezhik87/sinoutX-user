import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { PageService } from './page.service.js'
import { GraphService } from '../graph/graph.service.js'
import { createPageSchema, updatePageSchema, pageParamsSchema } from './page.schema.js'
import { publish } from '../../lib/redis.js'
import { z } from 'zod'
import { denyIfNotMember, denyIfNoProjectAccess, getProjectWorkspaceId } from '../../lib/requireAccess.js'

export async function pageRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new PageService(prisma)
  const graphService = new GraphService(prisma)

  // GET /projects/:projectId/pages — плоский список
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/pages', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
    if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return
    return reply.send(await service.listByProject(projectId))
  })

  // GET /projects/:projectId/pages/tree — дерево для сайдбара
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/pages/tree', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
    if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return
    return reply.send(await service.getTree(projectId))
  })

  // GET /pages/:id — страница с контентом
  fastify.get<{ Params: { id: string } }>('/pages/:id', async (req, reply) => {
    const { id } = pageParamsSchema.parse(req.params)
    const page = await service.getById(id)
    if (!page || page.isDeleted) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Page not found' })
    }
    if (await denyIfNoProjectAccess(prisma, page.projectId, req.authUser!.id, reply)) return
    return reply.send(page)
  })

  // POST /pages
  fastify.post('/pages', async (req, reply) => {
    const data = createPageSchema.parse(req.body)
    const wsId = await getProjectWorkspaceId(prisma, data.projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNoProjectAccess(prisma, data.projectId, req.authUser!.id, reply, { write: true })) return
    const page = await service.create(data)
    publish({ type: 'page.created', workspaceId: wsId, projectId: page.projectId, pageId: page.id }).catch(() => null)
    return reply.status(201).send(page)
  })

  // PATCH /pages/:id
  fastify.patch<{ Params: { id: string } }>('/pages/:id', async (req, reply) => {
    const { id } = pageParamsSchema.parse(req.params)
    const existing = await prisma.page.findUnique({ where: { id }, select: { projectId: true } })
    if (!existing) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, existing.projectId)
    if (await denyIfNoProjectAccess(prisma, existing.projectId, req.authUser!.id, reply, { write: true })) return
    const data = updatePageSchema.parse(req.body)
    const page = await service.update(id, data)
    if (wsId) {
      publish({ type: 'page.updated', workspaceId: wsId, projectId: page.projectId, pageId: page.id }).catch(() => null)
    }
    if (data.content !== undefined) {
      graphService.syncContentLinks(id).catch(() => null)
    }
    return reply.send(page)
  })

  // GET /projects/:projectId/memory-page — найти или создать страницу AI-памяти
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/memory-page', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
    if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return

    // Prefer the page that AI tools already know about (aiMemoryPageId on project)
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { aiMemoryPageId: true },
    })

    if (project?.aiMemoryPageId) {
      const existing = await prisma.page.findUnique({
        where: { id: project.aiMemoryPageId, isDeleted: false },
      })
      if (existing) {
        // Ensure isMemory flag is set for consistency
        if (!existing.isMemory) {
          await prisma.page.update({ where: { id: existing.id }, data: { isMemory: true } })
        }
        return reply.send({ ...existing, isMemory: true })
      }
    }

    // Fallback: find by isMemory flag
    let page = await prisma.page.findFirst({
      where: { projectId, isMemory: true, isDeleted: false },
    })

    if (!page) {
      const lastPage = await prisma.page.findFirst({
        where: { projectId, parentPageId: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      page = await prisma.page.create({
        data: {
          projectId,
          title: 'AI Память',
          icon: 'lucide:BrainCircuit',
          isMemory: true,
          position: (lastPage?.position ?? -1) + 1,
          content: { type: 'doc', content: [] },
        },
      })
    }

    // Always sync aiMemoryPageId so AI tools know about this page
    await prisma.project.update({
      where: { id: projectId },
      data: { aiMemoryPageId: page.id },
    })

    return reply.send(page)
  })

  // GET /pages/recent?workspaceId=&limit=
  fastify.get('/pages/recent', async (req, reply) => {
    const { workspaceId, limit } = z.object({
      workspaceId: z.string().cuid(),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    const pages = await prisma.page.findMany({
      where: { project: { workspaceId }, isDeleted: false, type: 'PAGE' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, title: true, icon: true, updatedAt: true, projectId: true, project: { select: { name: true } } },
    })
    return reply.send(pages)
  })

  fastify.get<{ Params: { id: string } }>('/pages/:id/backlinks', async (req, reply) => {
    const { id } = pageParamsSchema.parse(req.params)
    const page = await prisma.page.findUnique({ where: { id }, select: { projectId: true } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, page.projectId, req.authUser!.id, reply)) return
    return reply.send(await graphService.getBacklinks(id))
  })

  // DELETE /pages/:id (soft delete)
  fastify.delete<{ Params: { id: string } }>('/pages/:id', async (req, reply) => {
    const { id } = pageParamsSchema.parse(req.params)
    const page = await prisma.page.findUnique({ where: { id }, select: { projectId: true } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, page.projectId, req.authUser!.id, reply, { write: true })) return
    await service.delete(id)
    return reply.status(204).send()
  })

  // POST /pages/:id/share — toggle public sharing, returns shareUrl
  fastify.post<{ Params: { id: string } }>('/pages/:id/share', async (req, reply) => {
    const { id } = pageParamsSchema.parse(req.params)
    const page = await prisma.page.findUnique({ where: { id }, select: { isPublic: true, publicToken: true, projectId: true } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, page.projectId, req.authUser!.id, reply, { write: true })) return

    if (page.isPublic) {
      await prisma.page.update({ where: { id }, data: { isPublic: false, publicToken: null } })
      return reply.send({ isPublic: false, publicToken: null })
    } else {
      const { randomBytes } = await import('node:crypto')
      const token = randomBytes(16).toString('hex')
      await prisma.page.update({ where: { id }, data: { isPublic: true, publicToken: token } })
      return reply.send({ isPublic: true, publicToken: token })
    }
  })

  // GET /share/:token — public page view (no auth required)
  fastify.get<{ Params: { token: string } }>('/share/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.params)
    const page = await prisma.page.findUnique({
      where: { publicToken: token },
      select: {
        id: true, title: true, icon: true, content: true, updatedAt: true,
        project: { select: { name: true } },
      },
    })
    if (!page) return reply.status(404).send({ error: 'Not found or not public' })
    return reply.send(page)
  })

  // POST /projects/:projectId/pages/reorder
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/pages/reorder',
    async (req, reply) => {
      const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
      if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply, { write: true })) return
      const { parentPageId, ids } = z
        .object({ parentPageId: z.string().cuid().nullable().default(null), ids: z.array(z.string().cuid()) })
        .parse(req.body)
      await service.reorder(projectId, parentPageId, ids)
      return reply.status(204).send()
    },
  )
}

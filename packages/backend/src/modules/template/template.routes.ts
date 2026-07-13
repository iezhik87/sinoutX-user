import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

const createTemplateSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.record(z.unknown()).optional(),
})

const createFromTemplateSchema = z.object({
  projectId: z.string(),
  title: z.string().optional(),
  parentPageId: z.string().optional(),
})

export async function templateRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // ── Page templates ────────────────────────────────────────────────────────

  // GET /templates/pages?workspaceId=xxx
  app.get('/templates/pages', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const templates = await prisma.page.findMany({
      where: { type: 'TEMPLATE', isDeleted: false, project: { workspaceId } },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return reply.send(templates)
  })

  // POST /templates/pages — save a page as template
  app.post('/templates/pages', async (req, reply) => {
    const body = createTemplateSchema.parse(req.body)
    const wsId = await getProjectWorkspaceId(prisma, body.projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const template = await prisma.page.create({
      data: {
        projectId: body.projectId,
        title: body.name,
        type: 'TEMPLATE',
        content: (body.content as object) ?? { type: 'doc', content: [] },
        position: 0,
      },
    })
    return reply.status(201).send(template)
  })

  // POST /templates/pages/:templateId/use — create a page from template
  app.post('/templates/pages/:templateId/use', async (req, reply) => {
    const { templateId } = req.params as { templateId: string }
    const body = createFromTemplateSchema.parse(req.body)

    // Check access to target project
    const wsId = await getProjectWorkspaceId(prisma, body.projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const template = await prisma.page.findUnique({
      where: { id: templateId, type: 'TEMPLATE', isDeleted: false },
    })
    if (!template) return reply.status(404).send({ error: 'Template not found' })

    const lastPage = await prisma.page.findFirst({
      where: { projectId: body.projectId, isDeleted: false },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const page = await prisma.page.create({
      data: {
        projectId: body.projectId,
        title: body.title ?? template.title,
        type: 'PAGE',
        content: template.content as object,
        parentPageId: body.parentPageId ?? null,
        position: (lastPage?.position ?? -1) + 1,
      },
    })
    return reply.status(201).send(page)
  })

  // PATCH /templates/pages/:id
  app.patch('/templates/pages/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const page = await prisma.page.findUnique({ where: { id }, select: { projectId: true } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, page.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const { title, description, icon } = req.body as { title?: string; description?: string; icon?: string }
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (icon !== undefined) data.icon = icon

    const updated = await prisma.page.update({
      where: { id, type: 'TEMPLATE', isDeleted: false },
      data,
      include: { project: { select: { id: true, name: true } } },
    })
    return reply.send(updated)
  })

  // DELETE /templates/pages/:id
  app.delete('/templates/pages/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const page = await prisma.page.findUnique({ where: { id }, select: { projectId: true } })
    if (!page) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, page.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    await prisma.page.update({ where: { id, type: 'TEMPLATE' }, data: { isDeleted: true } })
    return reply.status(204).send()
  })

  // ── Project templates ─────────────────────────────────────────────────────

  // GET /templates/projects?workspaceId=xxx
  app.get('/templates/projects', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const templates = await prisma.project.findMany({
      where: { workspaceId, status: 'TEMPLATE' },
      include: { _count: { select: { pages: true, tasks: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return reply.send(templates)
  })

  // POST /templates/projects/:templateId/use — create project from template
  app.post('/templates/projects/:templateId/use', async (req, reply) => {
    const { templateId } = req.params as { templateId: string }
    const { name, workspaceId } = req.body as { name: string; workspaceId: string }

    if (!name || !workspaceId) return reply.status(400).send({ error: 'name and workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const template = await prisma.project.findUnique({
      where: { id: templateId, status: 'TEMPLATE' },
      include: { pages: { where: { isDeleted: false }, orderBy: { position: 'asc' } } },
    })
    if (!template) return reply.status(404).send({ error: 'Template not found' })

    const lastProject = await prisma.project.findFirst({
      where: { workspaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const newProject = await prisma.project.create({
      data: {
        workspaceId,
        name,
        description: template.description,
        icon: template.icon,
        color: template.color,
        status: 'ACTIVE',
        position: (lastProject?.position ?? -1) + 1,
      },
    })

    const pageIdMap = new Map<string, string>()
    const topLevel = template.pages.filter((p) => !p.parentPageId)
    const children = template.pages.filter((p) => p.parentPageId)

    for (const page of topLevel) {
      const newPage = await prisma.page.create({
        data: { projectId: newProject.id, title: page.title, content: page.content as object, type: 'PAGE', position: page.position },
      })
      pageIdMap.set(page.id, newPage.id)
    }
    for (const page of children) {
      const newParentId = pageIdMap.get(page.parentPageId!)
      const newPage = await prisma.page.create({
        data: { projectId: newProject.id, title: page.title, content: page.content as object, type: 'PAGE', position: page.position, parentPageId: newParentId ?? null },
      })
      pageIdMap.set(page.id, newPage.id)
    }

    return reply.status(201).send({ ...newProject, pageCount: template.pages.length })
  })

  // POST /projects/:id/save-as-template
  app.post('/projects/:id/save-as-template', async (req, reply) => {
    const { id } = req.params as { id: string }
    const project = await prisma.project.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!project) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, project.workspaceId, req.authUser!.id, reply)) return
    const updated = await prisma.project.update({ where: { id }, data: { status: 'TEMPLATE' } })
    return reply.send(updated)
  })
}

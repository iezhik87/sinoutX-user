import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { sendCommentNotificationEmail, isEmailConfigured } from '../../lib/email.js'
import { fireWebhooks } from '../../lib/webhook.js'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

const commentBody = z.object({
  text: z.string().min(1).max(5000),
  author: z.string().max(100).optional(),
  parentId: z.string().optional().nullable(),
})

async function getTaskWorkspaceId(prisma: PrismaClient, taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
  if (!task) return null
  return getProjectWorkspaceId(prisma, task.projectId)
}

async function getPageWorkspaceId(prisma: PrismaClient, pageId: string): Promise<string | null> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { projectId: true } })
  if (!page) return null
  return getProjectWorkspaceId(prisma, page.projectId)
}

export async function commentRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  // ── Task comments ──────────────────────────────────────────────

  fastify.get<{ Params: { taskId: string } }>('/tasks/:taskId/comments', async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(req.params)
    const wsId = await getTaskWorkspaceId(prisma, taskId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return
    const comments = await prisma.comment.findMany({
      where: { taskId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    })
    return reply.send(comments)
  })

  fastify.post<{ Params: { taskId: string } }>('/tasks/:taskId/comments', async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(req.params)
    const wsId = await getTaskWorkspaceId(prisma, taskId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const { text, author, parentId } = commentBody.parse(req.body)
    const comment = await prisma.comment.create({
      data: { id: randomUUID(), taskId, text, author: author ?? null, parentId: parentId ?? null },
      include: { replies: true },
    })

    if (await isEmailConfigured(prisma)) {
      prisma.task.findUnique({
        where: { id: taskId },
        include: { project: { select: { name: true } } },
      }).then(async (task) => {
        if (!task?.assignee || task.assignee === author) return
        const user = await prisma.user.findFirst({
          where: { name: task.assignee, isActive: true, isVerified: true },
        })
        if (!user) return
        const prefs = (user.notificationPrefs as Record<string, boolean>) ?? {}
        if (prefs.taskComment === false) return
        const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
        await sendCommentNotificationEmail(user.email, {
          taskTitle: task.title,
          projectName: task.project?.name ?? '',
          commentAuthor: author ?? 'Кто-то',
          commentText: text.slice(0, 300),
          appUrl: settings?.appUrl ?? 'http://localhost:3012',
        }, prisma)
      }).catch(() => {})
    }

    if (wsId) {
      fireWebhooks(prisma, wsId, 'comment.created', { taskId, commentId: comment.id, author: comment.author, text: comment.text }).catch(() => null)
    }

    return reply.status(201).send(comment)
  })

  // ── Page comments ──────────────────────────────────────────────

  fastify.get<{ Params: { pageId: string } }>('/pages/:pageId/comments', async (req, reply) => {
    const { pageId } = z.object({ pageId: z.string() }).parse(req.params)
    const wsId = await getPageWorkspaceId(prisma, pageId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return
    const comments = await prisma.comment.findMany({
      where: { pageId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    })
    return reply.send(comments)
  })

  fastify.post<{ Params: { pageId: string } }>('/pages/:pageId/comments', async (req, reply) => {
    const { pageId } = z.object({ pageId: z.string() }).parse(req.params)
    const wsId = await getPageWorkspaceId(prisma, pageId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const { text, author, parentId } = commentBody.parse(req.body)
    const comment = await prisma.comment.create({
      data: { id: randomUUID(), pageId, text, author: author ?? null, parentId: parentId ?? null },
      include: { replies: true },
    })
    return reply.status(201).send(comment)
  })

  // ── Shared: edit / delete ──────────────────────────────────────

  fastify.patch<{ Params: { id: string } }>('/comments/:id', async (req, reply) => {
    const { id } = req.params
    const comment = await prisma.comment.findUnique({ where: { id }, select: { taskId: true, pageId: true } })
    if (!comment) return reply.status(404).send({ error: 'Not found' })
    const wsId = comment.taskId
      ? await getTaskWorkspaceId(prisma, comment.taskId)
      : comment.pageId ? await getPageWorkspaceId(prisma, comment.pageId) : null
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const { text } = z.object({ text: z.string().min(1).max(5000) }).parse(req.body)
    const updated = await prisma.comment.update({
      where: { id },
      data: { text },
      include: { replies: true },
    })
    return reply.send(updated)
  })

  fastify.delete<{ Params: { id: string } }>('/comments/:id', async (req, reply) => {
    const { id } = req.params
    const comment = await prisma.comment.findUnique({ where: { id }, select: { taskId: true, pageId: true } })
    if (!comment) return reply.status(404).send({ error: 'Not found' })
    const wsId = comment.taskId
      ? await getTaskWorkspaceId(prisma, comment.taskId)
      : comment.pageId ? await getPageWorkspaceId(prisma, comment.pageId) : null
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.comment.delete({ where: { id } })
    return reply.status(204).send()
  })
}

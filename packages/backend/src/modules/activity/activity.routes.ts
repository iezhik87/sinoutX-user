import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember } from '../../lib/requireAccess.js'

export async function activityRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /workspaces/:workspaceId/activity-feed?limit=60
  app.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/activity-feed',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
      const { limit = 60 } = z.object({ limit: z.coerce.number().min(10).max(200).optional() }).parse(req.query)

      const projectIds = await prisma.project
        .findMany({ where: { workspaceId }, select: { id: true } })
        .then((ps) => ps.map((p) => p.id))

      if (projectIds.length === 0) return reply.send([])

      const [taskActivities, recentPages, recentComments, habitEntries] = await Promise.all([
        prisma.taskActivity.findMany({
          where: { task: { projectId: { in: projectIds } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
          },
        }),
        prisma.page.findMany({
          where: { projectId: { in: projectIds }, isDeleted: false, isMemory: false },
          orderBy: { updatedAt: 'desc' },
          take: limit,
          select: {
            id: true, title: true, updatedAt: true,
            project: { select: { id: true, name: true } },
          },
        }),
        prisma.comment.findMany({
          where: {
            OR: [
              { task: { projectId: { in: projectIds } } },
              { page: { projectId: { in: projectIds } } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            task: { select: { id: true, title: true } },
            page: { select: { id: true, title: true } },
          },
        }),
        prisma.habitEntry.findMany({
          where: { habit: { workspaceId } },
          orderBy: { date: 'desc' },
          take: limit,
          include: { habit: { select: { id: true, name: true, icon: true } } },
        }),
      ])

      type FeedItem = { id: string; type: string; ts: string; [key: string]: unknown }
      const feed: FeedItem[] = []

      for (const a of taskActivities) {
        feed.push({
          id: `ta-${a.id}`, type: 'task_activity', ts: a.createdAt.toISOString(),
          action: a.action, oldValue: a.oldValue, newValue: a.newValue, actor: a.actor,
          taskId: a.task.id, taskTitle: a.task.title,
          projectId: a.task.project.id, projectName: a.task.project.name,
        })
      }
      for (const p of recentPages) {
        feed.push({
          id: `pg-${p.id}`, type: 'page_updated', ts: p.updatedAt.toISOString(),
          pageId: p.id, pageTitle: p.title || 'Без названия',
          projectId: p.project.id, projectName: p.project.name,
        })
      }
      for (const c of recentComments) {
        feed.push({
          id: `cm-${c.id}`, type: 'comment', ts: c.createdAt.toISOString(),
          author: c.author, text: c.text.slice(0, 200),
          taskId: c.task?.id ?? null, taskTitle: c.task?.title ?? null,
          pageId: c.page?.id ?? null, pageTitle: c.page?.title ?? null,
        })
      }
      for (const h of habitEntries) {
        feed.push({
          id: `he-${h.id}`, type: 'habit_check', ts: new Date(h.date).toISOString(),
          habitId: h.habit.id, habitName: h.habit.name, habitIcon: h.habit.icon, date: h.date,
        })
      }

      feed.sort((a, b) => b.ts.localeCompare(a.ts))
      return reply.send(feed.slice(0, limit))
    },
  )
}

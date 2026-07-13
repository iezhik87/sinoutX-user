import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

async function getTaskWsId(prisma: PrismaClient, taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
  if (!task) return null
  return getProjectWorkspaceId(prisma, task.projectId)
}

export async function timeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // Start timer
  app.post<{ Params: { id: string } }>('/tasks/:id/time/start', async (req, reply) => {
    const taskId = req.params.id
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, task.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const running = await prisma.timeEntry.findFirst({ where: { taskId, stoppedAt: null } })
    if (running) {
      const now = new Date()
      await prisma.timeEntry.update({
        where: { id: running.id },
        data: { stoppedAt: now, durationSec: Math.round((now.getTime() - running.startedAt.getTime()) / 1000) },
      })
    }

    const entry = await prisma.timeEntry.create({
      data: { id: randomUUID(), taskId, startedAt: new Date() },
    })
    return entry
  })

  // Stop timer
  app.post<{ Params: { id: string } }>('/tasks/:id/time/stop', async (req, reply) => {
    const taskId = req.params.id
    const wsId = await getTaskWsId(prisma, taskId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const running = await prisma.timeEntry.findFirst({
      where: { taskId, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    })
    if (!running) return reply.status(404).send({ error: 'No running timer' })

    const now = new Date()
    const entry = await prisma.timeEntry.update({
      where: { id: running.id },
      data: { stoppedAt: now, durationSec: Math.round((now.getTime() - running.startedAt.getTime()) / 1000) },
    })
    return entry
  })

  // List time entries for a task
  app.get<{ Params: { id: string } }>('/tasks/:id/time', async (req, reply) => {
    const taskId = req.params.id
    const wsId = await getTaskWsId(prisma, taskId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const entries = await prisma.timeEntry.findMany({
      where: { taskId },
      orderBy: { startedAt: 'desc' },
    })
    const totalSec = entries.reduce((s, e) => s + (e.durationSec ?? 0), 0)
    const running = entries.find((e) => !e.stoppedAt) ?? null
    return { entries, totalSec, running }
  })

  // Delete a time entry
  app.delete<{ Params: { id: string } }>('/time/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { taskId: true } })
    if (!entry) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getTaskWsId(prisma, entry.taskId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.timeEntry.delete({ where: { id } })
    return reply.status(204).send()
  })

  // Weekly time report for a project
  app.get<{ Params: { projectId: string }; Querystring: { weeks?: string } }>(
    '/projects/:projectId/time-report',
    async (req, reply) => {
      const wsId = await getProjectWorkspaceId(prisma, req.params.projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

      const weeks = parseInt(req.query.weeks ?? '4', 10)
      const since = new Date()
      since.setDate(since.getDate() - weeks * 7)

      const entries = await prisma.timeEntry.findMany({
        where: {
          task: { projectId: req.params.projectId },
          startedAt: { gte: since },
          stoppedAt: { not: null },
        },
        include: { task: { select: { id: true, title: true } } },
        orderBy: { startedAt: 'asc' },
      })

      const byDay: Record<string, number> = {}
      for (const e of entries) {
        const day = e.startedAt.toISOString().slice(0, 10)
        byDay[day] = (byDay[day] ?? 0) + (e.durationSec ?? 0)
      }

      const byTask: Record<string, { title: string; totalSec: number }> = {}
      for (const e of entries) {
        if (!byTask[e.taskId]) byTask[e.taskId] = { title: e.task.title, totalSec: 0 }
        byTask[e.taskId].totalSec += e.durationSec ?? 0
      }

      const totalSec = entries.reduce((s, e) => s + (e.durationSec ?? 0), 0)
      return { totalSec, byDay, byTask: Object.values(byTask).sort((a, b) => b.totalSec - a.totalSec) }
    },
  )
}

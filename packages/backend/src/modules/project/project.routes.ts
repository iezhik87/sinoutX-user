import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { ProjectService } from './project.service.js'
import {
  createProjectSchema,
  updateProjectSchema,
  projectParamsSchema,
} from './project.schema.js'
import { z } from 'zod'
import { denyIfNotMember, denyIfNoProjectAccess } from '../../lib/requireAccess.js'
import { writeAuditLog } from '../../lib/audit.js'
import { canShareProject, getWorkspaceOwner } from '../../lib/plans.js'
import { createInvite } from '../../lib/invites.js'
import { isSoloEdition } from '../../lib/edition.js'
import { sendInviteToRegisterEmail, sendInviteRevokedEmail, isEmailConfigured } from '../../lib/email.js'
import { config } from '../../config/index.js'

export async function projectRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new ProjectService(prisma)

  // GET /workspaces/:workspaceId/projects
  fastify.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/projects', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await service.listByWorkspace(workspaceId))
  })

  // GET /projects/:id
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const { id } = projectParamsSchema.parse(req.params)
    const project = await service.getById(id)
    if (!project) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Project not found' })
    }
    // Read access via workspace membership OR a project share.
    if (await denyIfNoProjectAccess(prisma, id, req.authUser!.id, reply)) return
    return reply.send(project)
  })

  // POST /projects
  fastify.post('/projects', async (req, reply) => {
    const data = createProjectSchema.parse(req.body)
    if (await denyIfNotMember(prisma, data.workspaceId, req.authUser!.id, reply)) return
    const project = await service.create(data)
    await writeAuditLog(prisma, { action: 'project.created', workspaceId: data.workspaceId, userId: req.authUser!.id, resourceType: 'project', resourceId: project.id, resourceName: project.name, ip: req.ip })
    return reply.status(201).send(project)
  })

  // PATCH /projects/:id
  fastify.patch<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const { id } = projectParamsSchema.parse(req.params)
    const project = await prisma.project.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!project) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Project not found' })
    if (await denyIfNotMember(prisma, project.workspaceId, req.authUser!.id, reply)) return
    const data = updateProjectSchema.parse(req.body)
    const updated = await service.update(id, data)
    await writeAuditLog(prisma, { action: 'project.updated', workspaceId: project.workspaceId, userId: req.authUser!.id, resourceType: 'project', resourceId: id, ip: req.ip })
    return reply.send(updated)
  })

  // DELETE /projects/:id
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const { id } = projectParamsSchema.parse(req.params)
    const exists = await prisma.project.findUnique({ where: { id }, select: { id: true, workspaceId: true } })
    if (!exists) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, exists.workspaceId, req.authUser!.id, reply)) return
    await writeAuditLog(prisma, { action: 'project.deleted', workspaceId: exists.workspaceId, userId: req.authUser!.id, resourceType: 'project', resourceId: id, ip: req.ip })
    await service.delete(id)
    return reply.status(204).send()
  })

  // GET /workspaces/:workspaceId/dashboard — агрегированная статистика для главной страницы
  fastify.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/dashboard',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

      const [projectStats, overdueTasks, todayTasks] = await Promise.all([
        // Статистика задач по проектам (total + done)
        prisma.project.findMany({
          where: { workspaceId },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            _count: {
              select: {
                tasks: { where: { isDeleted: false } },
              },
            },
          },
        }).then(async (projects) => {
          const doneCounts = await Promise.all(
            projects.map((p) =>
              prisma.task.count({ where: { projectId: p.id, status: 'DONE', isDeleted: false } }),
            ),
          )
          return projects.map((p, i) => ({
            id: p.id,
            totalTasks: p._count.tasks,
            doneTasks: doneCounts[i],
          }))
        }),
        // Просроченные задачи
        prisma.task.findMany({
          where: {
            project: { workspaceId },
            dueDate: { lt: todayStart },
            status: { notIn: ['DONE', 'CANCELLED'] },
            isDeleted: false,
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: { id: true, title: true, dueDate: true, priority: true, status: true, projectId: true },
        }),
        // Задачи на сегодня
        prisma.task.findMany({
          where: {
            project: { workspaceId },
            dueDate: { gte: todayStart, lt: todayEnd },
            status: { notIn: ['DONE', 'CANCELLED'] },
            isDeleted: false,
          },
          orderBy: { priority: 'desc' },
          take: 10,
          select: { id: true, title: true, dueDate: true, priority: true, status: true, projectId: true },
        }),
      ])

      return reply.send({ projectStats, overdueTasks, todayTasks })
    },
  )

  // POST /workspaces/:workspaceId/projects/reorder
  fastify.post<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/projects/reorder',
    async (req, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.params)
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
      const { ids } = z.object({ ids: z.array(z.string().cuid()) }).parse(req.body)
      await service.reorder(workspaceId, ids)
      return reply.status(204).send()
    },
  )

  // ── Project-level sharing (single-workspace collaboration) ──────────────────

  // GET /projects/shared — projects shared WITH the current user (not in their
  // own workspace). Registered as a static route (matched before /projects/:id).
  fastify.get('/projects/shared', async (req, reply) => {
    const memberships = await prisma.projectMember.findMany({
      where: { userId: req.authUser!.id },
      select: {
        role: true,
        project: {
          select: {
            id: true, name: true, icon: true, color: true, status: true, isModule: true, moduleId: true,
            workspace: { select: { id: true, name: true, members: { where: { role: 'OWNER' }, select: { user: { select: { name: true, email: true } } }, take: 1 } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(memberships.map((m) => ({
      ...m.project,
      myRole: m.role,
      sharedBy: m.project.workspace.members[0]?.user ?? null,
    })))
  })

  // GET /people — каждый, у кого есть доступ хоть к одному моему проекту, и к
  // каким именно. Собирается из тех же ProjectMember, что и шаринг на проекте:
  // это второй ВИД на один доступ, а не второй механизм. Плюс приглашения,
  // которые ещё никто не принял, — иначе позвавший не видит, что позвал.
  fastify.get('/people', async (req, reply) => {
    const me = req.authUser!.id
    const mine = await prisma.project.findMany({
      where: { workspace: { members: { some: { userId: me, role: 'OWNER' } } } },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { createdAt: 'asc' },
    })
    const ids = mine.map((p) => p.id)

    const grants = ids.length
      ? await prisma.projectMember.findMany({
          where: { projectId: { in: ids } },
          select: { projectId: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : []

    const byUser = new Map<string, { userId: string; name: string; email: string; since: Date; access: { projectId: string; role: string }[] }>()
    for (const g of grants) {
      let rec = byUser.get(g.userId)
      if (!rec) {
        rec = { userId: g.userId, name: g.user.name, email: g.user.email, since: g.createdAt, access: [] }
        byUser.set(g.userId, rec)
      }
      rec.access.push({ projectId: g.projectId, role: g.role })
      if (g.createdAt < rec.since) rec.since = g.createdAt
    }

    // Приглашения показываем только живые: принятое уже превратилось в доступ
    // выше, просроченное ни во что не превратится.
    const pending = await prisma.invite.findMany({
      where: { invitedBy: me, acceptedAt: null, expiresAt: { gt: new Date() }, projectId: { in: ids.length ? ids : ['-'] } },
      select: { id: true, email: true, projectId: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send({
      projects: mine,
      people: [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
      pending,
    })
  })

  // DELETE /people/invites/:id — отозвать приглашение, которое ещё не приняли.
  // Без этого опечатка в адресе живёт две недели и её нечем убрать.
  fastify.delete<{ Params: { id: string } }>('/people/invites/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    // Читаем до удаления: после него не из чего собрать письмо.
    const invite = await prisma.invite.findFirst({
      where: { id, invitedBy: req.authUser!.id, acceptedAt: null },
      select: { email: true, projectId: true },
    })
    if (!invite) return reply.status(404).send({ error: 'not_found' })
    await prisma.invite.delete({ where: { id } })

    // Первое письмо уже лежит у человека в почте, и ссылка в нём молча
    // перестала работать. Молчание тут читается как поломка.
    if (await isEmailConfigured(prisma)) {
      const [project, inviter] = await Promise.all([
        invite.projectId
          ? prisma.project.findUnique({ where: { id: invite.projectId }, select: { name: true } })
          : Promise.resolve(null),
        prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { name: true } }),
      ])
      sendInviteRevokedEmail(invite.email, {
        targetName: project?.name ?? 'SinoutX',
        inviterName: inviter?.name ?? 'Администратор',
      }, prisma).catch(() => {})
    }
    return reply.status(204).send()
  })

  // GET /projects/:id/members — who the project is shared with.
  fastify.get<{ Params: { id: string } }>('/projects/:id/members', async (req, reply) => {
    const { id } = projectParamsSchema.parse(req.params)
    if (await denyIfNoProjectAccess(prisma, id, req.authUser!.id, reply)) return
    const members = await prisma.projectMember.findMany({
      where: { projectId: id },
      select: { userId: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send(members)
  })

  // POST /projects/:id/share { email, role } — share with a user by email.
  fastify.post<{ Params: { id: string } }>('/projects/:id/share', async (req, reply) => {
    const { id } = projectParamsSchema.parse(req.params)
    const { email, role } = z.object({ email: z.string().email(), role: z.enum(['VIEWER', 'EDITOR']).default('EDITOR') }).parse(req.body)
    if (await denyIfNoProjectAccess(prisma, id, req.authUser!.id, reply, { write: true })) return
    const target = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } })
    const project = await prisma.project.findUnique({ where: { id }, select: { workspaceId: true, name: true } })

    // No account yet → invite. The seat is checked now so we do not promise what
    // cannot be delivered, and AGAIN at redemption so the promise cannot be
    // stretched by sending ten invites against one free seat.
    if (!target) {
      // В персональном издании регистрация закрыта после первого аккаунта, так
      // что приглашение выслать можно, а принять его — нельзя. Письмо с мёртвой
      // ссылкой хуже отказа: человек ждёт доступа, которого не будет.
      if (isSoloEdition()) {
        return reply.status(403).send({ error: 'solo_edition', message: 'This is a single-user edition: registration is closed, so an invitation cannot be accepted.' })
      }
      const owner = await getWorkspaceOwner(prisma, project!.workspaceId)
      if (owner) {
        const seat = await canShareProject(prisma, owner.id, '')
        if (!seat.ok) return reply.status(402).send({ error: 'plan_limit', resource: 'members', limit: seat.limit, current: seat.current })
      }
      const invite = await createInvite(prisma, email, req.authUser!.id, { projectId: id, role })
      const inviter = await prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { name: true } })
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
      if (await isEmailConfigured(prisma)) {
        sendInviteToRegisterEmail(email.toLowerCase(), {
          targetName: project!.name,
          inviterName: inviter?.name ?? 'Администратор',
          appUrl: settings?.appUrl ?? config.APP_URL ?? 'http://localhost:3012',
          token: invite.token,
        }, prisma).catch(() => {})
      }
      await writeAuditLog(prisma, { action: 'project.shared', workspaceId: project!.workspaceId, userId: req.authUser!.id, resourceType: 'project', resourceId: id, resourceName: `invite ${email}`, ip: req.ip })
      return reply.status(202).send({ invited: true, email, emailSent: await isEmailConfigured(prisma) })
    }

    // Don't create a redundant grant for someone already in the owning workspace.
    const alreadyWs = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project!.workspaceId, userId: target.id } }, select: { userId: true } })
    if (alreadyWs) return reply.status(409).send({ error: 'already_member', message: 'User already has access via the workspace' })
    // Collaboration paywall: on self-hosted, sharing beyond the plan's head count
    // needs a Team licence (free = solo). Free on a billing instance.
    const owner = await getWorkspaceOwner(prisma, project!.workspaceId)
    if (owner) {
      const gate = await canShareProject(prisma, owner.id, target.id)
      if (!gate.ok) return reply.status(402).send({ error: 'plan_limit', resource: 'members', limit: gate.limit, current: gate.current })
    }
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: target.id } },
      create: { projectId: id, userId: target.id, role },
      update: { role },
    })
    await writeAuditLog(prisma, { action: 'project.shared', workspaceId: project!.workspaceId, userId: req.authUser!.id, resourceType: 'project', resourceId: id, resourceName: project!.name, ip: req.ip })
    return reply.status(201).send(member)
  })

  // PATCH /projects/:id/members/:userId { role } — change a collaborator's role.
  fastify.patch<{ Params: { id: string; userId: string } }>('/projects/:id/members/:userId', async (req, reply) => {
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(req.params)
    const { role } = z.object({ role: z.enum(['VIEWER', 'EDITOR']) }).parse(req.body)
    if (await denyIfNoProjectAccess(prisma, id, req.authUser!.id, reply, { write: true })) return
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: id, userId } }, data: { role } }).catch(() => null)
    return reply.send({ ok: true })
  })

  // DELETE /projects/:id/members/:userId — revoke access (or leave a shared project).
  fastify.delete<{ Params: { id: string; userId: string } }>('/projects/:id/members/:userId', async (req, reply) => {
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(req.params)
    // A user may always remove THEMSELVES; otherwise write access is required.
    if (userId !== req.authUser!.id && await denyIfNoProjectAccess(prisma, id, req.authUser!.id, reply, { write: true })) return
    await prisma.projectMember.deleteMany({ where: { projectId: id, userId } })
    return reply.status(204).send()
  })
}

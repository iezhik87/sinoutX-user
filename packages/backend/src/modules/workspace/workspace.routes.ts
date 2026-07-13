import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { WorkspaceService } from './workspace.service.js'
import { createAuthMiddleware } from '../../middleware/authenticate.js'
import { sendWorkspaceInviteEmail, isEmailConfigured } from '../../lib/email.js'
import { canCreateWorkspace, canAddMember } from '../../lib/plans.js'
import { writeAuditLog } from '../../lib/audit.js'
import { getPersonalWorkspaceId, provisionPersonalWorkspace } from '../../lib/personal.js'
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
} from './workspace.schema.js'

export async function workspaceRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new WorkspaceService(prisma)
  const authenticate = createAuthMiddleware(prisma)

  // GET /workspaces — only workspaces the user is a member of
  fastify.get('/', { preHandler: authenticate }, async (req, reply) => {
    let workspaces = await service.list(req.authUser!.id)
    // Self-heal: a real user should always have their Personal workspace. Older
    // admin-created accounts predate auto-provisioning — give them one on load
    // (no manual "create workspace" step). Skipped for scoped API keys.
    const scope = req.authWorkspaceScope
    if (!workspaces.length && !(scope && scope.length)) {
      await provisionPersonalWorkspace(prisma, req.authUser!.id).catch(() => {})
      workspaces = await service.list(req.authUser!.id)
    }
    const visible = scope && scope.length ? workspaces.filter((w: { id: string }) => scope.includes(w.id)) : workspaces
    return reply.send(visible)
  })

  // GET /workspaces/personal — the caller's canonical Personal workspace (memory
  // + personal modules live here, the same across all the user's workspaces).
  fastify.get('/personal', { preHandler: authenticate }, async (req, reply) => {
    const id = await getPersonalWorkspaceId(prisma, req.authUser!.id)
    if (!id) return reply.send(null)
    const ws = await service.getById(id).catch(() => null)
    return reply.send(ws ?? { id })
  })

  // GET /workspaces/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    const workspace = await service.getById(id)
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' })
    return reply.send(workspace)
  })

  // POST /workspaces — creator is automatically OWNER
  fastify.post('/', { preHandler: authenticate }, async (req, reply) => {
    const check = await canCreateWorkspace(prisma, req.authUser!.id)
    if (!check.ok) {
      return reply.status(403).send({ error: 'plan_limit', resource: 'workspaces', limit: check.limit, current: check.current })
    }
    const data = createWorkspaceSchema.parse(req.body)
    const workspace = await service.create(data, req.authUser!.id)
    await writeAuditLog(prisma, { action: 'workspace.created', workspaceId: workspace.id, userId: req.authUser!.id, resourceType: 'workspace', resourceId: workspace.id, resourceName: workspace.name, ip: req.ip })
    return reply.status(201).send(workspace)
  })

  // PATCH /workspaces/:id — requires OWNER or ADMIN
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership || membership.role === 'MEMBER') return reply.status(403).send({ error: 'Forbidden' })
    const data = updateWorkspaceSchema.parse(req.body)
    const workspace = await service.update(id, data)
    await writeAuditLog(prisma, { action: 'workspace.updated', workspaceId: id, userId: req.authUser!.id, resourceType: 'workspace', resourceId: id, ip: req.ip })
    return reply.send(workspace)
  })

  // DELETE /workspaces/:id — requires OWNER
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership || membership.role !== 'OWNER') return reply.status(403).send({ error: 'Forbidden' })
    await writeAuditLog(prisma, { action: 'workspace.deleted', workspaceId: id, userId: req.authUser!.id, resourceType: 'workspace', resourceId: id, ip: req.ip })
    await service.delete(id)
    return reply.status(204).send()
  })

  // ── Member endpoints ────────────────────────────────────────────────────────

  // GET /workspaces/:id/members
  fastify.get<{ Params: { id: string } }>('/:id/members', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    const members = await service.listMembers(id)
    return reply.send(members)
  })

  // POST /workspaces/:id/members — add by email or userId
  fastify.post<{ Params: { id: string } }>('/:id/members', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership || membership.role === 'MEMBER') return reply.status(403).send({ error: 'Forbidden' })

    const { email, userId, role = 'MEMBER' } = req.body as { email?: string; userId?: string; role?: string }
    if (!email && !userId) return reply.status(400).send({ error: 'email or userId required' })

    let targetUser
    if (userId) {
      targetUser = await prisma.user.findUnique({ where: { id: userId } })
    } else if (email) {
      targetUser = await prisma.user.findUnique({ where: { email } })
    }
    if (!targetUser) return reply.status(404).send({ error: 'User not found' })

    const memberCheck = await canAddMember(prisma, id)
    if (!memberCheck.ok) {
      return reply.status(403).send({ error: 'plan_limit', resource: 'members', limit: memberCheck.limit, current: memberCheck.current })
    }
    const member = await service.addMember(id, targetUser.id, role as 'ADMIN' | 'MEMBER' | 'VIEWER')
    await writeAuditLog(prisma, { action: 'member.added', workspaceId: id, userId: req.authUser!.id, resourceType: 'user', resourceId: targetUser.id, resourceName: targetUser.email, meta: { role }, ip: req.ip })

    // Async: send invite notification email
    if (await isEmailConfigured(prisma)) {
      const prefs = (targetUser.notificationPrefs as Record<string, boolean>) ?? {}
      if (prefs.workspaceInvite !== false) {
        const workspace = await prisma.workspace.findUnique({ where: { id }, select: { name: true } })
        const inviter = await prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { name: true } })
        const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
        sendWorkspaceInviteEmail(targetUser.email, {
          workspaceName: workspace?.name ?? '',
          inviterName: inviter?.name ?? 'Администратор',
          appUrl: settings?.appUrl ?? 'http://localhost:3012',
        }, prisma).catch(() => {})
      }
    }

    return reply.status(201).send(member)
  })

  // PATCH /workspaces/:id/members/:userId — change role
  fastify.patch<{ Params: { id: string; userId: string } }>('/:id/members/:userId', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const { userId } = req.params
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership || membership.role === 'MEMBER') return reply.status(403).send({ error: 'Forbidden' })

    const { role } = req.body as { role?: string }
    if (!role || !['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].includes(role)) return reply.status(400).send({ error: 'Invalid role' })

    const member = await service.updateMemberRole(id, userId, role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER')
    await writeAuditLog(prisma, { action: 'member.role_changed', workspaceId: id, userId: req.authUser!.id, resourceType: 'user', resourceId: userId, meta: { role }, ip: req.ip })
    return reply.send(member)
  })

  // DELETE /workspaces/:id/members/:userId — remove member
  fastify.delete<{ Params: { id: string; userId: string } }>('/:id/members/:userId', { preHandler: authenticate }, async (req, reply) => {
    const { id } = workspaceParamsSchema.parse(req.params)
    const { userId } = req.params
    const membership = await service.getMembership(id, req.authUser!.id)
    if (!membership || (membership.role === 'MEMBER' && userId !== req.authUser!.id)) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    await service.removeMember(id, userId)
    await writeAuditLog(prisma, { action: 'member.removed', workspaceId: id, userId: req.authUser!.id, resourceType: 'user', resourceId: userId, ip: req.ip })
    return reply.status(204).send()
  })
}

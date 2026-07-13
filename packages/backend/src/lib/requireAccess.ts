import { PrismaClient } from '@prisma/client'
import { FastifyReply } from 'fastify'

/**
 * Verifies the user is a member of the workspace AND has write access.
 *
 * By default rejects VIEWER (read-only role), so all existing call sites
 * automatically protect mutations. For read endpoints that should also
 * be accessible to VIEWERs, pass `{ allowViewer: true }`.
 *
 * Returns true and sends 403 if access is denied — the caller should
 * return immediately.
 */
export async function denyIfNotMember(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  reply: FastifyReply,
  opts?: { allowViewer?: boolean },
): Promise<boolean> {
  // API-key workspace scope: a scoped key may only touch its allow-listed workspaces.
  const scope = reply.request.authWorkspaceScope
  if (scope && scope.length && !scope.includes(workspaceId)) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'API key is not scoped to this workspace' })
    return true
  }
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!member) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access denied' })
    return true
  }
  if (member.role === 'VIEWER' && !opts?.allowViewer) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Read-only access — VIEWER role cannot modify this resource' })
    return true
  }
  return false
}

/**
 * Requires the user to be an OWNER or ADMIN of the workspace. Used for sensitive
 * config (e.g. custom tools that execute outbound requests on the instance's behalf).
 * Returns true and sends 403 if denied.
 */
export async function denyIfNotAdmin(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const scope = reply.request.authWorkspaceScope
  if (scope && scope.length && !scope.includes(workspaceId)) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'API key is not scoped to this workspace' })
    return true
  }
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Requires OWNER or ADMIN role' })
    return true
  }
  return false
}

/**
 * Effective access a user has to a single PROJECT, combining two paths:
 *   • workspace membership (owns/member of the project's workspace), or
 *   • a direct ProjectMember grant (the project was shared with them).
 * 'write' = can modify, 'read' = view only (VIEWER role), 'none' = no access.
 */
export type ProjectAccessLevel = 'none' | 'read' | 'write'
export async function getProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccessLevel> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
  if (!project) return 'none'
  const wm = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
    select: { role: true },
  })
  if (wm) return wm.role === 'VIEWER' ? 'read' : 'write'
  const pm = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  })
  if (pm) return pm.role === 'VIEWER' ? 'read' : 'write'
  return 'none'
}

/**
 * Guard a project-scoped route: rejects (403) when the user has no access, or
 * when write is required but they only have read. Honors API-key workspace scope.
 * Returns true and sends the response if denied — caller should return.
 */
export async function denyIfNoProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  reply: FastifyReply,
  opts?: { write?: boolean },
): Promise<boolean> {
  const scope = reply.request.authWorkspaceScope
  if (scope && scope.length) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    if (project && !scope.includes(project.workspaceId)) {
      reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'API key is not scoped to this project' })
      return true
    }
  }
  const access = await getProjectAccess(prisma, projectId, userId)
  if (access === 'none') {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access denied' })
    return true
  }
  if (opts?.write && access !== 'write') {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Read-only access to this project' })
    return true
  }
  return false
}

/** Resolve workspaceId from a projectId, or return null if project not found. */
export async function getProjectWorkspaceId(
  prisma: PrismaClient,
  projectId: string,
): Promise<string | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
  return p?.workspaceId ?? null
}

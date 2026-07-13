// Personal-space + per-user resolution helpers.
//
// SinoutX separates two layers:
//   • the USER (per-user): AI models/keys, memory, personal modules, identity —
//     one set that follows the user across all their workspaces;
//   • the WORKSPACE (per-tenant): a container for collaborative data + access.
//
// Each user has one canonical "Personal" workspace (User.personalWorkspaceId,
// Workspace.isPersonal) where memory and personal modules live. These helpers
// resolve it, and resolve a workspace's owner so workspace-keyed call sites can
// reach the right user.
import type { PrismaClient } from '@prisma/client'

// One consistent name for every user's Personal workspace (single-workspace model).
export const PERSONAL_WORKSPACE_NAME = 'Личное'

// The assistant's default "home" — where unfiled tasks/notes land when the user
// doesn't name a project. Reuses the legacy isSystem project (the old «Ассистент»
// home), repurposed as «Входящие»; creates one if missing.
export async function resolveInboxProject(prisma: PrismaClient, workspaceId: string): Promise<string> {
  const existing = await prisma.project.findFirst({ where: { workspaceId, isSystem: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.project.create({
    data: { workspaceId, name: 'Входящие', icon: '📥', isSystem: true, status: 'ACTIVE', position: -1 },
    select: { id: true },
  })
  return created.id
}

/** The user's canonical Personal workspace id. Falls back to (and self-heals to)
 *  their oldest OWNED workspace if the pointer is missing. */
export async function getPersonalWorkspaceId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { personalWorkspaceId: true } })
  if (u?.personalWorkspaceId) return u.personalWorkspaceId
  const owned = await prisma.workspaceMember.findFirst({
    where: { userId, role: 'OWNER' },
    orderBy: { workspace: { createdAt: 'asc' } },
    select: { workspaceId: true },
  })
  if (!owned) return null
  await prisma.user.update({ where: { id: userId }, data: { personalWorkspaceId: owned.workspaceId } }).catch(() => {})
  await prisma.workspace.update({ where: { id: owned.workspaceId }, data: { isPersonal: true } }).catch(() => {})
  return owned.workspaceId
}

/** Ensure the user has their Personal workspace — create it if missing.
 *  Idempotent; used by every account-creation path so a new user never lands
 *  without a workspace (no manual "create workspace" step). */
export async function provisionPersonalWorkspace(prisma: PrismaClient, userId: string): Promise<string> {
  const existing = await getPersonalWorkspaceId(prisma, userId)
  if (existing) return existing
  const workspace = await prisma.workspace.create({ data: { name: PERSONAL_WORKSPACE_NAME, isPersonal: true } })
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role: 'OWNER' } })
  await prisma.user.update({ where: { id: userId }, data: { personalWorkspaceId: workspace.id } })
  return workspace.id
}

/** The OWNER user of a workspace — used to resolve per-user settings from a
 *  workspace-keyed call site. */
export async function getWorkspaceOwnerId(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })
  return owner?.userId ?? null
}

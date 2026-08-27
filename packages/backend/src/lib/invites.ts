// ─── Invitations ──────────────────────────────────────────────────────────────
// Inviting someone used to require that they already had an account: the owner
// typed a colleague's address and got «user not found». Whoever had just paid
// for Team had to walk them through signing up first, which is a poor welcome.
//
// An invite grants NOTHING on its own. It records who was invited, to what, and
// by whom; membership appears only when that person registers and the invite is
// redeemed. Two consequences that must not be lost:
//
//   · the plan limit is re-checked AT REDEMPTION, not only when sending. Ten
//     invites sent while one seat was free must not all land.
//   · an invite is permission to REGISTER on a closed instance, and nothing
//     more — it cannot be traded for access to anything else.
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { canAddMember, canShareProject, getWorkspaceOwner } from './plans.js'

/** Long enough that guessing is pointless, short enough to paste in a URL. */
const newToken = () => randomBytes(24).toString('base64url')

/** Two weeks: long enough for a colleague on holiday, short enough to expire. */
const TTL_DAYS = 14

export interface InviteTarget {
  workspaceId?: string
  projectId?: string
  role: string
}

/**
 * Record an invitation, replacing any previous unaccepted one for the same
 * person and target — re-inviting should refresh the link, not pile up rows.
 */
export async function createInvite(
  prisma: PrismaClient,
  email: string,
  invitedBy: string,
  target: InviteTarget,
) {
  const normalised = email.trim().toLowerCase()
  await prisma.invite.deleteMany({
    where: {
      email: normalised,
      acceptedAt: null,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : { projectId: target.projectId }),
    },
  })
  return prisma.invite.create({
    data: {
      email: normalised,
      invitedBy,
      role: target.role,
      workspaceId: target.workspaceId ?? null,
      projectId: target.projectId ?? null,
      token: newToken(),
      expiresAt: new Date(Date.now() + TTL_DAYS * 86_400_000),
    },
  })
}

/** A token that may still be used, or null. Expiry and reuse both disqualify. */
export async function findUsableInvite(prisma: PrismaClient, token: string) {
  if (!token) return null
  const invite = await prisma.invite.findUnique({ where: { token } })
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null
  return invite
}

export interface RedeemResult {
  granted: boolean
  /** Set when access was refused, so the caller can say why rather than fail mute. */
  reason?: 'limit' | 'gone'
}

/**
 * Turn every pending invite for this address into real membership.
 *
 * Called right after registration. The plan limit is checked per invite, so a
 * batch of invites sent against one free seat fills that seat once and refuses
 * the rest — with a reason, so the owner can be told instead of the newcomer
 * silently seeing nothing.
 */
export async function redeemInvitesFor(
  prisma: PrismaClient,
  userId: string,
  email: string,
): Promise<RedeemResult[]> {
  const pending = await prisma.invite.findMany({
    where: { email: email.trim().toLowerCase(), acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
  })

  const results: RedeemResult[] = []
  for (const invite of pending) {
    let result: RedeemResult

    if (invite.workspaceId) {
      const ws = await prisma.workspace.findUnique({ where: { id: invite.workspaceId }, select: { id: true } })
      if (!ws) result = { granted: false, reason: 'gone' }
      else {
        const gate = await canAddMember(prisma, invite.workspaceId)
        if (!gate.ok) result = { granted: false, reason: 'limit' }
        else {
          await prisma.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
            create: {
              workspaceId: invite.workspaceId, userId,
              role: (['ADMIN', 'MEMBER', 'VIEWER'].includes(invite.role) ? invite.role : 'MEMBER') as 'ADMIN' | 'MEMBER' | 'VIEWER',
            },
            update: {},
          })
          result = { granted: true }
        }
      }
    } else if (invite.projectId) {
      const project = await prisma.project.findUnique({ where: { id: invite.projectId }, select: { workspaceId: true } })
      if (!project) result = { granted: false, reason: 'gone' }
      else {
        const owner = await getWorkspaceOwner(prisma, project.workspaceId)
        const gate = owner ? await canShareProject(prisma, owner.id, userId) : { ok: true }
        if (!gate.ok) result = { granted: false, reason: 'limit' }
        else {
          await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: invite.projectId, userId } },
            create: {
              projectId: invite.projectId, userId,
              role: (invite.role === 'VIEWER' ? 'VIEWER' : 'EDITOR') as 'VIEWER' | 'EDITOR',
            },
            update: {},
          })
          result = { granted: true }
        }
      }
    } else {
      result = { granted: false, reason: 'gone' }
    }

    // Mark it used either way: a refused invite must not stay live, or the
    // newcomer would silently gain access the moment a seat frees up.
    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } })
    results.push(result)
  }

  return results
}

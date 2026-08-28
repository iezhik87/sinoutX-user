import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { isBillingEnabled } from './billingMode.js'

// ─── Capability gating ────────────────────────────────────────────────────────
// Powerful/sensitive agent features are gated by named capabilities, resolved
// per user. Admin/owner gets everything; bash is never granted to non-admins on
// cloud (server-security boundary). See monetization_billing_model.
export const CAP = {
  ASSISTANT_FULL: 'assistant_full',     // proactivity: scheduled skills, triggers
  CODE_EXEC_PY: 'code_exec:python',     // sandboxed Python scripts
  CODE_EXEC_BASH: 'code_exec:bash',     // bash — self-hosted/admin only
  CODE_EXEC_NET: 'code_exec:net',       // sandbox WITH internet — relaxation, admin only
  VAULT_REVEAL: 'vault:reveal',         // agent may fetch+return Vault secret VALUES (admin only by default)
  MANAGED_TOKENS: 'managed_tokens',     // we bill tokens (cloud pay-as-you-go)
  LAB_USE: 'lab:use',                   // experimental "lab" tools — owner/admin only (never in BASE_CAPS)
} as const

const ALL_CAPS = Object.values(CAP)
// Default capabilities for regular (non-admin) users. Kept OPEN until billing
// lands (single-user instance today); code_exec stays gated by design.
const BASE_CAPS = [CAP.ASSISTANT_FULL]

/** The set of capabilities a user has, honoring role (admin → all), deployment
 *  mode (no bash for non-admins on cloud) and per-user grant/revoke overrides. */
export async function getCapabilities(prisma: PrismaClient, userId: string): Promise<Set<string>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, capabilities: true } })
  if (!u) return new Set()
  if (roleIsUnlimited(u.role)) return new Set(ALL_CAPS) // admin/owner: full power, any mode
  const caps = new Set<string>(BASE_CAPS)
  const ov = (u.capabilities ?? {}) as { grant?: string[]; revoke?: string[] }
  for (const c of ov.grant ?? []) {
    if (c === CAP.CODE_EXEC_BASH && config.DEPLOYMENT_MODE === 'cloud') continue // never bash on cloud for non-admin
    if (ALL_CAPS.includes(c as typeof ALL_CAPS[number])) caps.add(c)
  }
  for (const c of ov.revoke ?? []) caps.delete(c)
  return caps
}

export async function hasCapability(prisma: PrismaClient, userId: string, cap: string): Promise<boolean> {
  return (await getCapabilities(prisma, userId)).has(cap)
}

// We never charge for rows in a database. Projects, notes, tasks, modules and
// registries cost us nothing and build the habit — counting them punishes the
// user for using the product, and the project cap in particular fired on module
// installs (each module is a project), i.e. exactly on the feature meant to sell.
// What is left are the two things with a real cost: disk and collaboration.
export interface PlanLimits {
  storageMb: number   // -1 = unlimited
  members: number
  premiumPipelines: boolean // Tier-2 AI pipelines (e.g. lab/document OCR)
}

// Free users get a few pipeline runs to try the premium feature before paying.
export const FREE_PIPELINE_TRIALS = 5

// Public commercial model: Free (solo) · Pro (solo, more capacity) · Team
// (collaboration). Storage stays tight on free — the cloud instance is
// multi-tenant, many trial users share one finite disk.
export const DEFAULT_LIMITS: Record<string, PlanLimits> = {
  // Community (Free) — solo. Inviting anyone (a 2nd member or a read-only
  // viewer) requires a Team licence: collaboration is the only paywall.
  free: { storageMb: 200,   members: 1,  premiumPipelines: false },
  // Team — the only paid plan: collaboration, $149 once, up to 10 users.
  // Solo work is free everywhere; disk beyond the free allowance is bought in
  // packs on the cloud and costs nothing on your own server.
  team: { storageMb: 10240, members: 10, premiumPipelines: true },
}

export const UNLIMITED: PlanLimits = { storageMb: -1, members: -1, premiumPipelines: true }

// Roles that bypass all plan limits: the instance owner and moderators.
// The single definition of «never limited, never billed»: instance owner and
// admins. An operator who freezes himself cannot unfreeze himself.
export function roleIsUnlimited(role?: string | null): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

// A license that has lapsed falls back to free. Exported because every place
// that resolves limits from a stored `user.plan` must go through here: the raw
// column keeps both retired tiers and expired licences.
export function effectivePlan(u: { plan: string; licenseExpiresAt?: Date | null }): string {
  if (u.licenseExpiresAt && u.licenseExpiresAt < new Date()) return 'free'
  // Only two plans exist now. A leftover 'pro' from before it was cut (or any
  // unknown value) reads as free rather than resurrecting a tier and its limits.
  return u.plan === 'team' ? 'team' : 'free'
}

/**
 * Storage a user may occupy: the plan's free allowance plus every 200 MB pack he
 * pays for. A per-user override still wins — that is the admin's escape hatch.
 */
export function effectiveStorageMb(
  user: { storageLimitMb: number | null; storagePacks: number },
  planStorageMb: number,
): number {
  // A per-user override is the admin's escape hatch — for a guest, for himself,
  // for anyone. It wins over everything.
  if (user.storageLimitMb != null) return user.storageLimitMb
  // No disk is rationed on an instance that does not bill.
  if (!isBillingEnabled()) return -1
  if (planStorageMb === -1) return -1
  return planStorageMb + user.storagePacks * config.STORAGE_PACK_MB
}

export async function getPlanLimits(prisma: PrismaClient, plan: string): Promise<PlanLimits> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  const stored = settings?.planLimits as Record<string, Partial<PlanLimits>> | null
  // Merge over defaults so newer fields (e.g. premiumPipelines) exist even when
  // an older planLimits override is saved in the DB.
  return { ...(DEFAULT_LIMITS[plan] ?? DEFAULT_LIMITS.free), ...(stored?.[plan] ?? {}) }
}

export async function getWorkspaceOwner(prisma: PrismaClient, workspaceId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    include: { user: true },
  })
  return member?.user ?? null
}

// Everyone (besides the owner) who currently has access to ANY project the owner
// holds — via a workspace membership OR a per-project share. This is the true head
// count that the collaboration limit is measured against, so sharing the same
// person on a second project never double-counts them.
async function distinctCollaborators(prisma: PrismaClient, ownerUserId: string): Promise<Set<string>> {
  const wsIds = (await prisma.workspaceMember.findMany({
    where: { userId: ownerUserId, role: 'OWNER' }, select: { workspaceId: true },
  })).map((m) => m.workspaceId)
  const set = new Set<string>()
  if (!wsIds.length) return set
  const wm = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: wsIds }, role: { not: 'OWNER' } }, select: { userId: true },
  })
  wm.forEach((m) => set.add(m.userId))
  const projIds = (await prisma.project.findMany({
    where: { workspaceId: { in: wsIds } }, select: { id: true },
  })).map((p) => p.id)
  if (projIds.length) {
    const pm = await prisma.projectMember.findMany({
      where: { projectId: { in: projIds } }, select: { userId: true },
    })
    pm.forEach((m) => set.add(m.userId))
  }
  set.delete(ownerUserId)
  return set
}

/** How many distinct people (besides the owner) currently have access. */
export async function collaboratorCount(prisma: PrismaClient, ownerUserId: string): Promise<number> {
  return (await distinctCollaborators(prisma, ownerUserId)).size
}

/**
 * The collaboration paywall — the one thing a Team licence unlocks. Free = solo
 * (no external members); Team = up to `members` people total (owner + others).
 *
 * Two deliberate differences from every other limit:
 *  - On a BILLING instance collaboration is free (each collaborator pays his own
 *    subscription), so there is no cap.
 *  - On self-hosted the instance OWNER is NOT exempt here, even though he bypasses
 *    every other limit — unlocking collaboration is exactly what he pays Team for.
 *    Admins (staff the owner added) still bypass.
 */
export async function canShareProject(
  prisma: PrismaClient,
  ownerUserId: string,
  targetUserId: string,
): Promise<{ ok: boolean; limit: number; current: number }> {
  if (isBillingEnabled()) return { ok: true, limit: -1, current: 0 }
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId }, select: { plan: true, licenseExpiresAt: true, role: true },
  })
  if (!owner) return { ok: true, limit: -1, current: 0 }
  if (owner.role === 'ADMIN') return { ok: true, limit: -1, current: 0 }
  const limits = await getPlanLimits(prisma, effectivePlan(owner))
  if (limits.members === -1) return { ok: true, limit: -1, current: 0 }
  const collaborators = await distinctCollaborators(prisma, ownerUserId)
  const total = 1 + collaborators.size // owner + everyone with access
  // Re-sharing an existing collaborator adds no head count, so it stays allowed.
  const ok = collaborators.has(targetUserId) || total < limits.members
  return { ok, limit: limits.members, current: total }
}

// Check if user can create another workspace
export async function canCreateWorkspace(prisma: PrismaClient, userId: string): Promise<{ ok: boolean; limit: number; current: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { ok: false, limit: 0, current: 0 }

  // Single-workspace model: each user has exactly ONE workspace (created at
  // registration). Collaboration happens by sharing PROJECTS, not by creating
  // more workspaces — so once a user owns a workspace, no more can be created.
  // This is the product's shape, not a plan limit: no tier lifts it.
  const owned = await prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } })
  if (owned >= 1) return { ok: false, limit: 1, current: owned }
  return { ok: true, limit: 1, current: 0 }
}

// Check if workspace can add another member. Same collaboration paywall as
// canShareProject (they are two doors to the same thing): free = solo, Team lifts
// it, cloud is free. The instance OWNER is gated here too — unlike other limits —
// because that is precisely what Team sells; only ADMIN staff bypass.
export async function canAddMember(prisma: PrismaClient, workspaceId: string): Promise<{ ok: boolean; limit: number; current: number }> {
  const owner = await getWorkspaceOwner(prisma, workspaceId)
  if (!owner) return { ok: true, limit: -1, current: 0 }
  if (owner.role === 'ADMIN') return { ok: true, limit: -1, current: 0 } // staff, not a customer
  if (isBillingEnabled()) return { ok: true, limit: -1, current: 0 }     // cloud: collaboration free

  const limits = await getPlanLimits(prisma, effectivePlan(owner))
  if (limits.members === -1) return { ok: true, limit: -1, current: 0 }

  // Head count across everything the owner shares (workspace + project shares),
  // de-duplicated, plus the owner himself — matches canShareProject and the bar.
  const current = 1 + await collaboratorCount(prisma, owner.id)
  return { ok: current < limits.members, limit: limits.members, current }
}

// Check if workspace can upload a file of given size
export async function canUploadFile(prisma: PrismaClient, workspaceId: string, fileSizeBytes: number): Promise<{ ok: boolean; limitMb: number; usedMb: number; graceMb?: number }> {
  const owner = await getWorkspaceOwner(prisma, workspaceId)
  if (!owner) return { ok: true, limitMb: -1, usedMb: 0 }
  if (roleIsUnlimited(owner.role)) return { ok: true, limitMb: -1, usedMb: 0 } // owner/admin: no limits

  const limits = await getPlanLimits(prisma, effectivePlan(owner))
  const limitMb = effectiveStorageMb(owner, limits.storageMb)
  if (limitMb === -1) return { ok: true, limitMb: -1, usedMb: 0 }

  // Usage is summed across ALL workspaces the user owns (their personal quota),
  // not just this one — matches how it's shown in the admin panel.
  const ownedIds = (await prisma.workspaceMember.findMany({
    where: { userId: owner.id, role: 'OWNER' }, select: { workspaceId: true },
  })).map((m) => m.workspaceId)
  const result = await prisma.attachment.aggregate({
    where: { workspaceId: { in: ownedIds } },
    _sum: { size: true },
  })
  const usedBytes = Number(result._sum.size ?? 0)
  const usedMb = Math.round(usedBytes / 1024 / 1024)

  // A hard stop exactly at the limit turns «one byte over» into «buy a whole
  // pack», which is a terrible trade for the user and a bad look for us. Allow a
  // small overshoot instead — enough for the document in hand — and warn loudly.
  // Past the grace it does stop: the disk is real and somebody pays for it.
  const graceMb = storageGraceMb(limitMb)
  return {
    ok: usedBytes + fileSizeBytes <= (limitMb + graceMb) * 1024 * 1024,
    limitMb,
    usedMb,
    graceMb,
  }
}

/** How far over the limit an upload is still allowed. */
export function storageGraceMb(limitMb: number): number {
  if (limitMb <= 0) return 0
  return Math.max(25, Math.round(limitMb * 0.1))
}

// Bulk per-user storage usage + effective limit for the admin Users view.
// Returns a map userId -> { usedBytes, limitMb (-1 = unlimited) }.
export async function getAllUsersStorage(prisma: PrismaClient): Promise<Map<string, { usedBytes: number; limitMb: number }>> {
  const [users, owners, usageByWs, settings] = await Promise.all([
    prisma.user.findMany({ select: { id: true, role: true, plan: true, licenseExpiresAt: true, storageLimitMb: true, storagePacks: true } }),
    prisma.workspaceMember.findMany({ where: { role: 'OWNER' }, select: { workspaceId: true, userId: true } }),
    prisma.attachment.groupBy({ by: ['workspaceId'], _sum: { size: true } }),
    prisma.appSettings.findUnique({ where: { id: 'singleton' } }),
  ])
  const planLimits = (settings?.planLimits as Record<string, PlanLimits> | null) ?? null
  const limitForPlan = (plan: string) => (planLimits?.[plan] ?? DEFAULT_LIMITS[plan] ?? DEFAULT_LIMITS.free).storageMb

  const bytesByWs = new Map<string, number>(usageByWs.map((g) => [g.workspaceId, Number(g._sum.size ?? 0)]))
  const out = new Map<string, { usedBytes: number; limitMb: number }>()
  for (const u of users) {
    const limitMb = effectiveStorageMb(u, limitForPlan(effectivePlan(u)))
    out.set(u.id, { usedBytes: 0, limitMb })
  }
  for (const o of owners) {
    const rec = out.get(o.userId)
    if (rec) rec.usedBytes += bytesByWs.get(o.workspaceId) ?? 0
  }
  return out
}

// Get full plan usage for a user
export async function getUserPlanUsage(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const planLimitsRaw = await getPlanLimits(prisma, effectivePlan(user))
  // Collaboration is the Team paywall on SELF-HOSTED only (free = solo). On the
  // cloud collaboration is free (each collaborator pays his own subscription), so
  // the members cap doesn't apply there; disk is rationed on the cloud, never
  // self-hosted. Hence: cloud → storage from plan, members unlimited; self-hosted →
  // storage unlimited, members from plan.
  const planLimits = isBillingEnabled()
    ? { ...planLimitsRaw, members: -1 }
    : { ...UNLIMITED, members: planLimitsRaw.members }
  // The bought packs are part of the limit the user actually has, so the bar in
  // Settings must show them — otherwise he pays and sees no change.
  const limits: PlanLimits = { ...planLimits, storageMb: effectiveStorageMb(user, planLimits.storageMb) }

  const workspaceIds = (await prisma.workspaceMember.findMany({
    where: { userId, role: 'OWNER' },
    select: { workspaceId: true },
  })).map((m) => m.workspaceId)

  const storageResult = await prisma.attachment.aggregate({
    where: { workspaceId: { in: workspaceIds } },
    _sum: { size: true },
  })
  const storageMb = Math.round(Number(storageResult._sum.size ?? 0) / 1024 / 1024)

  // Head count against the collaboration cap = owner + everyone he shared with
  // (workspace members and per-project shares, de-duplicated). Matches the gate.
  const members = 1 + await collaboratorCount(prisma, userId)

  return {
    // Unlimited owners/admins read as the «Community» (self-host owner) tier;
    // everyone else shows their effective plan (a lapsed license reads as free).
    // The screen has to say something a person understands, and «Free» means
    // opposite things when you are a guest on someone's server and when you own it.
    billed: isBillingEnabled(),
    isAdmin: roleIsUnlimited(user.role),
    plan: roleIsUnlimited(user.role) ? 'community' : effectivePlan(user),
    // What to call the tier to a human: where he runs and whether he collaborates.
    tier: effectivePlan(user) === 'team' ? 'team' : isBillingEnabled() ? 'cloud' : 'selfhosted',
    licenseKey: user.licenseKey,
    licenseExpiresAt: user.licenseExpiresAt,
    limits,
    usage: { storageMb, members },
  }
}

// ─── Tier-2 pipelines (premium AI capabilities) ───────────────────────────────

export interface PipelineAccess { ok: boolean; premium: boolean; trialsLeft: number; plan: string }

// Free pipeline trials are counted PER MODULE: settings.pipelineRuns is a map
// { [moduleId]: count }. A legacy number (old single counter) is ignored so each
// module starts with its own fresh allowance.
function readPipelineRuns(settings: unknown): Record<string, number> {
  const pr = (settings as Record<string, unknown> | null)?.pipelineRuns
  return pr && typeof pr === 'object' && !Array.isArray(pr) ? { ...(pr as Record<string, number>) } : {}
}

// Can this workspace run a premium pipeline? Instance owner/admin and Team plans
// are unlimited; self-hosted free plans get FREE_PIPELINE_TRIALS runs PER MODULE.
export async function checkPipelineAccess(prisma: PrismaClient, workspaceId: string, moduleId?: string | null): Promise<PipelineAccess> {
  const owner = await getWorkspaceOwner(prisma, workspaceId)
  if (!owner) return { ok: true, premium: true, trialsLeft: -1, plan: 'free' }
  if (roleIsUnlimited(owner.role)) return { ok: true, premium: true, trialsLeft: -1, plan: owner.plan }
  // On cloud recognition is metered from the balance per token like any AI call,
  // and freeze/low-balance already guard it — so there is no trial wall. The five
  // free runs exist only to let a self-hosted solo user try the feature before
  // buying the Team licence; on a billing instance they would wrongly block a
  // paying user with money on his balance.
  if (isBillingEnabled()) return { ok: true, premium: true, trialsLeft: -1, plan: effectivePlan(owner) }
  const plan = effectivePlan(owner)
  const limits = await getPlanLimits(prisma, plan)
  if (limits.premiumPipelines) return { ok: true, premium: true, trialsLeft: -1, plan }
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } })
  const used = Number(readPipelineRuns(ws?.settings)[moduleId || 'default'] ?? 0)
  const left = Math.max(0, FREE_PIPELINE_TRIALS - used)
  return { ok: left > 0, premium: false, trialsLeft: left, plan }
}

// Count one trial run against the workspace for a specific module (free plans).
export async function incrementPipelineUsage(prisma: PrismaClient, workspaceId: string, moduleId?: string | null): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } })
  const cur = (ws?.settings as Record<string, unknown>) ?? {}
  const runs = readPipelineRuns(cur)
  const key = moduleId || 'default'
  runs[key] = Number(runs[key] ?? 0) + 1
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings: { ...cur, pipelineRuns: runs } as object } })
}

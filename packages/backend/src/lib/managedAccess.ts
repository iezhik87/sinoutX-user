// ─── Who may spend our keys ───────────────────────────────────────────────────
// The managed keys — language model, vision, images, embeddings — are the ones
// the INSTANCE pays for. Three conditions must hold together, and each of them
// fails differently:
//
//   1. the user opted in (the «SinoutX model» toggle) — a BYOK user brought his
//      own key precisely so he would not be on ours;
//   2. his account is not frozen — an unpaid monthly bill means no service on
//      our dime, only his own key;
//   3. his balance is positive and under the monthly cap.
//
// Anything not covered by these is a hole through which a stranger reads receipts
// on our vision key without ever paying the $5.
import type { PrismaClient } from '@prisma/client'
import { isBillingEnabled } from './billingMode.js'
import { canSpend } from './wallet.js'
import { getManagedVision, getManagedAi, getManagedEmbeddings } from './managed.js'
import type { EmbeddingsConfig } from './embeddings.js'
import { recordUsage } from './usage.js'
import type { OcrConfig } from './modules/vision.js'

export type ManagedDenial = 'not_opted_in' | 'frozen' | 'empty' | 'monthly_cap'

export interface ManagedAccess {
  ok: boolean
  reason?: ManagedDenial
}

/** Owner of a workspace — the person whose wallet and settings apply to it. */
export async function workspaceOwnerId(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const m = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true },
  })
  return m?.userId ?? null
}

/**
 * May we run this on our key, for this person, right now?
 *
 * On an instance that bills nobody the answer is always yes: the keys belong to
 * the operator, and he put them there for his own people.
 */
export async function canUseManaged(prisma: PrismaClient, userId: string | null | undefined): Promise<ManagedAccess> {
  if (!isBillingEnabled()) return { ok: true }
  if (!userId) return { ok: false, reason: 'not_opted_in' }

  // Read the setting straight from the row rather than through ai.service:
  // that module imports this one, and an ESM cycle resolves to `undefined` at
  // exactly the wrong moment.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { frozenAt: true, aiSettings: true },
  })
  if (!user) return { ok: false, reason: 'not_opted_in' }

  // A user who never opened the settings has no `provider` in his row, yet the
  // chat already answers him on the managed model (that is the default when the
  // instance has one). The same default must hold here, or recognition would be
  // refused to the very people the built-in model was made for.
  const stored = (user.aiSettings as { provider?: string } | null)?.provider
  const provider = stored ?? (getManagedAi() ? 'sinoutx' : undefined)
  if (provider !== 'sinoutx') return { ok: false, reason: 'not_opted_in' }
  if (user.frozenAt) return { ok: false, reason: 'frozen' }

  const check = await canSpend(prisma, userId)
  if (!check.ok) return { ok: false, reason: check.reason === 'monthly_cap' ? 'monthly_cap' : 'empty' }

  return { ok: true }
}

/** Same question, asked about a workspace rather than a person. */
export async function canUseManagedForWorkspace(prisma: PrismaClient, workspaceId: string): Promise<ManagedAccess> {
  return canUseManaged(prisma, await workspaceOwnerId(prisma, workspaceId))
}

// ─── Managed vision, metered ──────────────────────────────────────────────────

/**
 * The instance's vision key, wired to charge the user for what it burns.
 *
 * Returns null when he may not use it — a BYOK user, a frozen account, an empty
 * balance. The caller then falls back to the module's own key or refuses.
 */
export async function managedVisionFor(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string | null,
  source: string,
): Promise<OcrConfig | null> {
  const base = getManagedVision()
  if (!base) return null

  const access = await canUseManaged(prisma, userId)
  if (!access.ok) return null

  return {
    ...base,
    onUsage: (u) => {
      void recordUsage(prisma, {
        workspaceId,
        userId: userId ?? undefined,
        provider: `sinoutx:${base.provider}`,
        model: base.model,
        managed: true,
        source,
      }, { ...u, calls: 1 })
    },
  }
}

/**
 * The instance's embeddings key, wired to charge the user. Same three
 * conditions as everywhere else; null means "use his own key or keywords".
 */
export async function managedEmbeddingsFor(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<EmbeddingsConfig | null> {
  const base = getManagedEmbeddings()
  if (!base) return null

  const userId = await workspaceOwnerId(prisma, workspaceId)
  if (!(await canUseManaged(prisma, userId)).ok) return null

  return {
    ...base,
    onUsage: (u) => {
      void recordUsage(prisma, {
        workspaceId,
        userId: userId ?? undefined,
        provider: 'sinoutx:embeddings',
        model: base.model,
        managed: true,
        source: 'embeddings',
      }, { ...u, calls: 1 })
    },
  }
}

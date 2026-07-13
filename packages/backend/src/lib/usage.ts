// ─── Token accounting ─────────────────────────────────────────────────────────
// Nothing here bills anybody yet: it makes the number exist. A wallet cannot be
// built on top of an agent that does not know what its answers cost.
//
// The unit is ONE ANSWER, not one API call. A single answer runs the model
// repeatedly in the tool loop — "look at the tasks", "compute the balance",
// "write the reply" — and the user experienced one answer.
import type { PrismaClient } from '@prisma/client'
import { costOf } from './pricing.js'
import { debit, lowBalanceMicroUsd, usd } from './wallet.js'

export interface TokenUsage {
  /** Fresh input tokens (a cache miss, the expensive kind). */
  inputTokens: number
  /** Input served from the provider's prompt cache. DeepSeek prices these ~120x
   *  lower than a miss, so folding them into `inputTokens` would overstate the
   *  cost of a long system prompt by an order of magnitude. */
  cachedInputTokens: number
  outputTokens: number
  /** Model round-trips inside this one answer. */
  calls: number
}

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, calls: 0 })

export const hasUsage = (u: TokenUsage): boolean =>
  u.inputTokens > 0 || u.cachedInputTokens > 0 || u.outputTokens > 0 || u.calls > 0

/** Fold one API call's numbers into the running total for this answer. */
export function addUsage(total: TokenUsage, one: Partial<TokenUsage>): void {
  total.inputTokens += one.inputTokens ?? 0
  total.cachedInputTokens += one.cachedInputTokens ?? 0
  total.outputTokens += one.outputTokens ?? 0
  total.calls += 1
}

/**
 * Read the usage object of an OpenAI-compatible `usage` chunk.
 *
 * `prompt_tokens` INCLUDES cached tokens, so the cached count is subtracted out
 * — reporting both as billed input would double-count. The cached figure lives
 * under different names: OpenAI puts it in `prompt_tokens_details.cached_tokens`,
 * DeepSeek in `prompt_cache_hit_tokens`.
 */
export function parseOpenAIUsage(u: Record<string, unknown> | undefined): Partial<TokenUsage> | null {
  if (!u) return null
  const prompt = Number(u.prompt_tokens ?? 0)
  const completion = Number(u.completion_tokens ?? 0)
  if (!prompt && !completion) return null

  const details = u.prompt_tokens_details as { cached_tokens?: number } | undefined
  const cached = Number(details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0)

  return {
    inputTokens: Math.max(0, prompt - cached),
    cachedInputTokens: cached,
    outputTokens: completion,
  }
}

export interface UsageOrigin {
  workspaceId?: string
  userId?: string
  provider: string
  model: string
  /** true once the tokens are spent on OUR key and must be billed. */
  managed?: boolean
  source?: string
  /** Called once, on the answer that pushes the balance below the warning line. */
  onLowBalance?: (remainingMicroUsd: number) => Promise<void>
  /** For things not sold by the token — a generated image is one picture, not
   *  N tokens. Overrides the token calculation entirely. */
  fixedCost?: { costMicroUsd: number; chargedMicroUsd: number }
}

/**
 * Persist one answer's cost. Never throws into the stream: losing an accounting
 * row is bad, but killing a reply the user already read is worse.
 */
export async function recordUsage(prisma: PrismaClient, origin: UsageOrigin, usage: TokenUsage): Promise<void> {
  if (!origin.workspaceId || !hasUsage(usage)) return
  const managed = origin.managed ?? false
  // An unpriced model (anything we never run on our own key) records zeros
  // rather than a guess — the admin table shows it as unpriced.
  const cost = origin.fixedCost ?? costOf(origin.model, usage, managed)
  try {
    await prisma.aiUsage.create({
      data: {
        workspaceId: origin.workspaceId,
        userId: origin.userId ?? null,
        provider: origin.provider,
        model: origin.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        calls: usage.calls,
        managed,
        source: origin.source ?? 'chat',
        costMicroUsd: cost?.costMicroUsd ?? 0,
        chargedMicroUsd: cost?.chargedMicroUsd ?? 0,
      },
    })
  } catch (e) {
    console.error('[usage] failed to record', (e as Error).message)
  }

  // Money moves where the cost is written down. Splitting the two would sooner
  // or later grow a path that meters an answer without charging for it.
  if (!managed || !cost || cost.chargedMicroUsd <= 0 || !origin.userId) return

  const left = await debit(prisma, origin.userId, cost.chargedMicroUsd)
  if (left === null) return

  // Spent into the ground → freeze writing too, not just the model. Dynamic
  // import keeps usage.ts out of the subscription→wallet→usage cycle.
  if (left <= 0) {
    const uid = origin.userId
    void import('./subscription.js').then((m) => m.syncFreeze(prisma, uid)).catch(() => {})
  }

  // Warn once per crossing, not on every answer below the line.
  const before = left + cost.chargedMicroUsd
  if (before > lowBalanceMicroUsd() && left <= lowBalanceMicroUsd()) {
    void origin.onLowBalance?.(left).catch(() => {})
    console.warn(`[wallet] low balance for ${origin.userId}: ${usd(left)}`)
  }
}

// ─── Model prices and the margin ──────────────────────────────────────────────
// Only models we may run on OUR key need a price. A BYOK answer costs us
// nothing — the user pays his provider directly, and that is the whole promise
// on the landing page ("0% markup"). So an unknown model yields `null` cost
// rather than a guess: a fabricated number in a billing table is worse than an
// honest blank.
//
// Prices are per 1M tokens, in US dollars, as published by the provider.
// Source: https://api-docs.deepseek.com/quick_start/pricing — checked 2026-07-10.
// They change; MODEL_PRICES is the single place to change them, and every
// ai_usage row stores the cost computed at the time it was written, so an
// old row keeps the price that actually applied.

import type { PrismaClient } from '@prisma/client'

export interface ModelPrice {
  /** Fresh input, per 1M tokens. */
  input: number
  /** Input served from the provider's prompt cache, per 1M tokens. */
  cachedInput: number
  output: number
}

/** Shipped defaults. An admin may override any of them, and add his own. */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // Language model. Source: api-docs.deepseek.com/quick_start/pricing (2026-07-10).
  'deepseek-v4-pro':   { input: 0.435, cachedInput: 0.003625, output: 0.87 },
  'deepseek-v4-flash': { input: 0.14,  cachedInput: 0.0028,   output: 0.28 },

  // Document recognition (receipts, lab results).
  'gpt-4o-mini':       { input: 0.15,  cachedInput: 0.075,    output: 0.60 },

  // Embeddings: input only, so `output` is zero rather than absent — a missing
  // field would read as "unknown price" and silence the meter.
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, cachedInput: 0.13, output: 0 },
}

/**
 * Images are not sold by the token: they are sold by the picture. Keyed by the
 * model id the provider expects, in US dollars per generated image.
 *
 * FLUX.1 [dev] on fal.ai is priced per megapixel; a default 1024x1024 render is
 * ~1 MP, which is what this number assumes.
 */
export const DEFAULT_IMAGE_PRICES: Record<string, number> = {
  'fal-ai/flux/dev': 0.025,
  'fal-ai/flux/schnell': 0.003,
  'dall-e-3': 0.04,
}

/** Cost of one generated image, or null when the model has no published price. */
export function costOfImage(model: string, managed: boolean): UsageCost | null {
  const usd = IMAGE_PRICES()[model]
  if (usd === undefined) return null
  const costMicroUsd = toMicroUsd(usd)
  return { costMicroUsd, chargedMicroUsd: managed ? toMicroUsd(usd * margin()) : 0 }
}

/** Default markup on top of the provider's price. Editable from the admin panel. */
export const DEFAULT_MARGIN_PERCENT = 50

// ─── Live prices ──────────────────────────────────────────────────────────────
// Provider prices change more often than we deploy, so the admin edits them.
// Kept in memory because `costOf` runs on the path of every answer; primed at
// boot and rewritten when an admin saves. The code's defaults fill any gap, so
// an empty override table behaves exactly like no override table at all.

interface PricingOverrides {
  models?: Record<string, ModelPrice>
  images?: Record<string, number>
  marginPercent?: number
}

let overrides: PricingOverrides = {}

export function setPricingOverrides(o: PricingOverrides | null | undefined): void {
  overrides = o ?? {}
}

export const MODEL_PRICES = (): Record<string, ModelPrice> => ({ ...DEFAULT_MODEL_PRICES, ...(overrides.models ?? {}) })
export const IMAGE_PRICES = (): Record<string, number> => ({ ...DEFAULT_IMAGE_PRICES, ...(overrides.images ?? {}) })

/** Multiplier applied to the provider's price when the tokens run on our key. */
export const margin = (): number => 1 + (overrides.marginPercent ?? DEFAULT_MARGIN_PERCENT) / 100
export const marginPercent = (): number => overrides.marginPercent ?? DEFAULT_MARGIN_PERCENT

/** Money is kept in micro-dollars (1e-6 USD) — an integer, so no float drift
 *  accumulates over thousands of cheap answers. One agent answer costs on the
 *  order of 1000 of these. */
export type MicroUsd = number

export const toMicroUsd = (usd: number): MicroUsd => Math.round(usd * 1_000_000)
export const fromMicroUsd = (micro: MicroUsd): number => micro / 1_000_000

export interface UsageCost {
  /** The provider's price for these tokens, whoever paid it. Recorded for BYOK
   *  answers too: it is what that user WOULD cost on our key, which is exactly
   *  the number needed to pick a margin. */
  costMicroUsd: MicroUsd
  /** What the user is charged: cost × MARGIN. Zero for BYOK — we paid nothing. */
  chargedMicroUsd: MicroUsd
}

/**
 * Cost of one answer. Returns `null` when the model has no published price
 * here — the caller stores zeros and the admin UI shows the row as unpriced.
 */
export function costOf(
  model: string,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
  managed: boolean,
): UsageCost | null {
  const price = MODEL_PRICES()[model]
  if (!price) return null

  const dollars =
    (usage.inputTokens * price.input +
     usage.cachedInputTokens * price.cachedInput +
     usage.outputTokens * price.output) / 1_000_000

  const costMicroUsd = toMicroUsd(dollars)
  // BYOK: the tokens were never ours to pay for, so nothing is charged.
  return { costMicroUsd, chargedMicroUsd: managed ? toMicroUsd(dollars * margin()) : 0 }
}

/** Human-readable dollars, for text a person reads. Lives here, not in wallet.ts,
 *  so subscription.ts can format money without importing the wallet — which
 *  imports subscription. An ESM cycle resolves to `undefined` at just the wrong
 *  moment. */
export const usd = (micro: MicroUsd): string => {
  const v = fromMicroUsd(micro)
  return '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3))
}

export const isPriced = (model: string): boolean => model in MODEL_PRICES() || model in IMAGE_PRICES()

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Read the admin's price table into memory. Called once at startup. */
export async function primePricing(prisma: PrismaClient): Promise<void> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { pricing: true } })
    setPricingOverrides((row?.pricing ?? {}) as PricingOverrides)
  } catch (e) {
    console.error('[pricing] could not load overrides', (e as Error).message)
  }
  const n = Object.keys(overrides.models ?? {}).length + Object.keys(overrides.images ?? {}).length
  console.log(`[pricing] margin +${marginPercent()}%, ${n} custom price(s)`)
}

/** Everything the admin panel shows: defaults merged with his edits. */
export function pricingForAdmin() {
  return {
    marginPercent: marginPercent(),
    models: MODEL_PRICES(),
    images: IMAGE_PRICES(),
    defaults: { models: DEFAULT_MODEL_PRICES, images: DEFAULT_IMAGE_PRICES, marginPercent: DEFAULT_MARGIN_PERCENT },
  }
}

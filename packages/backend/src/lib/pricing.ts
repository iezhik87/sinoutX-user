// ─── Model prices and the margin ──────────────────────────────────────────────
// Only models we may run on OUR key need a price. A BYOK answer costs us
// nothing — the user pays his provider directly, and that is the whole promise
// on the landing page ("0% markup"). So an unknown model yields `null` cost
// rather than a guess: a fabricated number in a billing table is worse than an
// honest blank.
//
// Prices are per 1M tokens, in US dollars, as published by the provider.
// Source: https://api-docs.deepseek.com/quick_start/pricing — checked 2026-08-30.
// They rose since the first version of this file and nobody noticed for weeks,
// because nothing here fails when a price is stale — it just quietly bills the
// wrong amount. Re-check when the managed model changes.
// They change; MODEL_PRICES is the single place to change them, and every
// ai_usage row stores the cost computed at the time it was written, so an
// old row keeps the price that actually applied.

import type { PrismaClient } from '@prisma/client'
import { getManagedAi, getManagedVision, getManagedEmbeddings, getManagedImage } from './managed.js'

export interface ModelPrice {
  /** Fresh input, per 1M tokens. */
  input: number
  /** Input served from the provider's prompt cache, per 1M tokens. */
  cachedInput: number
  output: number
}

/** Shipped defaults. An admin may override any of them, and add his own. */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // Language model. Source: api-docs.deepseek.com/quick_start/pricing (2026-08-30).
  //
  // DeepSeek bills two rates: peak (01:00-04:00 and 06:00-10:00 UTC, Mon-Fri)
  // and off-peak at exactly half. Peak covers 35 of the 168 hours in a week, so
  // the numbers below are off-peak x 1.208 — what the same traffic costs on
  // average over a week. Booking off-peak would lose money every weekday
  // morning; booking peak would overcharge everyone the rest of the time.
  //
  // These apply to DeepSeek's OWN endpoint, which reports no cost of its own.
  // Through OpenRouter the real figure comes back with the answer and wins over
  // this table entirely — see TokenUsage.costUsd.
  'deepseek-v4-pro':   { input: 0.797,  cachedInput: 0.0266,  output: 2.392 },
  'deepseek-v4-flash': { input: 0.2658, cachedInput: 0.00846, output: 0.797 },

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

/** Model ids this instance can actually be billed for right now, straight from
 *  "Ключи SinoutX" — the ONE place that decides what runs. Image gen is priced
 *  per picture in a separate table, not here. */


// ─── Prices of what is actually running ───────────────────────────────────────

export type PricingSlotId = 'ai' | 'vision' | 'embeddings' | 'image'

export interface PricingSlot {
  slot: PricingSlotId
  provider: string | null
  model: string | null
  /** Per 1M tokens. Null means we have no price — those tokens bill as zero. */
  price: ModelPrice | null
  /** Per picture; the image slot is billed that way, not by tokens. */
  perImage: number | null
  /** Image slot only: what the provider charges per 1M image-output tokens. */
  imageOutputPer1M?: number | null
  /** Image slot only: that price turned into one picture, as a suggestion. */
  suggestedPerImage?: number | null
}

/**
 * One row per configured slot — nothing else. The price table used to be a list
 * the admin curated by hand, which drifted from what the instance actually ran:
 * rows for models nobody used, and no row for the model that had just been
 * switched to. What runs is decided in the slots above; this only reports what
 * it costs.
 */
export function activePricingSlots(): PricingSlot[] {
  const prices = MODEL_PRICES()
  const images = IMAGE_PRICES()
  const ai = getManagedAi()
  const vision = getManagedVision()
  const emb = getManagedEmbeddings()
  const img = getManagedImage()

  const tokens = (slot: PricingSlotId, provider: string | null, model?: string): PricingSlot => ({
    slot,
    provider,
    model: model ?? null,
    price: model ? (prices[model] ?? null) : null,
    perImage: null,
  })

  return [
    tokens('ai', ai?.provider ?? null, ai?.model),
    tokens('vision', vision?.provider ?? null, vision?.model),
    // The embeddings slot stores no provider name — only a base URL and a model.
    tokens('embeddings', null, emb?.model),
    {
      slot: 'image',
      provider: img?.provider ?? null,
      model: img?.model ?? null,
      price: null,
      perImage: img?.model ? (images[img.model] ?? null) : null,
    },
  ]
}

/**
 * Merge ONE model's price into the stored overrides. The admin PATCH replaces
 * the whole blob (the form sends a full snapshot); everything automatic writes
 * a single model and must not clobber the rest, hence read-merge-write.
 */
export async function upsertModelPrice(prisma: PrismaClient, modelId: string, price: ModelPrice): Promise<void> {
  const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { pricing: true } })
  const current = (existing?.pricing ?? {}) as { marginPercent?: number; models?: Record<string, ModelPrice>; images?: Record<string, number> }
  const next = { ...current, models: { ...current.models, [modelId]: price } }
  const row = await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', pricing: next as object },
    update: { pricing: next as object },
    select: { pricing: true },
  })
  setPricingOverrides(row.pricing as never)
}

/** Same read-merge-write as upsertModelPrice, for the per-picture table. */
export async function upsertImagePrice(prisma: PrismaClient, modelId: string, perImage: number): Promise<void> {
  const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { pricing: true } })
  const current = (existing?.pricing ?? {}) as { marginPercent?: number; models?: Record<string, ModelPrice>; images?: Record<string, number> }
  const next = { ...current, images: { ...current.images, [modelId]: perImage } }
  const row = await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', pricing: next as object },
    update: { pricing: next as object },
    select: { pricing: true },
  })
  setPricingOverrides(row.pricing as never)
}

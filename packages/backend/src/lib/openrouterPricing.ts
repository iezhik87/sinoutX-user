// Live data from OpenRouter's public catalog: pricing (used to auto-fill the
// admin pricing table and to drive the nightly drift check, see cron.ts) and
// the plain id/name list (used to let the admin PICK a model instead of
// typing an id by hand — a typo there is a silent 404, not an error anyone
// notices until billing is wrong).
//
// The endpoint is public — no API key needed to read it — and returns pricing
// for every model OpenRouter serves, in dollars per TOKEN. Sinout prices in
// dollars per 1M tokens, hence the ×1e6 below.
import type { ModelPrice } from './pricing.js'

interface OpenRouterModelEntry {
  id: string
  name?: string
  context_length?: number
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

export interface OpenRouterModelOption {
  id: string
  label: string
}

const CATALOG_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 5 * 60 * 1000

// Cache the raw list once and derive both views from it — a picker fetch and
// a price fetch minutes apart should not mean two round trips to OpenRouter.
let cache: { at: number; entries: OpenRouterModelEntry[] } | null = null

async function loadRaw(): Promise<OpenRouterModelEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries

  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`OpenRouter models catalog: HTTP ${res.status}`)
  const json = await res.json() as { data?: OpenRouterModelEntry[] }
  const entries = json.data ?? []

  cache = { at: Date.now(), entries }
  return entries
}

function toPrice(m: OpenRouterModelEntry): ModelPrice | null {
  const promptUsd = Number(m.pricing?.prompt)
  const completionUsd = Number(m.pricing?.completion)
  if (!Number.isFinite(promptUsd) || !Number.isFinite(completionUsd)) return null

  const input = promptUsd * 1_000_000
  const output = completionUsd * 1_000_000
  // Not every model publishes a cache-read discount — fall back to the full
  // input price (no discount assumed) rather than guessing a number.
  const cachedRaw = Number(m.pricing?.input_cache_read)
  const cachedInput = Number.isFinite(cachedRaw) ? cachedRaw * 1_000_000 : input

  return { input, cachedInput, output }
}

export interface ResolvedPrice {
  price: ModelPrice
  /** The OpenRouter id the price actually came from — echoed back so a match
   *  found by the fallback below (not the row's own id) is never silent. */
  resolvedId: string
}

/**
 * Live price for one model. Tries the id as-is first; if that fails AND the id
 * has no vendor prefix (our own shipped defaults are stored bare — "deepseek-
 * v4-pro", "gpt-4o-mini" — because they were priced for a DIRECT provider key,
 * not OpenRouter), falls back to searching the catalog for an id ending in
 * "/<modelId>". Exactly one hit is used; more than one is genuinely ambiguous
 * and is reported rather than guessed at.
 */
export async function resolveOpenRouterPrice(
  modelId: string,
): Promise<ResolvedPrice | { ambiguous: string[] } | null> {
  const entries = await loadRaw()

  const exact = entries.find((e) => e.id === modelId)
  if (exact) {
    const p = toPrice(exact)
    return p ? { price: p, resolvedId: exact.id } : null
  }
  if (modelId.includes('/')) return null // already fully-qualified — no fallback to try

  const suffix = '/' + modelId
  const matches = entries.filter((e) => e.id.endsWith(suffix))
  if (matches.length === 1) {
    const p = toPrice(matches[0])
    return p ? { price: p, resolvedId: matches[0].id } : null
  }
  if (matches.length > 1) return { ambiguous: matches.map((e) => e.id) }
  return null
}

/** The full live price catalog, for the drift check to sweep in one fetch. */
export async function fetchOpenRouterCatalog(): Promise<Map<string, ModelPrice>> {
  const entries = await loadRaw()
  const byId = new Map<string, ModelPrice>()
  for (const m of entries) {
    const p = toPrice(m)
    if (p) byId.set(m.id, p)
  }
  return byId
}

/** id + human label for every model, sorted — for a picker, not a price lookup. */
export async function fetchOpenRouterModelList(): Promise<OpenRouterModelOption[]> {
  const entries = await loadRaw()
  return entries
    .map((m) => ({ id: m.id, label: `${m.name ?? m.id} (ctx: ${m.context_length ?? '?'})` }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

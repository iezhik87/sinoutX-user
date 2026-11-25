import { config } from '../config/index.js'

/** USD per million tokens; zero disables that dimension, absent inherits env. */
export interface OpenRouterMaxPrice { prompt?: number; completion?: number }

export function effectiveMaxPrice(cap?: OpenRouterMaxPrice | null): Required<OpenRouterMaxPrice> {
  return { prompt: cap?.prompt ?? config.OPENROUTER_MAX_PROMPT_USD, completion: cap?.completion ?? config.OPENROUTER_MAX_COMPLETION_USD }
}

export function isOpenRouter(baseUrl: string): boolean {
  try { return /(^|\.)openrouter\.ai$/i.test(new URL(baseUrl).hostname) } catch { return false }
}

export function openRouterPriceCap(baseUrl: string, enabled: boolean, cap?: OpenRouterMaxPrice | null): Record<string, unknown> {
  if (!enabled || !isOpenRouter(baseUrl)) return {}
  const limits = effectiveMaxPrice(cap)
  const maxPrice = Object.fromEntries(Object.entries(limits).filter(([, value]) => value > 0))
  return Object.keys(maxPrice).length ? { provider: { max_price: maxPrice } } : {}
}

// Do not equate every "no providers" error with a price error: account/region/
// privacy restrictions can also remove endpoints. Match only a price constraint.
export const isPriceCapRejection = (text: string): boolean => /max[_\s-]*price|price[_\s-]*(?:cap|ceiling)/i.test(text)

export class PriceCapError extends Error {
  readonly code = 'price_cap_exceeded'
  readonly status = 503
  readonly retryable = false
  constructor(model: string, cap?: OpenRouterMaxPrice | null, tier?: string) {
    const limits = effectiveMaxPrice(cap)
    const show = (n: number) => n > 0 ? `$${n}` : 'без ограничения'
    super(`OpenRouter не нашёл endpoint для модели «${model}»${tier ? ` (уровень ${tier})` : ''} в пределах ценового потолка. Настройки SinoutX за 1 млн токенов: вход — ${show(limits.prompt)}, выход — ${show(limits.completion)}. Администратору нужно проверить цену модели, потолки и ограничения ключа OpenRouter. Лимит не снят; автоматический повтор отключён.`)
  }
}

export const priceCapErrorBody = (error: PriceCapError) => ({ error: { message: error.message, type: 'invalid_request_error', code: error.code, retryable: false } })

/** Public endpoint prices only, never a paid inference or a request with an
 * operator key. Account/region/privacy restrictions may further reduce availability. */
export async function checkPriceCap(model: string, cap?: OpenRouterMaxPrice | null) {
  const limits = effectiveMaxPrice(cap)
  const unknown = { status: 'unknown' as const, model, limits }
  try {
    const url = `https://openrouter.ai/api/v1/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return unknown
    const json = await response.json() as { data?: { endpoints?: Array<{ pricing?: { prompt?: string; completion?: string } }> } }
    const prices = (json.data?.endpoints ?? []).flatMap((e) => {
      if (e.pricing?.prompt == null || e.pricing.completion == null) return []
      const prompt = Number(e.pricing.prompt) * 1_000_000
      const completion = Number(e.pricing.completion) * 1_000_000
      return Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0 ? [{ prompt, completion }] : []
    })
    if (!prices.length) return unknown
    const matching = prices.filter((p) => (!limits.prompt || p.prompt <= limits.prompt) && (!limits.completion || p.completion <= limits.completion))
    return { status: matching.length ? 'compatible' as const : 'blocked' as const, model, limits, pricedEndpoints: prices.length, matchingEndpoints: matching.length }
  } catch { return unknown }
}

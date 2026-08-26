// ─── What a model costs and what it can do ────────────────────────────────────
// OpenRouter aggregates nearly every vendor (OpenAI, Anthropic, Google, Meta,
// DeepSeek, Qwen…) and is the only source that publishes PRICES through an API —
// the vendors' own /models endpoints list ids and nothing else. So the catalogue
// is built from it, and covers the vendors through it.
//
// What it does NOT carry is any notion of quality: no benchmark, no ranking, and
// the documented `order` parameter is ignored. Quality therefore comes from the
// operator's own rating (AppSettings.modelRatings), never invented here.

export interface CatalogModel {
  id: string
  name: string
  /** Vendor prefix of the id — «google» for «google/gemini-3.5-flash». */
  vendor: string
  /** USD per 1M tokens. 0 means genuinely free, null means the provider hid it. */
  promptPer1M: number | null
  completionPer1M: number | null
  contextLength: number
  maxOutput: number | null
  vision: boolean
  tools: boolean
  reasoning: boolean
  /** Unix seconds; lets the UI mark what is new. */
  created: number
  description: string
  /** Stable keys the UI translates: text | vision | audio | video | tools | reasoning | coding | imagegen. */
  tags: string[]
  /** Draws pictures, rather than only reading them. */
  outputsImage: boolean
  /** USD per 1M image-output tokens — what a generated picture is billed by. */
  imageOutputPer1M: number | null
}

/**
 * Image models are billed by output TOKENS, and a picture is a fixed number of
 * them: 1290 for Gemini's image models, and the same order for OpenAI's. Used
 * only to suggest a per-picture price to the admin — never to bill silently,
 * because the count is the vendor's convention, not something the API states.
 */
export const IMAGE_TOKENS_PER_PICTURE = 1290

// «What is it for» is not a field any provider publishes. Everything below is
// either read off the model's declared capabilities (exact) or matched in the
// vendor's OWN description (their claim, not our judgement) — never guessed.
const CODING_RE = /\b(coding|code|programming|developer|swe[- ]bench|software engineer)/i

function deriveTags(m: {
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: string[]
  description?: string
}): string[] {
  const inputs = m.architecture?.input_modalities ?? []
  const outputs = m.architecture?.output_modalities ?? []
  const params = m.supported_parameters ?? []
  const tags: string[] = ['text']
  if (inputs.includes('image')) tags.push('vision')
  if (inputs.includes('audio')) tags.push('audio')
  if (inputs.includes('video')) tags.push('video')
  if (params.includes('tools')) tags.push('tools')
  if (params.includes('reasoning') || params.includes('include_reasoning')) tags.push('reasoning')
  if (CODING_RE.test(m.description ?? '')) tags.push('coding')
  if (outputs.includes('image')) tags.push('imagegen')
  return tags
}

const CACHE_TTL_MS = 10 * 60 * 1000
let cache: { at: number; models: CatalogModel[] } | null = null

const perMillion = (v: unknown): number | null => {
  const n = Number(v)
  // A negative price is OpenRouter's marker for «decided per request» (the
  // auto-router models). Reported as unknown — passing −1 through would put
  // them at the top of any cheap-first sort and poison the value ranking.
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null
}

/** The live catalogue, cached briefly — it changes on the order of days. */
export async function listCatalogModels(force = false): Promise<CatalogModel[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    if (cache) return cache.models // stale beats empty
    throw new Error(`Каталог моделей недоступен: HTTP ${res.status}`)
  }
  const data = await res.json() as {
    data?: {
      id: string; name?: string; description?: string; created?: number; context_length?: number
      architecture?: { input_modalities?: string[]; output_modalities?: string[] }
      pricing?: { prompt?: string; completion?: string; image_output?: string }
      top_provider?: { max_completion_tokens?: number | null }
      supported_parameters?: string[]
    }[]
  }

  const models: CatalogModel[] = (data.data ?? [])
    // `:batch` variants answer asynchronously — a different product, not a cheaper model.
    .filter((m) => !m.id.includes(':batch'))
    .map((m) => {
      const params = m.supported_parameters ?? []
      return {
        id: m.id,
        name: m.name ?? m.id,
        vendor: m.id.replace(/^~/, '').split('/')[0] ?? '',
        promptPer1M: perMillion(m.pricing?.prompt),
        completionPer1M: perMillion(m.pricing?.completion),
        contextLength: m.context_length ?? 0,
        maxOutput: m.top_provider?.max_completion_tokens ?? null,
        vision: !!m.architecture?.input_modalities?.includes('image'),
        tools: params.includes('tools'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
        created: m.created ?? 0,
        // Long enough for the detail dialog to be worth opening.
        description: (m.description ?? '').slice(0, 2000),
        tags: deriveTags(m),
        outputsImage: !!m.architecture?.output_modalities?.includes('image'),
        imageOutputPer1M: perMillion(m.pricing?.image_output),
      }
    })

  cache = { at: Date.now(), models }
  return models
}

/**
 * Models that DRAW, for the image-generation slot. Hard-coding these went stale
 * exactly like the vision list did — three of the seven ids we shipped had
 * already been retired — so the catalogue decides, by output modality.
 */
export async function listImageGenModels(): Promise<{ id: string; label: string }[]> {
  const models = await listCatalogModels().catch(() => [])
  return models
    .filter((m) => m.outputsImage)
    // The auto-routers declare every modality but pick a model per request —
    // useless as a deliberate choice of image generator.
    .filter((m) => !m.id.startsWith('openrouter/'))
    .map((m) => ({ id: m.id, label: m.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Models that turn text into a vector, asked of the provider itself.
 * Shipping a fixed list rotted here too: both OpenRouter ids we offered
 * (`openai/text-embedding-3-*`) have been retired, and OpenRouter now serves
 * no embedding model at all — so an empty answer is the honest one, not a
 * fallback to names that no longer resolve.
 */
export async function listEmbeddingModels(
  provider: string, apiKey?: string, baseUrl?: string,
): Promise<{ id: string; label: string }[]> {
  const DEFAULT_BASE: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    mistral: 'https://api.mistral.ai/v1',
    together: 'https://api.together.xyz/v1',
    local: 'http://embeddings:80/v1',
  }
  const base = (baseUrl || DEFAULT_BASE[provider] || '').replace(/\/$/, '')
  if (!base) return []
  try {
    // The embedder in the stack serves exactly one model and has no /v1/models
    // (it answers 404). It does report what it loaded at /info — and its name
    // need not contain «embed», so the filter below would drop it anyway.
    if (provider === 'local') {
      const res = await fetch(`${base.replace(/\/v1$/, '')}/info`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return []
      const info = await res.json() as { model_id?: string; served_model_name?: string }
      const id = info.served_model_name || info.model_id
      return id ? [{ id, label: id }] : []
    }

    const res = await fetch(`${base}/models`, {
      signal: AbortSignal.timeout(15_000),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: { id: string; name?: string }[] }
    return (data.data ?? [])
      .filter((m) => /embed/i.test(m.id) || /embed/i.test(m.name ?? ''))
      .map((m) => ({ id: m.id, label: m.name ?? m.id }))
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

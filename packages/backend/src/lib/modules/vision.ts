// Multimodal (vision) extraction for module pipelines — BYOK, configured per
// module instance. Supports Anthropic-native and any OpenAI-compatible provider
// (OpenRouter / OpenAI / Google Gemini OpenAI-endpoint / custom). We curate the
// vision-capable model list so the UI only offers models that can read images.

/** Reports what the call cost, so a managed key can be billed like any other. */
export type UsageSink = (u: { inputTokens: number; cachedInputTokens: number; outputTokens: number }) => void

export interface OcrConfig {
  provider: string // openrouter | openai | google | anthropic | custom
  model: string
  apiKey: string
  baseUrl?: string
  /** Set only when the key is ours: the tokens are then charged to the user. */
  onUsage?: UsageSink
}

export interface VisionFile { base64: string; mime: string }

interface ProviderInfo { label: string; baseUrl: string; anthropic?: boolean; models: { id: string; label: string }[] }

// Providers we can talk to. `models` is only a LAST-RESORT fallback for when the
// provider's own catalogue cannot be reached — a hard-coded list goes stale
// silently (ours did: three of four ids had been retired, and recognition failed
// with «no endpoints for model»). The live list from listVisionModels() wins.
export const OCR_PROVIDERS: Record<string, ProviderInfo> = {
  openrouter: {
    label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    models: [{ id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' }],
  },
  openai: {
    label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }, { id: 'gpt-4o', label: 'GPT-4o' }],
  },
  google: {
    label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }],
  },
  anthropic: {
    label: 'Anthropic', baseUrl: 'https://api.anthropic.com', anthropic: true,
    models: [{ id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }],
  },
  custom: { label: 'Custom', baseUrl: '', models: [] },
}

// Public (no-secret) provider list for the UI.
export function ocrProvidersPublic() {
  return Object.entries(OCR_PROVIDERS).map(([key, p]) => ({ key, label: p.label, models: p.models, custom: key === 'custom' }))
}

/**
 * The provider's OWN list of models that can read an image, fetched live.
 * A key is optional where the catalogue is public (OpenRouter, Google); OpenAI
 * and Anthropic need one. Falls back to OCR_PROVIDERS[provider].models only when
 * the provider cannot be reached, so a stale id can never be the default answer.
 */
export async function listVisionModels(
  provider: string, apiKey?: string, baseUrl?: string,
): Promise<{ id: string; label: string }[]> {
  const info = OCR_PROVIDERS[provider]
  const fallback = info?.models ?? []
  const timeout = AbortSignal.timeout(15_000)
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined

  try {
    if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', { signal: timeout, headers: auth })
      if (!res.ok) return fallback
      const data = await res.json() as { data?: { id: string; name?: string; architecture?: { input_modalities?: string[] } }[] }
      const vision = (data.data ?? [])
        .filter((m) => m.architecture?.input_modalities?.includes('image'))
        // `:batch` variants answer asynchronously — useless for reading a document now.
        .filter((m) => !m.id.includes(':batch'))
        .map((m) => ({ id: m.id, label: m.name ?? m.id }))
      return vision.length ? vision.sort((a, b) => a.label.localeCompare(b.label)) : fallback
    }

    if (provider === 'anthropic') {
      if (!apiKey) return fallback
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        signal: timeout, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) return fallback
      const data = await res.json() as { data?: { id: string; display_name?: string }[] }
      // Every current Claude model reads images; the catalogue states no modality.
      const models = (data.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }))
      return models.length ? models : fallback
    }

    // OpenAI-compatible: OpenAI itself, Google's OpenAI endpoint, or a custom gateway.
    const base = (baseUrl || info?.baseUrl || '').replace(/\/$/, '')
    if (!base) return fallback
    const res = await fetch(`${base}/models`, { signal: timeout, headers: auth })
    if (!res.ok) return fallback
    const data = await res.json() as { data?: { id: string }[] }
    let ids = (data.data ?? []).map((m) => m.id)
    // These catalogues list embeddings, TTS and image generators too, and say
    // nothing about modality — keep the families known to accept an image.
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt-4o|gpt-4\.|gpt-5|o[13])/.test(id) && !/audio|realtime|transcribe|tts/.test(id))
    if (provider === 'google') ids = ids.filter((id) => id.includes('gemini') && !/embedding|imagen|tts/.test(id))
    const models = ids.map((id) => ({ id: id.replace(/^models\//, ''), label: id.replace(/^models\//, '') }))
    return models.length ? models.sort((a, b) => a.label.localeCompare(b.label)) : fallback
  } catch {
    return fallback
  }
}

// Unified extraction: accepts images (vision) and/or already-extracted text
// (e.g. from a digital PDF). Text input works on ANY chat model (cheap, no vision).
export async function runExtraction(
  cfg: OcrConfig,
  input: { images?: VisionFile[]; text?: string },
  prompt: string,
): Promise<string> {
  const onUsage = cfg.onUsage
  if (!cfg.apiKey) throw new Error('OCR API key is not configured for this module')
  const info = OCR_PROVIDERS[cfg.provider]
  const isAnthropic = info?.anthropic
  const images = input.images ?? []
  const head = input.text ? `Lab report text:\n${input.text}\n\n` : ''
  const timeout = AbortSignal.timeout(90_000)

  if (isAnthropic) {
    const content: unknown[] = images.map((f) => f.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } })
    content.push({ type: 'text', text: head + prompt })
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: timeout,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4000, messages: [{ role: 'user', content }] }),
    })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300)
      console.error('[vision] anthropic', res.status, body)
      throw new Error(`Vision API ${res.status}: ${body}`)
    }
    const data = await res.json() as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }
    if (onUsage && data.usage) onUsage({
      inputTokens: data.usage.input_tokens ?? 0,
      cachedInputTokens: data.usage.cache_read_input_tokens ?? 0,
      outputTokens: data.usage.output_tokens ?? 0,
    })
    return data.content?.[0]?.text ?? ''
  }

  // OpenAI-compatible (OpenRouter / OpenAI / Google / custom)
  if (images.some((f) => f.mime === 'application/pdf')) {
    throw new Error('Скан PDF не поддержан этим провайдером — отправьте фото или цифровой PDF с текстом.')
  }
  const baseUrl = (cfg.baseUrl || info?.baseUrl || '').replace(/\/$/, '')
  if (!baseUrl) throw new Error('OCR baseUrl is not configured')
  const userContent: unknown = images.length
    ? [{ type: 'text', text: head + prompt }, ...images.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } }))]
    : `${head}${prompt}`
  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', signal: timeout,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4000, messages: [{ role: 'user', content: userContent }] }),
    })
  } catch (e) {
    console.error('[vision]', cfg.provider, baseUrl, 'fetch failed:', e instanceof Error ? e.message : e)
    throw new Error(`Vision API недоступен (${cfg.provider}): ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    console.error('[vision]', cfg.provider, baseUrl, res.status, body)
    throw new Error(`Vision API ${res.status}: ${body}`)
  }
  const data = await res.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number }
  }
  // A model that declines ("I can't help with that") answers 200/finish=stop with
  // a couple of lines — indistinguishable from success unless it is called out.
  const content = data.choices?.[0]?.message?.content ?? ''
  if (images.length && content.length < 100) {
    console.warn('[vision]', cfg.provider, cfg.model, `images=${images.length}`,
      `finish=${data.choices?.[0]?.finish_reason}`, `suspiciously short answer (${content.length} chars) — model may have refused`)
  }
  if (onUsage && data.usage) {
    // `prompt_tokens` includes cached ones — subtract, or a cache hit is billed
    // at the price of a miss.
    const cached = data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.prompt_cache_hit_tokens ?? 0
    onUsage({
      inputTokens: Math.max(0, (data.usage.prompt_tokens ?? 0) - cached),
      cachedInputTokens: cached,
      outputTokens: data.usage.completion_tokens ?? 0,
    })
  }
  return data.choices?.[0]?.message?.content ?? ''
}

// Extract the first JSON object/array from a model response (handles ```json fences).
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('No JSON found in the model response')
  const slice = body.slice(start)
  try { return JSON.parse(slice) } catch { /* try trimming trailing junk */ }
  // best-effort: cut at last } or ]
  const end = Math.max(slice.lastIndexOf('}'), slice.lastIndexOf(']'))
  return JSON.parse(slice.slice(0, end + 1))
}

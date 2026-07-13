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

// Curated vision-capable models per provider (cheap-first).
export const OCR_PROVIDERS: Record<string, ProviderInfo> = {
  openrouter: {
    label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
      { id: 'qwen/qwen-2-vl-7b-instruct', label: 'Qwen2-VL 7B' },
    ],
  },
  openai: {
    label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }, { id: 'gpt-4o', label: 'GPT-4o' }],
  },
  google: {
    label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }, { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }],
  },
  anthropic: {
    label: 'Anthropic', baseUrl: 'https://api.anthropic.com', anthropic: true,
    models: [{ id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }, { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }],
  },
  custom: { label: 'Custom', baseUrl: '', models: [] },
}

// Public (no-secret) provider list for the UI.
export function ocrProvidersPublic() {
  return Object.entries(OCR_PROVIDERS).map(([key, p]) => ({ key, label: p.label, models: p.models, custom: key === 'custom' }))
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
    if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`)
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
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal: timeout,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, max_tokens: 4000, messages: [{ role: 'user', content: userContent }] }),
  })
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number }
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

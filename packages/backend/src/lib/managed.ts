// ─── Managed provider keys ────────────────────────────────────────────────────
// The keys WE pay for: the built-in language model, image generation and
// embeddings. They live in the database so an operator can rotate them from the
// admin panel instead of editing .env and redeploying.
//
// Three rules that must not bend:
//   1. Encrypted at rest. Whoever reads the database backup does not get the key.
//   2. Never sent to a browser. The admin API reports `hasKey`, never the key.
//   3. Cached decrypted in memory — they are read on the hot path of every
//      answer — and rewritten the moment an admin saves. Primed at boot.
//
// The environment stays a fallback, so an instance configured the old way keeps
// working and a fresh one can still be seeded from .env.
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { encryptSecret, decryptSecret } from './crypto.js'

export interface ManagedSlot {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface ManagedConfig {
  ai: ManagedSlot
  image: ManagedSlot
  embeddings: ManagedSlot
  /** Document recognition (receipts, lab results) for modules that have no key. */
  vision: ManagedSlot
}

/** The single list of slots. Everything that iterates them reads it from here,
 *  so adding a fifth cannot be half-done. */
export const MANAGED_SLOTS = ['ai', 'image', 'vision', 'embeddings'] as const

const empty = (): ManagedConfig => ({ ai: {}, image: {}, embeddings: {}, vision: {} })

/** Decrypted. Never serialize this object into a response. */
let cache: ManagedConfig = empty()

const clean = (s: ManagedSlot | undefined): ManagedSlot => ({
  provider: s?.provider || undefined,
  apiKey: s?.apiKey || undefined,
  model: s?.model || undefined,
  baseUrl: s?.baseUrl || undefined,
})

/** Read the row, decrypt the keys, fill the cache. Called once at startup. */
export async function primeManaged(prisma: PrismaClient): Promise<void> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { managed: true } })
    const raw = (row?.managed ?? {}) as Partial<ManagedConfig>
    cache = {
      ai: { ...clean(raw.ai), apiKey: decryptSecret(raw.ai?.apiKey) },
      image: { ...clean(raw.image), apiKey: decryptSecret(raw.image?.apiKey) },
      embeddings: { ...clean(raw.embeddings), apiKey: decryptSecret(raw.embeddings?.apiKey) },
      vision: { ...clean(raw.vision), apiKey: decryptSecret(raw.vision?.apiKey) },
    }
  } catch (e) {
    console.error('[managed] could not load keys', (e as Error).message)
    cache = empty()
  }
  console.log(`[managed] llm:${getManagedAi() ? 'on' : 'off'} image:${getManagedImage() ? 'on' : 'off'} embeddings:${getManagedEmbeddings() ? 'on' : 'off'} vision:${getManagedVision() ? 'on' : 'off'}`)
}

/**
 * Merge a patch into the stored config and the cache.
 *
 * An empty string CLEARS a key — that is how an admin turns the managed model
 * off. `undefined` leaves it alone, so saving the model name does not wipe the
 * key the form never showed him.
 */
export async function saveManaged(prisma: PrismaClient, patch: Partial<ManagedConfig>): Promise<void> {
  const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { managed: true } })
  const stored = (row?.managed ?? {}) as Partial<ManagedConfig>

  const mergeSlot = (key: keyof ManagedConfig): ManagedSlot => {
    const old = stored[key] ?? {}
    const p = patch[key]
    if (!p) return old
    const next: ManagedSlot = { ...old }
    if (p.provider !== undefined) next.provider = p.provider || undefined
    if (p.model !== undefined) next.model = p.model || undefined
    if (p.baseUrl !== undefined) next.baseUrl = p.baseUrl || undefined
    if (p.apiKey !== undefined) next.apiKey = p.apiKey ? encryptSecret(p.apiKey) : undefined
    return next
  }

  const merged: ManagedConfig = {
    ai: mergeSlot('ai'),
    image: mergeSlot('image'),
    embeddings: mergeSlot('embeddings'),
    vision: mergeSlot('vision'),
  }

  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', managed: merged as object },
    update: { managed: merged as object },
  })

  cache = {
    ai: { ...clean(merged.ai), apiKey: decryptSecret(merged.ai.apiKey) },
    image: { ...clean(merged.image), apiKey: decryptSecret(merged.image.apiKey) },
    embeddings: { ...clean(merged.embeddings), apiKey: decryptSecret(merged.embeddings.apiKey) },
    vision: { ...clean(merged.vision), apiKey: decryptSecret(merged.vision.apiKey) },
  }
}

/** What the admin UI may see: everything except the secret itself. */
export function managedForAdmin(): Record<string, { hasKey: boolean; provider?: string; model?: string; baseUrl?: string }> {
  const view = (s: ManagedSlot, envKey?: string) => ({
    hasKey: !!(s.apiKey || envKey),
    provider: s.provider,
    model: s.model,
    baseUrl: s.baseUrl,
  })
  return {
    ai: view(cache.ai, config.MANAGED_AI_KEY),
    image: view(cache.image),
    embeddings: view(cache.embeddings, process.env.EMBEDDINGS_API_KEY),
    vision: view(cache.vision),
  }
}

/** Model names only — safe for any authenticated user, so the settings screen can
 *  say what the built-in mode actually runs on. Never includes a key. */
export function managedSummary() {
  const ai = getManagedAi()
  const img = getManagedImage()
  const vis = getManagedVision()
  const emb = getManagedEmbeddings()
  return {
    available: !!ai,
    model: ai?.model ?? '',
    provider: ai?.provider,
    image: img ? `${img.provider ?? ''}${img.model ? ` · ${img.model}` : ''}`.trim() : null,
    vision: vis ? `${vis.provider} · ${vis.model}` : null,
    embeddings: emb ? emb.model : null,
  }
}

// ─── Consumers ────────────────────────────────────────────────────────────────

/**
 * The built-in language model, or null when this instance has none.
 *
 * `provider` matters beyond cosmetics: Anthropic speaks its own protocol, so the
 * caller has to route the request differently. Everything else is OpenAI-shaped.
 */
export function getManagedAi(): { provider: string; apiKey: string; model: string; baseUrl?: string } | null {
  const apiKey = cache.ai.apiKey || config.MANAGED_AI_KEY
  if (!apiKey) return null
  const provider = cache.ai.provider || 'deepseek'
  return {
    provider,
    apiKey,
    model: cache.ai.model || config.MANAGED_AI_MODEL,
    // Empty means «use the provider's default», resolved by the caller.
    baseUrl: cache.ai.baseUrl || (provider === 'deepseek' ? config.MANAGED_AI_BASE_URL : undefined),
  }
}

/** Image generation on our key. `pollinations` needs none, so a provider without
 *  a key is still a valid answer. */
export function getManagedImage(): ManagedSlot | null {
  if (!cache.image.provider && !cache.image.apiKey) return null
  return cache.image
}

/**
 * Document recognition on our key. Used when a module has no vision key of its
 * own — a receipt should be read, not refused because the user never opened the
 * module's settings.
 */
export function getManagedVision(): { provider: string; model: string; apiKey: string; baseUrl?: string } | null {
  const { provider, model, apiKey, baseUrl } = cache.vision
  if (!provider || !model || !apiKey) return null
  return { provider, model, apiKey, baseUrl }
}

/** Embeddings on our key: DB first, then the legacy EMBEDDINGS_* env vars. */
/** Where a provider answers, when no base URL was typed in. */
const EMBEDDINGS_BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  local:      'http://embeddings:80/v1',
  together:   'https://api.together.xyz/v1',
  mistral:    'https://api.mistral.ai/v1',
}

export function getManagedEmbeddings(): { apiKey: string; baseUrl: string; model: string } | null {
  // Same rule as the workspace resolver: the in-stack embedder needs no key.
  if (cache.embeddings.apiKey || cache.embeddings.provider === 'local') {
    return {
      apiKey: cache.embeddings.apiKey ?? '',
      // The slot records WHICH provider was chosen — honour it. Defaulting to
      // OpenAI regardless sent an OpenRouter key to api.openai.com, which
      // answered 403 and left every embedding silently unwritten.
      baseUrl: cache.embeddings.baseUrl
        || EMBEDDINGS_BASE_URLS[cache.embeddings.provider ?? '']
        || 'https://api.openai.com/v1',
      model: cache.embeddings.model || 'text-embedding-3-small',
    }
  }
  if (process.env.EMBEDDINGS_API_KEY) {
    return {
      apiKey: process.env.EMBEDDINGS_API_KEY,
      baseUrl: process.env.EMBEDDINGS_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
    }
  }
  return null
}

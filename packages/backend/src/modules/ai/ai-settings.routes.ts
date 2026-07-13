import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { createHmac } from 'crypto'
import { getUserAISettings, saveAISettings, AI_DEFAULTS, completeOnce, embeddingsCfgFromParts, type AIProvider } from './ai.service.js'
import { embed } from '../../lib/embeddings.js'
import { config } from '../../config/index.js'
import { getManagedAi, managedSummary } from '../../lib/managed.js'
import { getCustomTools, saveCustomTools, maskCustomTool, executeCustomTool, SKILL_BUILDER_SYSTEM, buildAssemblyUserMessage, parseAssembled, type CustomTool } from './ai.customtools.js'
import { TOOL_CATALOG } from './ai.tools.js'
import { denyIfNotMember, denyIfNotAdmin } from '../../lib/requireAccess.js'
import { getPersonalWorkspaceId } from '../../lib/personal.js'
import { writeAuditLog } from '../../lib/audit.js'

function klingBearerToken(apiKey: string): string {
  const colonIdx = apiKey.indexOf(':')
  if (colonIdx === -1) return apiKey
  const accessKey = apiKey.slice(0, colonIdx)
  const secretKey = apiKey.slice(colonIdx + 1)
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now     = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url')
  const sig     = createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// Every value AIProvider can hold. It listed five of thirteen, so saving Groq,
// Mistral, xAI, Together, Perplexity, Google, a custom gateway — or switching to
// the built-in model — failed with a bare «Validation Error».
const providerEnum = z.enum([
  'sinoutx', 'anthropic', 'openai', 'openrouter', 'ollama', 'deepseek',
  'groq', 'mistral', 'xai', 'together', 'perplexity', 'google', 'custom',
])
const imageProviderEnum = z.enum(['pollinations', 'openai', 'openrouter', 'flux', 'stability', 'fal', 'custom'])

const aiSettingsSchema = z.object({
  provider:           providerEnum.optional(),
  resetProvider:      providerEnum.optional(),
  resetImage:         z.boolean().optional(),
  resetEmbeddings:    z.boolean().optional(),
  temperature:        z.number().min(0).max(2).optional(),
  maxTokens:          z.number().min(256).max(32768).optional(),
  customSystemPrompt: z.string().optional(),
  assistantName:      z.string().max(80).optional(),
  assistantPersona:   z.string().max(4000).optional(),
  enabledTools:       z.array(z.string()).optional(),
  // Per-provider config patch
  providerConfig: z.object({
    provider: providerEnum,
    apiKey:   z.string().optional(),
    baseUrl:  z.string().optional(),
    model:    z.string().optional(),
  }).optional(),
  // Image generation provider
  imageGeneration: z.object({
    provider: imageProviderEnum,
    apiKey:   z.string().optional(),
    model:    z.string().optional(),
  }).optional(),
  // Audio generation provider
  audioGeneration: z.object({
    provider: z.enum(['openai', 'elevenlabs', 'playht', 'pollinations', 'browser', 'custom']),
    apiKey:   z.string().optional(),
    model:    z.string().optional(),
    baseUrl:  z.string().optional(),
  }).optional(),
  // Embeddings provider (separate BYOK key — semantic memory recall)
  embeddings: z.object({
    provider: z.enum(['openai', 'openrouter', 'together', 'mistral', 'custom']),
    apiKey:   z.string().optional(),
    model:    z.string().optional(),
    baseUrl:  z.string().optional(),
  }).optional(),
  searchRegion: z.string().optional(),
  timezone: z.string().optional(),
})

function maskKey(k: string | undefined): string {
  if (!k) return ''
  return `${'*'.repeat(Math.max(0, k.length - 6))}${k.slice(-6)}`
}

function maskProviders(providers: Record<string, { apiKey?: string; baseUrl?: string; model?: string }>) {
  const result: typeof providers = {}
  for (const p of Object.keys(providers)) {
    result[p] = { ...providers[p], apiKey: maskKey(providers[p].apiKey) }
  }
  return result
}

export async function aiSettingsRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /ai/settings?workspaceId=xxx — load settings + tool catalog
  app.get('/ai/settings', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const settings = await getUserAISettings(req.authUser!.id, prisma)
    const maskedImg = settings.imageGeneration
      ? { ...settings.imageGeneration, apiKey: maskKey(settings.imageGeneration.apiKey) }
      : undefined
    const maskedAud = settings.audioGeneration
      ? { ...settings.audioGeneration, apiKey: maskKey(settings.audioGeneration.apiKey) }
      : undefined
    const maskedEmb = settings.embeddings
      ? { ...settings.embeddings, apiKey: maskKey(settings.embeddings.apiKey) }
      : undefined
    const customTools = (await getCustomTools(workspaceId, prisma)).map(maskCustomTool)
    return reply.send({
      settings: { ...settings, providers: maskProviders(settings.providers), imageGeneration: maskedImg, audioGeneration: maskedAud, embeddings: maskedEmb },
      defaults: AI_DEFAULTS,
      catalog: TOOL_CATALOG,
      customTools,
    })
  })

  // PUT /ai/settings?workspaceId=xxx — update settings
  app.put('/ai/settings', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = aiSettingsSchema.parse(req.body)

    // If apiKey is all-asterisks (masked, not changed) — don't overwrite
    let providerConfig = body.providerConfig
    if (providerConfig?.apiKey && /^\*+.{0,6}$/.test(providerConfig.apiKey)) {
      providerConfig = { ...providerConfig, apiKey: undefined }
    }

    let imageGeneration = body.imageGeneration
    if (imageGeneration?.apiKey && /^\*+.{0,6}$/.test(imageGeneration.apiKey)) {
      imageGeneration = { ...imageGeneration, apiKey: undefined }
    }


    let audioGeneration = body.audioGeneration
    if (audioGeneration?.apiKey && /^\*+.{0,6}$/.test(audioGeneration.apiKey)) {
      audioGeneration = { ...audioGeneration, apiKey: undefined }
    }

    let embeddings = body.embeddings
    if (embeddings?.apiKey && /^\*+.{0,6}$/.test(embeddings.apiKey)) {
      embeddings = { ...embeddings, apiKey: undefined }
    }

    const updated = await saveAISettings(req.authUser!.id, { ...body, providerConfig, imageGeneration, audioGeneration, embeddings }, prisma)
    await writeAuditLog(prisma, { action: 'ai_settings.updated', workspaceId, userId: req.authUser!.id, ip: req.ip })
    const maskedImg = updated.imageGeneration
      ? { ...updated.imageGeneration, apiKey: maskKey(updated.imageGeneration.apiKey) }
      : undefined
    const maskedAudUpd = updated.audioGeneration
      ? { ...updated.audioGeneration, apiKey: maskKey(updated.audioGeneration.apiKey) }
      : undefined
    const maskedEmbUpd = updated.embeddings
      ? { ...updated.embeddings, apiKey: maskKey(updated.embeddings.apiKey) }
      : undefined
    return reply.send({ ok: true, settings: { ...updated, providers: maskProviders(updated.providers), imageGeneration: maskedImg, audioGeneration: maskedAudUpd, embeddings: maskedEmbUpd } })
  })

  // ── Custom tools (user-defined HTTP navыки) ─────────────────────────────────

  // GET /ai/custom-tools — list (masked secrets)
  app.get('/ai/custom-tools', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send({ tools: (await getCustomTools(workspaceId, prisma)).map(maskCustomTool) })
  })

  // POST /ai/custom-tools — create or update one (upsert by id)
  app.post('/ai/custom-tools', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotAdmin(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({ tool: z.any() }).parse(req.body)
    const incoming = { ...(body.tool as Partial<CustomTool>), createdBy: req.authUser!.id }
    const existing = await getCustomTools(workspaceId, prisma)
    const merged = [...existing.filter((t) => t.id !== incoming.id), incoming]
    const saved = await saveCustomTools(workspaceId, prisma, merged)
    await writeAuditLog(prisma, { action: 'ai_settings.updated', workspaceId, userId: req.authUser!.id, ip: req.ip })
    return reply.send({ tools: saved.map(maskCustomTool) })
  })

  // DELETE /ai/custom-tools/:id
  app.delete('/ai/custom-tools/:id', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    const { id } = z.object({ id: z.string() }).parse(req.params)
    if (await denyIfNotAdmin(prisma, workspaceId, req.authUser!.id, reply)) return
    const existing = await getCustomTools(workspaceId, prisma)
    const saved = await saveCustomTools(workspaceId, prisma, existing.filter((t) => t.id !== id))
    return reply.send({ tools: saved.map(maskCustomTool) })
  })

  // POST /ai/custom-tools/assemble — AI builds a draft from a description (+curl/docs)
  app.post('/ai/custom-tools/assemble', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotAdmin(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({ description: z.string().min(1), curl: z.string().optional(), docs: z.string().optional(), lang: z.string().optional() }).parse(req.body)
    const lang = body.lang ?? 'ru'
    const sys = SKILL_BUILDER_SYSTEM.split('{LANG}').join(lang)
    const user = buildAssemblyUserMessage({ lang, description: body.description, curl: body.curl, docs: body.docs })
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await completeOnce(workspaceId, sys, user, prisma)
        return reply.send({ draft: parseAssembled(text) })
      } catch (e) { lastErr = e }
    }
    return reply.status(422).send({ error: lastErr instanceof Error ? lastErr.message : 'Assembly failed' })
  })

  // POST /ai/custom-tools/test — run an (unsaved) tool with sample input
  app.post('/ai/custom-tools/test', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotAdmin(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({ tool: z.any(), input: z.record(z.any()).optional() }).parse(req.body)
    try {
      const result = await executeCustomTool(body.tool as CustomTool, body.input ?? {})
      return reply.send({ result })
    } catch (e) {
      return reply.status(422).send({ error: e instanceof Error ? e.message : 'Test failed' })
    }
  })

  // POST /ai/settings/test — test connection to provider, return available models
  // Default endpoints for the OpenAI-shaped providers, so a test needs no Base URL.
  const providerBaseUrlFor = (p: string): string => ({
    groq:       'https://api.groq.com/openai/v1',
    mistral:    'https://api.mistral.ai/v1',
    xai:        'https://api.x.ai/v1',
    together:   'https://api.together.xyz/v1',
    perplexity: 'https://api.perplexity.ai',
    google:     'https://generativelanguage.googleapis.com/v1beta/openai',
  }[p] ?? '')

  app.post('/ai/settings/test', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query)
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    // Any provider, not the five that happened to have a hand-written branch:
    // rejecting the rest with a 400 made the button look broken rather than the
    // provider unsupported.
    const body = z.object({
      provider: z.string().min(1).max(64),
      apiKey:   z.string().optional(),
      baseUrl:  z.string().optional(),
      model:    z.string().optional(),
    }).parse(req.body)

    const { provider, baseUrl, model } = body

    // If the key looks masked (sent back from GET), resolve the real key from DB
    let apiKey = body.apiKey
    if (workspaceId && apiKey && /^\*+.{0,6}$/.test(apiKey)) {
      const stored = await getUserAISettings(req.authUser!.id, prisma)
      apiKey = stored.providers?.[provider as AIProvider]?.apiKey ?? apiKey
    }

    try {
      if (provider === 'ollama') {
        // Ollama: GET /api/tags — lists installed models
        const base = (baseUrl ?? 'http://host.docker.internal:11434').replace(/\/v1\/?$/, '')
        const res  = await fetch(`${base}/api/tags`, {
          signal: AbortSignal.timeout(5_000),
        })
        if (!res.ok) return reply.send({ ok: false, error: `Ollama responded with HTTP ${res.status}` })
        const data = await res.json() as { models?: Array<{ name: string; size: number; modified_at: string }> }
        const models = (data.models ?? []).map((m) => ({ id: m.name, label: m.name }))
        return reply.send({ ok: true, models, message: `Ollama доступна. Найдено ${models.length} моделей.` })
      }

      if (provider === 'openrouter') {
        if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен для OpenRouter' })
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `OpenRouter: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { data?: Array<{ id: string; name: string; context_length: number }> }
        const models = (data.data ?? [])
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: `${m.name ?? m.id} (ctx: ${m.context_length ?? '?'})` }))
        return reply.send({ ok: true, models, message: `OpenRouter подключён. Доступно ${models.length} моделей.` })
      }

      if (provider === 'openai') {
        if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен для OpenAI' })
        const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
        const res  = await fetch(`${base}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `OpenAI: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { data?: Array<{ id: string }> }
        const models = (data.data ?? [])
          .filter((m) => m.id.startsWith('gpt') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4'))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: m.id }))
        return reply.send({ ok: true, models, message: `OpenAI подключена. GPT-моделей: ${models.length}.` })
      }

      if (provider === 'deepseek') {
        if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен для DeepSeek' })
        // DeepSeek models endpoint is at root, not under /v1
        const base = (baseUrl ?? 'https://api.deepseek.com/v1')
          .replace(/\/$/, '')
          .replace(/\/v1$/, '')
        const res  = await fetch(`${base}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `DeepSeek: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { data?: Array<{ id: string }> }
        const models = (data.data ?? [])
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: m.id }))
        return reply.send({ ok: true, models, message: `DeepSeek подключён. Моделей: ${models.length}.` })
      }

      if (provider === 'anthropic') {
        if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен для Anthropic' })
        // Make a minimal test request — list models endpoint
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          const parsed = (() => { try { return JSON.parse(err) } catch { return null } })()
          const msg = parsed?.error?.message ?? err.slice(0, 200)
          return reply.send({ ok: false, error: `Anthropic: ${res.status} — ${msg}` })
        }
        const data = await res.json() as { data?: Array<{ id: string; display_name: string }> }
        const models = (data.data ?? []).map((m) => ({
          id: m.id,
          label: m.display_name ?? m.id,
        }))
        const currentModel = model ?? 'claude-sonnet-4-6'
        const hasModel = models.some((m) => m.id === currentModel) || models.length === 0
        return reply.send({
          ok: true,
          models,
          message: `Anthropic подключена.${hasModel ? '' : ` Модель ${currentModel} не найдена в списке.`}`,
        })
      }

      // Everyone else speaks the OpenAI shape: GET {baseUrl}/models with a bearer
      // token. Groq, Mistral, xAI, Together, Google's compat endpoint, a custom
      // gateway — all answer this, and the ones that do not say so themselves.
      const base = (baseUrl || providerBaseUrlFor(provider)).replace(/\/$/, '')
      if (!base) return reply.send({ ok: false, error: 'Укажите Base URL для этого провайдера' })
      if (!apiKey) return reply.send({ ok: false, error: `API ключ обязателен для ${provider}` })

      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const err = await res.text()
        return reply.send({ ok: false, error: `${provider}: ${res.status} — ${err.slice(0, 200)}` })
      }
      const data = await res.json() as { data?: Array<{ id: string }> }
      const models = (data.data ?? [])
        .map((m) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id))
      return reply.send({ ok: true, models, message: `${provider}: подключено, моделей ${models.length}.` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        return reply.send({ ok: false, error: `Не удаётся подключиться. Проверь что ${provider === 'ollama' ? 'Ollama запущена' : 'URL правильный'}.` })
      }
      if (msg.includes('timeout') || msg.includes('TimeoutError')) {
        return reply.send({ ok: false, error: 'Превышено время ожидания. Сервис недоступен.' })
      }
      return reply.send({ ok: false, error: msg.slice(0, 300) })
    }
  })

  // GET /ai/settings/models — list known models per provider
  app.get('/ai/settings/models', async (_req, reply) => {
    const managedAi = getManagedAi()
    return reply.send({
      // The managed provider is only offered when this server actually has a key
      // for it. Nothing here reveals the key — only that one exists, and which
      // model stands behind the name (disclosing it is honest, and required:
      // the data goes to a third party).
      // Only whether a built-in mode exists. Which models stand behind it is the
      // operator's business and lives in the admin panel; the settings screen no
      // longer names them.
      managed: { available: managedSummary().available },
      sinoutx: managedAi ? [{ id: managedAi.model, label: `SinoutX (${managedAi.model})` }] : [],
      anthropic: [
        { id: 'claude-sonnet-5',              label: 'Claude Sonnet 5 (баланс, рекоменд.)' },
        { id: 'claude-opus-4-8',              label: 'Claude Opus 4.8 (макс. качество)' },
        { id: 'claude-haiku-4-5',             label: 'Claude Haiku 4.5 (быстрый/дешёвый)' },
        { id: 'claude-fable-5',               label: 'Claude Fable 5 (топ, дорогой)' },
        { id: 'claude-opus-4-6',              label: 'Claude Opus 4.6' },
        { id: 'claude-sonnet-4-6',            label: 'Claude Sonnet 4.6' },
      ],
      openai: [
        { id: 'gpt-4o',          label: 'GPT-4o' },
        { id: 'gpt-4o-mini',     label: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo',     label: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo',   label: 'GPT-3.5 Turbo' },
        { id: 'o3',              label: 'o3' },
        { id: 'o4-mini',         label: 'o4-mini' },
      ],
      openrouter: [
        { id: 'anthropic/claude-sonnet-4-5',    label: 'Claude Sonnet 4.5 (via OR)' },
        { id: 'openai/gpt-4o',                  label: 'GPT-4o (via OR)' },
        { id: 'google/gemini-2.0-flash-001',    label: 'Gemini 2.0 Flash (via OR)' },
        { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (via OR)' },
        { id: 'deepseek/deepseek-r1',           label: 'DeepSeek R1 (via OR)' },
        { id: 'qwen/qwen3-235b-a22b',           label: 'Qwen3 235B (via OR)' },
      ],
      ollama: [
        { id: 'llama3.2',    label: 'Llama 3.2' },
        { id: 'llama3.1',    label: 'Llama 3.1' },
        { id: 'mistral',     label: 'Mistral' },
        { id: 'qwen2.5',     label: 'Qwen 2.5' },
        { id: 'phi4',        label: 'Phi-4' },
        { id: 'gemma3',      label: 'Gemma 3' },
        { id: 'deepseek-r1', label: 'DeepSeek R1' },
      ],
      deepseek: [
        { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro' },
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (дешевле, слабее на инструментах)' },
      ],
      imageModels: {
        pollinations: [
          { id: 'flux',         label: 'FLUX (по умолчанию)' },
          { id: 'flux-realism', label: 'FLUX Realism' },
          { id: 'flux-anime',   label: 'FLUX Anime' },
          { id: 'flux-3d',      label: 'FLUX 3D' },
          { id: 'turbo',        label: 'Turbo (быстрый)' },
        ],
        openai: [
          { id: 'dall-e-3', label: 'DALL-E 3' },
          { id: 'dall-e-2', label: 'DALL-E 2' },
        ],
        openrouter: [
          { id: 'black-forest-labs/flux.2-pro',             label: 'FLUX.2 Pro (BFL via OR)' },
          { id: 'openai/gpt-5-image',                       label: 'GPT-5 Image (via OR)' },
          { id: 'openai/gpt-5-image-mini',                  label: 'GPT-5 Image Mini (via OR)' },
          { id: 'google/gemini-2.5-flash-image',            label: 'Gemini 2.5 Flash Image (via OR)' },
          { id: 'google/gemini-3-pro-image-preview',        label: 'Gemini 3 Pro Image (via OR)' },
          { id: 'sourceful/riverflow-v2-pro',               label: 'Riverflow V2 Pro (via OR)' },
          { id: 'sourceful/riverflow-v2-fast',              label: 'Riverflow V2 Fast (via OR)' },
        ],
        flux: [
          { id: 'flux-pro-1.1',   label: 'FLUX 1.1 Pro (лучший)' },
          { id: 'flux-pro',       label: 'FLUX Pro' },
          { id: 'flux-dev',       label: 'FLUX Dev' },
          { id: 'flux-schnell',   label: 'FLUX Schnell (быстрый)' },
        ],
        stability: [
          { id: 'stable-image-ultra', label: 'Stable Image Ultra (лучший)' },
          { id: 'stable-image-core',  label: 'Stable Image Core' },
          { id: 'stable-diffusion-3', label: 'Stable Diffusion 3' },
        ],
        fal: [
          { id: 'fal-ai/flux/schnell',      label: 'FLUX.1 Schnell (быстрый, бесплатный)' },
          { id: 'fal-ai/flux/dev',          label: 'FLUX.1 Dev' },
          { id: 'fal-ai/flux-pro',          label: 'FLUX.1 Pro (лучший)' },
          { id: 'fal-ai/flux-pro/v1.1',     label: 'FLUX.1.1 Pro' },
          { id: 'fal-ai/stable-diffusion-v35-large', label: 'Stable Diffusion 3.5 Large' },
          { id: 'fal-ai/aura-flow',         label: 'AuraFlow' },
          { id: 'fal-ai/recraft-v3',        label: 'Recraft V3' },
        ],
      },
    })
  })

  // POST /ai/settings/test-image — test image provider connection
  app.post('/ai/settings/test-image', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query)
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({
      provider: imageProviderEnum,
      apiKey:   z.string().optional(),
    }).parse(req.body)

    let apiKey = body.apiKey
    if (workspaceId && apiKey && /^\*+.{0,6}$/.test(apiKey)) {
      const stored = await getUserAISettings(req.authUser!.id, prisma)
      apiKey = stored.imageGeneration?.apiKey ?? apiKey
    }

    try {
      if (body.provider === 'pollinations') {
        return reply.send({ ok: true, message: 'Pollinations доступна — бесплатно, без ключа.' })
      }

      if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен' })

      if (body.provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `OpenAI: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { data?: Array<{ id: string }> }
        const models = (data.data ?? [])
          .filter((m) => m.id.startsWith('dall-e'))
          .map((m) => ({ id: m.id, label: m.id }))
        return reply.send({ ok: true, models, message: `OpenAI подключена. DALL-E моделей: ${models.length}.` })
      }

      if (body.provider === 'openrouter') {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 401 || res.status === 403) return reply.send({ ok: false, error: 'OpenRouter: неверный API ключ' })
        if (!res.ok) return reply.send({ ok: false, error: `OpenRouter: HTTP ${res.status}` })
        const data = await res.json() as { data?: Array<{ id: string; name: string; modality?: string; supported_parameters?: string[] }> }
        const models = (data.data ?? [])
          .filter((m) => {
            const id = m.id.toLowerCase()
            const name = (m.name ?? '').toLowerCase()
            const modality = (m.modality ?? '').toLowerCase()
            const params = m.supported_parameters ?? []
            return modality.includes('->image') ||
              modality === 'image' ||
              params.includes('image_gen') ||
              id.includes('image') ||
              id.startsWith('black-forest-labs/') ||
              name.includes('image') ||
              id.includes('flux') ||
              id.includes('dall-e') ||
              id.includes('stable-diffusion') ||
              id.includes('sdxl')
          })
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: m.name ?? m.id }))
        return reply.send({ ok: true, models, message: `OpenRouter подключён. Найдено ${models.length} image-моделей.` })
      }

      if (body.provider === 'flux') {
        // Black Forest Labs direct API — check account/models
        const res = await fetch('https://api.us1.bfl.ai/v1/get_result?id=00000000-0000-0000-0000-000000000000', {
          headers: { 'X-Key': apiKey },
          signal: AbortSignal.timeout(10_000),
        })
        // 404 on fake task = valid key; 401/403 = invalid key
        if (res.status === 401 || res.status === 403) {
          return reply.send({ ok: false, error: `FLUX (BFL): ${res.status} — неверный API ключ` })
        }
        return reply.send({ ok: true, message: 'FLUX (Black Forest Labs) подключён. Ключ действителен.' })
      }

      if (body.provider === 'stability') {
        const res = await fetch('https://api.stability.ai/v1/user/account', {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `Stability AI: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { email?: string; credits?: number }
        return reply.send({ ok: true, message: `Stability AI подключена. Баланс: ${data.credits?.toFixed(2) ?? '?'} credits.` })
      }

      if (body.provider === 'fal') {
        const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
          method: 'POST',
          headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'test', num_images: 1, image_size: 'square_hd' }),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) return reply.send({ ok: false, error: 'fal.ai: неверный API ключ' })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `fal.ai: ${res.status} — ${err.slice(0, 200)}` })
        }
        return reply.send({ ok: true, message: 'fal.ai подключён. Ключ действителен.' })
      }

      return reply.send({ ok: false, error: 'Неизвестный провайдер' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('timeout') || msg.includes('TimeoutError')) return reply.send({ ok: false, error: 'Превышено время ожидания.' })
      return reply.send({ ok: false, error: msg.slice(0, 300) })
    }
  })

  // POST /ai/settings/test-embeddings — test the embeddings provider
  app.post('/ai/settings/test-embeddings', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query)
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({
      provider: z.enum(['openai', 'openrouter', 'together', 'mistral', 'custom']),
      apiKey:   z.string().optional(),
      baseUrl:  z.string().optional(),
      model:    z.string().optional(),
    }).parse(req.body)

    let apiKey = body.apiKey
    if (workspaceId && apiKey && /^\*+.{0,6}$/.test(apiKey)) {
      const stored = await getUserAISettings(req.authUser!.id, prisma)
      apiKey = stored.embeddings?.apiKey ?? apiKey
    }
    if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен' })

    const cfg = embeddingsCfgFromParts(body.provider, apiKey, body.baseUrl, body.model)
    try {
      const vecs = await embed(['ping'], cfg)
      if (!vecs || !vecs[0]?.length) {
        return reply.send({ ok: false, error: `Эмбеддинг не получен. Проверьте ключ/модель/URL (${cfg.baseUrl}/embeddings, model=${cfg.model}).` })
      }
      return reply.send({ ok: true, message: `OK — ${cfg.model}, размерность ${vecs[0].length}` })
    } catch (e) {
      return reply.send({ ok: false, error: e instanceof Error ? e.message : 'Ошибка соединения' })
    }
  })

  // POST /ai/settings/test-audio — test audio/TTS provider connection
  app.post('/ai/settings/test-audio', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query)
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const body = z.object({
      provider: z.enum(['openai', 'elevenlabs', 'playht', 'pollinations', 'browser', 'custom']),
      apiKey:   z.string().optional(),
      baseUrl:  z.string().optional(),
    }).parse(req.body)

    let apiKey = body.apiKey
    if (workspaceId && apiKey && /^\*+.{0,6}$/.test(apiKey)) {
      const stored = await getUserAISettings(req.authUser!.id, prisma)
      apiKey = stored.audioGeneration?.apiKey ?? apiKey
    }

    if (body.provider === 'browser') {
      return reply.send({ ok: true, message: 'Browser TTS: использует встроенный синтез речи браузера.' })
    }

    if (!apiKey) return reply.send({ ok: false, error: 'API ключ обязателен' })

    try {
      if (body.provider === 'elevenlabs') {
        const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          headers: { 'xi-api-key': apiKey! },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 401 || res.status === 403) {
          // If key is valid but lacks permissions, the error status is "missing_permissions"
          // An invalid key returns "invalid_api_key"
          let body_text = ''
          try { body_text = await res.text() } catch { /* ignore */ }
          if (body_text.includes('missing_permissions')) {
            return reply.send({ ok: true, message: 'ElevenLabs подключён. Ключ действителен.' })
          }
          return reply.send({ ok: false, error: 'ElevenLabs: неверный API ключ' })
        }
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `ElevenLabs: ${res.status} — ${err.slice(0, 200)}` })
        }
        const data = await res.json() as { tier?: string; character_limit?: number; character_count?: number }
        const remaining = (data.character_limit ?? 0) - (data.character_count ?? 0)
        return reply.send({ ok: true, message: `ElevenLabs подключён (${data.tier ?? '?'}). Символов осталось: ${remaining.toLocaleString()}.` })
      }

      if (body.provider === 'playht') {
        const [userId, secretKey] = (apiKey ?? '').split(':')
        if (!userId || !secretKey) return reply.send({ ok: false, error: 'PlayHT: формат ключа — userId:secretKey' })
        const res = await fetch('https://api.play.ht/api/v2/cloned-voices', {
          headers: { 'Authorization': `Bearer ${secretKey}`, 'X-User-ID': userId },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 401 || res.status === 403) return reply.send({ ok: false, error: 'PlayHT: неверный API ключ' })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `PlayHT: ${res.status} — ${err.slice(0, 200)}` })
        }
        return reply.send({ ok: true, message: 'PlayHT подключён. Ключ действителен.' })
      }

      if (body.provider === 'pollinations') {
        const res = await fetch('https://api.streamelements.com/kappa/v2/speech?voice=Tatyana&text=test', {
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `StreamElements TTS: ${res.status} — ${err.slice(0, 200)}` })
        }
        return reply.send({ ok: true, message: 'StreamElements TTS подключён. API ключ не требуется.' })
      }

      if (body.provider === 'openai' || body.provider === 'custom') {
        const base = (body.provider === 'custom' && body.baseUrl) ? body.baseUrl.replace(/\/$/, '') : 'https://api.openai.com/v1'
        const res = await fetch(`${base}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 401 || res.status === 403) return reply.send({ ok: false, error: 'OpenAI TTS: неверный API ключ' })
        if (!res.ok) {
          const err = await res.text()
          return reply.send({ ok: false, error: `OpenAI TTS: ${res.status} — ${err.slice(0, 200)}` })
        }
        const label = body.provider === 'custom' ? 'Custom TTS' : 'OpenAI TTS'
        return reply.send({ ok: true, message: `${label} подключён. Ключ действителен.` })
      }

      return reply.send({ ok: false, error: 'Неизвестный провайдер' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('timeout') || msg.includes('TimeoutError')) return reply.send({ ok: false, error: 'Превышено время ожидания.' })
      return reply.send({ ok: false, error: msg.slice(0, 300) })
    }
  })

  // POST /ai/memory/clear — wipe the assistant's long-term memory (the Memory
  // module records in the user's Personal space). Structure stays; records go.
  app.post('/ai/memory/clear', async (req, reply) => {
    const wsId = await getPersonalWorkspaceId(prisma, req.authUser!.id)
    if (!wsId) return reply.send({ cleared: 0 })
    const proj = await prisma.project.findFirst({ where: { workspaceId: wsId, isModule: true, moduleId: 'memory' }, select: { id: true } })
    if (!proj) return reply.send({ cleared: 0 })
    const cols = await prisma.collection.findMany({ where: { projectId: proj.id }, select: { id: true } })
    const res = await prisma.collectionRecord.deleteMany({ where: { collectionId: { in: cols.map((c) => c.id) } } })
    await writeAuditLog(prisma, { action: 'ai_settings.updated', workspaceId: wsId, userId: req.authUser!.id, ip: req.ip })
    return reply.send({ cleared: res.count })
  })
}

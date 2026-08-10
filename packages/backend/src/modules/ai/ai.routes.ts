import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID, createHmac } from 'crypto'
import { streamChat, getAISettings, saveAISettings, appendConversationToMemory, registerMediaGenerators, type ChatContext } from './ai.service.js'
import { getManagedImage } from '../../lib/managed.js'
import { canUseManaged } from '../../lib/managedAccess.js'
import { costOfImage } from '../../lib/pricing.js'
import { recordUsage } from '../../lib/usage.js'
import { uploadFile } from '../../lib/storage.js'
import { config } from '../../config/index.js'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

// Sniff the magic bytes so we never store/serve a provider's HTML/JSON error as
// if it were an image (which the browser renders as a broken <img>).
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false
  const b = buf
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true                         // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true         // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true         // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true                                           // BMP
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return true // WEBP
  return false
}

// Kling AI: supports both "accessKey:secretKey" (JWT) and single token formats
function klingBearerToken(apiKey: string): string {
  const colonIdx = apiKey.indexOf(':')
  if (colonIdx === -1) return apiKey  // single token — use directly
  const accessKey = apiKey.slice(0, colonIdx)
  const secretKey = apiKey.slice(colonIdx + 1)
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now     = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url')
  const sig     = createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ),
  context: z
    .object({
      workspaceId: z.string().optional(),
      projectId: z.string().optional(),
      pageId: z.string().optional(),
      projectName: z.string().optional(),
      pageName: z.string().optional(),
      userLanguage: z.enum(['ru', 'en', 'be']).optional(),
      projectTemplate: z.string().optional(),
      projectTemplateInstructions: z.string().optional(),
      scopeProjectId: z.string().optional(),
      scopeProjectName: z.string().optional(),
      genTasks: z.boolean().optional(),
      genNotes: z.boolean().optional(),
    })
    .optional(),
})

// Core image generation, shared by the HTTP route (UI) and the agent's
// generate_image tool. Pure-ish: takes explicit params, returns a result instead
// of touching `reply`, so it can be called from anywhere.
export async function generateImageCore(
  prisma: PrismaClient,
  { prompt, workspaceId, userId }: { prompt?: string; workspaceId?: string; userId: string },
): Promise<{ url: string } | { error: string; status: number }> {
    if (!prompt?.trim()) return { error: 'Prompt required', status: 400 }

    // The user's own image key wins; otherwise ours, if the admin set one; and
    // pollinations needs no key at all, which is why it is the last resort
    // rather than a failure.
    const userImg = workspaceId
      ? (await getAISettings(workspaceId, prisma)).imageGeneration
      : undefined
    // Ours only for a paying, opted-in user. Everyone else keeps pollinations,
    // which costs nobody anything.
    const mayUseOurs = (await canUseManaged(prisma, userId)).ok
    const managedImg = mayUseOurs ? getManagedImage() : null
    const imgCfg = userImg?.apiKey ? userImg : (managedImg ?? userImg)
    const provider = (imgCfg?.provider ?? 'pollinations') as NonNullable<typeof userImg>['provider']
    console.log({ workspaceId, provider, model: imgCfg?.model, hasKey: !!imgCfg?.apiKey }, 'generate-image: provider selected')

    // Auto-translate non-English prompts to English for better image quality
    const hasCyrillic = /[Ѐ-ӿ]/.test(prompt)
    const hasNonLatin = hasCyrillic || /[-￿]/.test(prompt)
    let finalPrompt = prompt.trim()
    if (hasNonLatin && provider !== 'pollinations') {
      try {
        const settings = workspaceId ? await getAISettings(workspaceId, prisma) : null
        const activeProvider = settings?.provider ?? 'anthropic'
        const providerCfg = settings?.providers?.[activeProvider]
        const apiKey = providerCfg?.apiKey
        const model = providerCfg?.model ?? 'claude-haiku-4-5-20251001'
        if (apiKey && (activeProvider === 'anthropic' || activeProvider === 'openai' || activeProvider === 'deepseek')) {
          const baseUrl = activeProvider === 'openai' ? 'https://api.openai.com/v1'
            : activeProvider === 'deepseek' ? 'https://api.deepseek.com/v1'
            : null
          const transRes = await fetch(
            baseUrl ? `${baseUrl}/chat/completions` : 'https://api.anthropic.com/v1/messages',
            {
              method: 'POST',
              headers: baseUrl
                ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
                : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify(baseUrl
                ? { model, max_tokens: 200, messages: [{ role: 'user', content: `Translate this image prompt to English. Return ONLY the translated prompt, nothing else: "${finalPrompt}"` }] }
                : { model, max_tokens: 200, messages: [{ role: 'user', content: `Translate this image prompt to English. Return ONLY the translated prompt, nothing else: "${finalPrompt}"` }] }
              ),
              signal: AbortSignal.timeout(10_000),
            }
          )
          if (transRes.ok) {
            const transData = await transRes.json() as { content?: Array<{ text: string }>; choices?: Array<{ message: { content: string } }> }
            const translated = transData.content?.[0]?.text?.trim() ?? transData.choices?.[0]?.message?.content?.trim()
            if (translated) {
              console.log({ original: finalPrompt, translated }, 'generate-image: prompt translated')
              finalPrompt = translated
            }
          }
        }
      } catch { /* non-critical — use original prompt */ }
    }

    let imageBuffer: Buffer | undefined
    let mimeType = 'image/jpeg'

    if (provider === 'openrouter') {
      // OpenRouter image models — chat completions API, model outputs image
      const apiKey = imgCfg?.apiKey
      if (!apiKey) return { error: 'API key not configured for OpenRouter', status: 400 }
      const model = imgCfg?.model ?? 'google/gemini-2.5-flash-image'
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://sinout.app',
          'X-Title': 'SinoutX',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: finalPrompt }],
          modalities: ['image', 'text'],
        }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const errText = await res.text()
        const errJson = (() => { try { return JSON.parse(errText) } catch { return null } })()
        const errMsg = errJson?.error?.message ?? errJson?.message ?? errText.slice(0, 200)
        return { error: `OpenRouter image error: ${errMsg}`, status: 502 }
      }
      type ORImgPart = { type: string; image_url?: { url: string } }
      type ORMessage = { content?: string | null; images?: ORImgPart[] }
      const data = await res.json() as { choices?: Array<{ message?: ORMessage }> }
      const msg = data.choices?.[0]?.message
      // OpenRouter returns images in message.images[], not message.content
      const imgPart = msg?.images?.[0] ?? (Array.isArray(msg?.content) ? (msg.content as ORImgPart[]).find((p) => p.type === 'image_url') : null)
      const imgUrl = imgPart?.image_url?.url ?? (typeof msg?.content === 'string' && msg.content.startsWith('data:image') ? msg.content : null)
      if (!imgUrl) return { error: 'OpenRouter: no image in response', status: 502 }
      if (imgUrl.startsWith('data:')) {
        const [meta, b64] = imgUrl.split(',')
        mimeType = meta.replace('data:', '').replace(';base64', '')
        imageBuffer = Buffer.from(b64, 'base64')
      } else {
        const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(30_000) })
        imageBuffer = Buffer.from(await imgRes.arrayBuffer())
        mimeType = imgRes.headers.get('content-type') ?? 'image/png'
      }

    } else if (provider === 'openai') {
      // OpenAI images/generations endpoint
      const apiKey = imgCfg?.apiKey
      if (!apiKey) return { error: 'API key not configured for image provider', status: 400 }
      const model = imgCfg?.model ?? 'dall-e-3'
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: finalPrompt, n: 1, size: '1024x1024' }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const errText = await res.text()
        const errJson = (() => { try { return JSON.parse(errText) } catch { return null } })()
        const errMsg = errJson?.error?.message ?? errJson?.message ?? errText.slice(0, 200)
        return { error: `Image generation failed: ${errMsg}`, status: 502 }
      }
      const data = await res.json() as { data: { url?: string; b64_json?: string }[] }
      const item = data.data?.[0]
      if (item?.b64_json) {
        imageBuffer = Buffer.from(item.b64_json, 'base64')
        mimeType = 'image/png'
      } else if (item?.url) {
        const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(30_000) })
        imageBuffer = Buffer.from(await imgRes.arrayBuffer())
        mimeType = imgRes.headers.get('content-type') ?? 'image/png'
      } else {
        return { error: 'No image returned by provider', status: 502 }
      }

    } else if (provider === 'flux') {
      // Black Forest Labs direct FLUX API (polling)
      const apiKey = imgCfg?.apiKey
      if (!apiKey) return { error: 'API key not configured for FLUX provider', status: 400 }
      const model = imgCfg?.model ?? 'flux-pro-1.1'
      const submitRes = await fetch(`https://api.us1.bfl.ai/v1/${model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Key': apiKey },
        body: JSON.stringify({ prompt: finalPrompt, width: 1024, height: 768 }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!submitRes.ok) {
        const errText = await submitRes.text()
        const errJson = (() => { try { return JSON.parse(errText) } catch { return null } })()
        const errMsg = errJson?.detail ?? errJson?.message ?? errText.slice(0, 200)
        return { error: `FLUX error: ${errMsg}`, status: 502 }
      }
      const { id: taskId } = await submitRes.json() as { id: string }
      // Poll until ready (max 3 min)
      let imageUrl: string | null = null
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const poll = await fetch(`https://api.us1.bfl.ai/v1/get_result?id=${taskId}`, {
          headers: { 'X-Key': apiKey },
          signal: AbortSignal.timeout(10_000),
        })
        if (!poll.ok) continue
        const data = await poll.json() as { status: string; result?: { sample?: string } }
        if (data.status === 'Ready' && data.result?.sample) {
          imageUrl = data.result.sample
          break
        }
        if (data.status === 'Error') return { error: 'FLUX generation failed', status: 502 }
      }
      if (!imageUrl) return { error: 'FLUX generation timed out', status: 502 }
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
      imageBuffer = Buffer.from(await imgRes.arrayBuffer())
      mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg'

    } else if (provider === 'stability') {
      // Stability AI — Stable Image Core
      const apiKey = imgCfg?.apiKey
      if (!apiKey) return { error: 'API key not configured for image provider', status: 400 }
      const formData = new FormData()
      formData.append('prompt', finalPrompt)
      formData.append('output_format', 'jpeg')
      formData.append('aspect_ratio', '4:3')
      const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'image/*' },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const err = await res.text()
        return { error: `Stability AI error: ${err.slice(0, 200)}`, status: 502 }
      }
      imageBuffer = Buffer.from(await res.arrayBuffer())
      mimeType = 'image/jpeg'

    } else if (provider === 'fal') {
      const apiKey = imgCfg?.apiKey
      if (!apiKey) return { error: 'API key not configured for fal.ai', status: 400 }
      const model = imgCfg?.model ?? 'fal-ai/flux/schnell'
      // fal.ai queue API
      const submitRes = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, image_size: 'landscape_4_3' }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!submitRes.ok) {
        const errText = await submitRes.text()
        const errJson = (() => { try { return JSON.parse(errText) } catch { return null } })()
        const detail = errJson?.detail
        const errMsg = Array.isArray(detail)
          ? detail.map((d: { msg?: string; loc?: string[] }) => `${d.loc?.join('.')}: ${d.msg}`).join('; ')
          : (typeof detail === 'string' ? detail : errJson?.message ?? errText.slice(0, 300))
        return { error: `fal.ai error: ${errMsg}`, status: 502 }
      }
      const submitData = await submitRes.json() as {
        request_id: string
        status_url?: string
        response_url?: string
      }
      const statusUrl = submitData.status_url ?? `https://queue.fal.run/${model}/requests/${submitData.request_id}/status`
      const responseUrl = submitData.response_url ?? `https://queue.fal.run/${model}/requests/${submitData.request_id}`
      console.log({ request_id: submitData.request_id, statusUrl }, 'fal.ai: job submitted')

      // Poll for result (max 3 min)
      let imageUrl: string | null = null
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const poll = await fetch(statusUrl, {
          headers: { 'Authorization': `Key ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!poll.ok) continue
        const statusData = await poll.json() as { status: string; logs?: unknown[] }
        console.log({ status: statusData.status, attempt: i }, 'fal.ai: poll status')
        if (statusData.status === 'COMPLETED') {
          const resultRes = await fetch(responseUrl, {
            headers: { 'Authorization': `Key ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
          })
          if (resultRes.ok) {
            const data = await resultRes.json() as { images?: Array<{ url: string }> }
            imageUrl = data.images?.[0]?.url ?? null
          }
          break
        }
        if (statusData.status === 'FAILED') return { error: 'fal.ai generation failed', status: 502 }
      }
      if (!imageUrl) return { error: 'fal.ai generation timed out', status: 502 }
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
      if (!imgRes.ok) return { error: `fal.ai: could not download the result image (${imgRes.status})`, status: 502 }
      imageBuffer = Buffer.from(await imgRes.arrayBuffer())
      mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg'

    } else {
      // Pollinations.ai (free, no key). A very long prompt (e.g. a pasted block of
      // text instead of a description) makes the service answer 200 with a text
      // error page, not an image — so cap the prompt and verify what came back.
      const encoded = encodeURIComponent(finalPrompt.slice(0, 400))
      const genUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=768&nologo=true&model=flux`
      const res = await fetch(genUrl, { signal: AbortSignal.timeout(90_000) })
      if (!res.ok) return { error: 'Image generation failed', status: 502 }
      const ct = res.headers.get('content-type') ?? ''
      imageBuffer = Buffer.from(await res.arrayBuffer())
      if (!ct.startsWith('image/')) {
        return { error: 'The image service returned no image. Try a shorter, simpler description.', status: 502 }
      }
      mimeType = ct
    }

    // Charged per picture, not per token: an image has no tokens to count. A
    // model with no published price records a row and takes nothing.
    if (managedImg && workspaceId) {
      const fixedCost = costOfImage(imgCfg?.model ?? '', true)
      if (fixedCost) {
        void recordUsage(prisma, {
          workspaceId,
          userId: userId,
          provider: `sinoutx:${provider}`,
          model: imgCfg?.model ?? provider,
          managed: true,
          source: 'image',
          fixedCost,
        }, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, calls: 1 })
      }
    }

    if (!imageBuffer) return { error: 'No image buffer produced', status: 502 }
    // Never store/serve a non-image: a provider can answer 200 with an HTML/JSON
    // error, which would then render as a broken <img>. Check the magic bytes.
    if (!looksLikeImage(imageBuffer)) {
      console.warn({ provider, head: imageBuffer.subarray(0, 16).toString('hex') }, 'generate-image: non-image response')
      return { error: 'The provider did not return a valid image. Try again or simplify the prompt.', status: 502 }
    }
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg'
    const filename = `${randomUUID()}.${ext}`
    const storageKey = `ai-images/${filename}`
    await uploadFile(storageKey, imageBuffer, mimeType, imageBuffer.length)

    // Register a WORKSPACE-level attachment (no projectId) for the generated
    // image. Two reasons: it makes the image count toward the storage quota
    // (which sums attachment sizes) instead of silently eating disk forever, and
    // it becomes deletable from Files so the user can free that space. No project
    // link, so it never clutters a project's sources; "Save to sources" still
    // makes its own independent copy.
    if (workspaceId) {
      await prisma.attachment.create({
        data: {
          workspaceId,
          filename,
          mimeType,
          size: imageBuffer.length,
          storagePath: storageKey,
          isImportant: false,
          metadata: { source: 'ai-image' },
        },
      }).catch(() => null)
    }

    return { url: `/api/v1/ai/image/${filename}` }
}

// Core TTS, shared by the HTTP route (UI) and the agent's generate_audio tool.
export async function generateAudioCore(
  prisma: PrismaClient,
  { prompt, workspaceId }: { prompt?: string; workspaceId?: string; userId: string },
): Promise<{ url: string } | { error: string; status: number }> {
    if (!prompt?.trim()) return { error: 'Prompt required', status: 400 }

    const settings = workspaceId ? await getAISettings(workspaceId, prisma) : null
    const audioCfg = settings?.audioGeneration
    const provider = audioCfg?.provider ?? 'openai'
    const apiKey   = audioCfg?.apiKey ?? ''
    const model    = audioCfg?.model ?? ''

    let audioBuffer: Buffer | null = null

    try {
      if (provider === 'pollinations') {
        // StreamElements TTS — free, no key required, supports Russian (Tatyana/Maxim)
        const voice = model || 'Tatyana'
        const url = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(prompt.trim())}`
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) {
          const err = await res.text()
          return { error: `StreamElements TTS ${res.status}: ${err.slice(0, 300)}`, status: 502 }
        }
        audioBuffer = Buffer.from(await res.arrayBuffer())

      } else if (provider === 'elevenlabs') {
        if (!apiKey) return { error: 'ElevenLabs API key required', status: 400 }
        const voiceId = model || '21m00Tcm4TlvDq8ikWAM' // default: Rachel
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: prompt.trim(), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) {
          const err = await res.text()
          return { error: `ElevenLabs ${res.status}: ${err.slice(0, 300)}`, status: 502 }
        }
        audioBuffer = Buffer.from(await res.arrayBuffer())

      } else if (provider === 'playht') {
        if (!apiKey) return { error: 'PlayHT API key required', status: 400 }
        const [userId, secretKey] = apiKey.split(':')
        const res = await fetch('https://api.play.ht/api/v2/tts/stream', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${secretKey}`, 'X-User-ID': userId, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
          body: JSON.stringify({ text: prompt.trim(), voice: model || 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json', output_format: 'mp3', voice_engine: 'PlayHT2.0' }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) return { error: `PlayHT error ${res.status}`, status: 502 }
        audioBuffer = Buffer.from(await res.arrayBuffer())

      } else {
        // OpenAI TTS (default)
        if (!apiKey) return { error: 'OpenAI API key required', status: 400 }
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: prompt.trim(), voice: model || 'alloy' }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) return { error: `OpenAI TTS error ${res.status}`, status: 502 }
        audioBuffer = Buffer.from(await res.arrayBuffer())
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { error: msg.slice(0, 300), status: 502 }
    }

    const filename = `${randomUUID()}.mp3`
    await uploadFile(`ai-audio/${filename}`, audioBuffer!, 'audio/mpeg', audioBuffer!.length)
    return { url: `/api/v1/ai/audio/${filename}` }
}

export async function aiRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  // Hand the agent the same multi-provider media engines the UI uses, so its
  // generate_image / generate_audio tools aren't a second implementation.
  registerMediaGenerators({ image: generateImageCore, audio: generateAudioCore })

  // POST /ai/generate-image — multi-provider AI image generation
  fastify.post('/ai/generate-image', async (req, reply) => {
    const { prompt, workspaceId } = req.body as { prompt?: string; workspaceId?: string }
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const r = await generateImageCore(prisma, { prompt, workspaceId, userId: req.authUser!.id })
    if ('error' in r) return reply.status(r.status).send({ error: r.error })
    return reply.send(r)
  })

  // POST /ai/generate-audio — multi-provider AI audio/TTS generation
  fastify.post('/ai/generate-audio', async (req, reply) => {
    const { prompt, workspaceId } = req.body as { prompt?: string; workspaceId?: string }
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const r = await generateAudioCore(prisma, { prompt, workspaceId, userId: req.authUser!.id })
    if ('error' in r) return reply.status(r.status).send({ error: r.error })
    return reply.send(r)
  })

  // POST /ai/upload-audio — receive a recorded audio blob from browser TTS
  fastify.post('/ai/upload-audio', async (req, reply) => {
    try {
      const data = await req.file()
      if (!data) return reply.status(400).send({ error: 'No file' })
      const buf = await data.toBuffer()
      const mime = data.mimetype || 'audio/webm'
      const ext  = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
      const filename = `${randomUUID()}.${ext}`
      await uploadFile(`ai-audio/${filename}`, buf, mime, buf.length)
      return reply.send({ url: `/api/v1/ai/audio/${filename}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: msg.slice(0, 200) })
    }
  })

  // GET /ai/audio/:filename — serve AI-generated audio from MinIO
  fastify.get('/ai/audio/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string }
    const key = `ai-audio/${filename}`
    try {
      const { minio, BUCKET } = await import('../../lib/storage.js')
      const stat   = await minio.statObject(BUCKET, key)
      const stream = await minio.getObject(BUCKET, key)
      reply.header('Content-Type', stat.metaData?.['content-type'] ?? 'audio/mpeg')
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      return reply.send(stream)
    } catch {
      return reply.status(404).send({ error: 'Not found' })
    }
  })

  // POST /ai/chat — SSE streaming
  fastify.post('/ai/chat', {
    config: { rawBody: false },
  }, async (req, reply) => {
    const body = chatSchema.parse(req.body)
    const context = (body.context ?? {}) as ChatContext
    // Inject the authenticated user (server-side) for user-scoped tools (journal).
    context.userId = req.authUser!.id

    // Check workspace membership before hijacking
    if (context.workspaceId && await denyIfNotMember(prisma, context.workspaceId, req.authUser!.id, reply)) return

    // Set SSE headers before any response
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    let aiResponseText = ''
    const toolsUsed: string[] = []

    try {
      const generator = streamChat(body.messages, context, prisma)
      for await (const chunk of generator) {
        raw.write(chunk)
        try {
          const line = chunk.replace(/^data: /, '').trim()
          if (line) {
            const parsed = JSON.parse(line) as { type?: string; text?: string; tool?: string }
            if (parsed.type === 'text' && parsed.text) aiResponseText += parsed.text
            if (parsed.type === 'tool_done' && parsed.tool) toolsUsed.push(parsed.tool)
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      raw.write(`data: ${JSON.stringify({ type: 'error', text: msg })}\n\n`)
    } finally {
      raw.end()
      // Save to project memory — always when there was any AI activity
      if (context.projectId && lastUserMessage && (aiResponseText || toolsUsed.length > 0)) {
        appendConversationToMemory(context.projectId, lastUserMessage, aiResponseText, toolsUsed, prisma).catch(() => null)
      }
    }
  })

  // ── AI Conversation history ───────────────────────────────────────────────

  // List conversations for a project or workspace
  fastify.get('/ai/conversations', async (req, reply) => {
    const { projectId, workspaceId } = req.query as { projectId?: string; workspaceId?: string }
    if (!workspaceId && !projectId) return reply.status(400).send({ error: 'workspaceId or projectId required' })
    // Always show ALL conversations for the workspace regardless of project context
    const resolvedWorkspaceId = workspaceId ?? (projectId
      ? (await prisma.aiConversation.findFirst({ where: { projectId }, select: { workspaceId: true } }))?.workspaceId
      : undefined)
    if (!resolvedWorkspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, resolvedWorkspaceId, req.authUser!.id, reply)) return
    const where = { workspaceId: resolvedWorkspaceId }
    const conversations = await prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true, projectId: true, workspaceId: true },
    })
    return conversations
  })

  // Get single conversation with messages
  fastify.get('/ai/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conv = await prisma.aiConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, conv.workspaceId, req.authUser!.id, reply)) return
    return conv
  })

  // Create conversation
  fastify.post('/ai/conversations', async (req, reply) => {
    const { workspaceId, projectId, title } = req.body as { workspaceId: string; projectId?: string; title?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    // Validate projectId exists to avoid FK violation
    let validProjectId: string | null = null
    if (projectId) {
      const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
      validProjectId = exists ? projectId : null
    }
    const conv = await prisma.aiConversation.create({
      data: { workspaceId, projectId: validProjectId, title: title ?? 'Новый чат' },
    })
    return conv
  })

  // Update conversation title
  fastify.patch('/ai/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conv = await prisma.aiConversation.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, conv.workspaceId, req.authUser!.id, reply)) return
    const { title } = req.body as { title: string }
    const updated = await prisma.aiConversation.update({ where: { id }, data: { title } })
    return updated
  })

  // Delete conversation
  fastify.delete('/ai/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conv = await prisma.aiConversation.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, conv.workspaceId, req.authUser!.id, reply)) return
    await prisma.aiConversation.delete({ where: { id } })
    return { ok: true }
  })

  // Append messages to conversation
  fastify.post('/ai/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string }
    const convCheck = await prisma.aiConversation.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!convCheck) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, convCheck.workspaceId, req.authUser!.id, reply)) return
    const { messages } = req.body as { messages: { role: string; content: string; toolCalls?: unknown }[] }
    await prisma.aiMessage.createMany({
      data: messages.map((m) => ({
        conversationId: id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? (m.toolCalls as object) : undefined,
      })),
    })
    // Touch updatedAt
    await prisma.aiConversation.update({ where: { id }, data: {} })
    return { ok: true }
  })

  // POST /ai/break-down-task — AI subtask suggestions
  fastify.post('/ai/break-down-task', async (req, reply) => {
    const { taskId, workspaceId } = z
      .object({ taskId: z.string().cuid(), workspaceId: z.string().cuid() })
      .parse(req.body)

    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    const settings = await getAISettings(workspaceId, prisma)
    const providerCfg = settings.providers[settings.provider] ?? {}
    const apiKey = providerCfg.apiKey ?? (settings.provider === 'anthropic' ? config.ANTHROPIC_API_KEY : undefined)
    if (!apiKey) return reply.status(400).send({ error: 'AI not configured' })

    const prompt = `Break down this task into 3-7 concrete subtasks.\nTask: "${task.title}"\n\nRespond with ONLY a JSON array of strings, no explanation:\n["subtask 1", "subtask 2", ...]`

    try {
      let subtasks: string[] = []

      if (settings.provider === 'anthropic') {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })
        const resp = await client.messages.create({
          model: providerCfg.model ?? 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        })
        const text = resp.content[0].type === 'text' ? resp.content[0].text : ''
        subtasks = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      } else {
        // OpenAI-compatible
        const baseUrl = providerCfg.baseUrl ?? 'https://api.openai.com/v1'
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: providerCfg.model ?? 'gpt-4o-mini',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        const data = await resp.json() as { choices: { message: { content: string } }[] }
        const text = data.choices?.[0]?.message?.content ?? ''
        subtasks = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      }

      return reply.send({ subtasks: subtasks.filter((s) => typeof s === 'string' && s.trim()) })
    } catch (e) {
      fastify.log.error({ err: e }, 'AI break-down-task failed')
      return reply.status(500).send({ error: 'AI request failed' })
    }
  })

  // POST /ai/generate-tasks — extract tasks from free text
  fastify.post('/ai/generate-tasks', async (req, reply) => {
    const { text, workspaceId } = z.object({
      text: z.string().min(1).max(4000),
      workspaceId: z.string().cuid(),
    }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const prompt = `Extract a list of actionable tasks from the following text. Return ONLY a JSON array of objects with fields: title (string), priority ("LOW"|"MEDIUM"|"HIGH"|"URGENT"), dueDate (ISO date string or null). No commentary, just JSON array.

Text:
${text}

JSON array:`

    try {
      const settings = await getAISettings(workspaceId, prisma)
      let tasks: { title: string; priority: string; dueDate?: string }[] = []

      if (settings.provider === 'anthropic' && settings.apiKey) {
        const { Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: settings.apiKey })
        const msg = await client.messages.create({
          model: settings.model || 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        })
        const content = msg.content[0]
        const raw = content.type === 'text' ? content.text : ''
        tasks = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      } else if (settings.baseUrl && settings.apiKey) {
        const resp = await fetch(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }),
        })
        const data = await resp.json() as { choices: { message: { content: string } }[] }
        const raw = data.choices?.[0]?.message?.content ?? ''
        tasks = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      }

      return reply.send({ tasks: tasks.filter((t) => typeof t?.title === 'string') })
    } catch (e) {
      fastify.log.error({ err: e }, 'AI generate-tasks failed')
      return reply.status(500).send({ error: 'AI request failed' })
    }
  })

  // POST /ai/transcribe — transcribe audio/video file via OpenAI Whisper, then extract tasks/decisions
  fastify.post('/ai/transcribe', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string }
    if (workspaceId && await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    try {
      const data = await req.file({ limits: { fileSize: 100 * 1024 * 1024 } })
      if (!data) return reply.status(400).send({ error: 'No file provided' })

      const buf = await data.toBuffer()
      const mime = data.mimetype || 'audio/mpeg'
      const originalName = data.filename || 'audio.mp3'
      const ext = originalName.split('.').pop() ?? 'mp3'

      // Get OpenAI API key from AI settings
      const settings = workspaceId ? await getAISettings(workspaceId, prisma) : null
      const openaiKey = settings?.providers?.openai?.apiKey
        ?? (settings?.provider === 'openai' ? settings?.apiKey : null)

      if (!openaiKey) {
        return reply.status(400).send({ error: 'OpenAI API key required for transcription. Configure it in Settings → AI Assistant.' })
      }

      // Call OpenAI Whisper API
      const form = new FormData()
      const blob = new Blob([buf as unknown as ArrayBuffer], { type: mime })
      form.append('file', blob, `audio.${ext}`)
      form.append('model', 'whisper-1')
      form.append('response_format', 'text')

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form,
      })

      if (!whisperRes.ok) {
        const err = await whisperRes.text()
        return reply.status(502).send({ error: `Whisper API error: ${err.slice(0, 200)}` })
      }

      const transcript = await whisperRes.text()

      // Extract structured info via AI
      const extractPrompt = `You are analyzing a meeting transcript. Extract the following in JSON format:
{
  "title": "short meeting title (max 60 chars)",
  "summary": "2-3 sentence summary",
  "decisions": ["decision 1", "decision 2"],
  "tasks": [
    { "title": "task title", "assignee": "name or null", "dueHint": "today/tomorrow/this week/null" }
  ],
  "keyPoints": ["key point 1", "key point 2"]
}

Transcript:
${transcript.slice(0, 8000)}`

      let analysis: {
        title: string
        summary: string
        decisions: string[]
        tasks: { title: string; assignee: string | null; dueHint: string | null }[]
        keyPoints: string[]
      } = { title: 'Meeting Notes', summary: '', decisions: [], tasks: [], keyPoints: [] }

      try {
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: extractPrompt }],
            response_format: { type: 'json_object' },
            max_tokens: 1024,
          }),
        })
        if (aiRes.ok) {
          const aiData = await aiRes.json() as { choices: { message: { content: string } }[] }
          const parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? '{}')
          analysis = { ...analysis, ...parsed }
        }
      } catch { /* use defaults if AI extraction fails */ }

      return reply.send({ transcript, analysis })
    } catch (e) {
      fastify.log.error({ err: e }, 'AI transcribe failed')
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Transcription failed' })
    }
  })

  // POST /ai/project-health — analyse project health via AI
  fastify.post('/ai/project-health', async (req, reply) => {
    const { projectId, workspaceId, lang } = req.query as { projectId?: string; workspaceId?: string; lang?: string }
    if (!projectId) return reply.status(400).send({ error: 'projectId required' })

    const resolvedWsId = workspaceId ?? await getProjectWorkspaceId(prisma, projectId)
    if (!resolvedWsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, resolvedWsId, req.authUser!.id, reply)) return

    const isRu = lang === 'ru'

    try {
      const settings = workspaceId ? await getAISettings(workspaceId, prisma) : null
      const activeProvider = settings?.provider ?? 'anthropic'
      const providerCfg = settings?.providers?.[activeProvider]
      const apiKey = providerCfg?.apiKey ?? settings?.apiKey
      if (!apiKey) return reply.status(400).send({ error: 'AI API key not configured in Settings → AI Assistant.' })

      // Gather project data
      const [project, pages, taskAnalytics, tasks] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true, createdAt: true } }),
        prisma.page.count({ where: { projectId, isDeleted: false } }),
        prisma.task.groupBy({ by: ['status'], where: { projectId, isDeleted: false }, _count: true }),
        prisma.task.findMany({
          where: { projectId, isDeleted: false },
          select: { title: true, status: true, priority: true, dueDate: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ])

      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const now = new Date()
      const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'DONE' && t.status !== 'CANCELLED').length
      const doneCount = tasks.filter(t => t.status === 'DONE').length
      const todoCount = tasks.filter(t => t.status === 'TODO').length
      const inProgressCount = tasks.filter(t => t.status === 'IN_PROGRESS').length
      const highPriority = tasks.filter(t => (t.priority === 'HIGH' || t.priority === 'URGENT') && t.status !== 'DONE').length
      const totalActive = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED').length
      const completionRate = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0
      const recentDone = tasks.filter(t => t.status === 'DONE' && new Date(t.createdAt) > new Date(now.getTime() - 7 * 86400_000)).length

      const projectAge = Math.floor((now.getTime() - new Date(project.createdAt).getTime()) / 86400_000)

      const statsText = `Project: ${project.name}
Age: ${projectAge} days
Total tasks: ${tasks.length} | Done: ${doneCount} (${completionRate}%) | In Progress: ${inProgressCount} | Todo: ${todoCount}
Overdue: ${overdue} | High/Urgent priority open: ${highPriority}
Pages/docs: ${pages}
Completed in last 7 days: ${recentDone}`

      const systemPrompt = `You are a project health analyst. Analyse the project statistics and return a JSON object with this exact structure:
{
  "score": 0-100,
  "status": "healthy" | "at_risk" | "critical",
  "summary": "2-3 sentence plain-language overview",
  "highlights": ["what is going well (1-3 items)"],
  "risks": ["specific risks or problems (1-4 items)"],
  "recommendations": ["concrete actionable suggestions (2-4 items)"]
}
Score guide: 80-100 = healthy, 50-79 = at_risk, 0-49 = critical.
Be concise and specific. No generic advice.${isRu ? '\nIMPORTANT: Write ALL text values (summary, highlights, risks, recommendations) in Russian.' : ''}`

      const baseUrl = activeProvider === 'openai' ? 'https://api.openai.com/v1'
        : activeProvider === 'deepseek' ? 'https://api.deepseek.com/v1'
        : activeProvider === 'openrouter' ? (providerCfg?.baseUrl ?? 'https://openrouter.ai/api/v1')
        : activeProvider === 'ollama' ? (providerCfg?.baseUrl ?? 'http://host.docker.internal:11434/v1')
        : null

      const model = activeProvider === 'anthropic' ? 'claude-haiku-4-5-20251001'
        : activeProvider === 'openai' ? 'gpt-4o-mini'
        : providerCfg?.model ?? 'gpt-4o-mini'

      let aiRes: Response
      if (activeProvider === 'anthropic') {
        aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: statsText }] }),
        })
      } else {
        aiRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, max_tokens: 2048, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: statsText }] }),
        })
      }

      if (!aiRes.ok) {
        const err = await aiRes.text()
        return reply.status(502).send({ error: `AI error: ${err.slice(0, 200)}` })
      }

      const aiJson = await aiRes.json() as Record<string, unknown>
      let rawText: string
      if (activeProvider === 'anthropic') {
        const content = (aiJson.content as { type: string; text: string }[])?.[0]
        rawText = content?.text ?? '{}'
      } else {
        rawText = (aiJson.choices as { message: { content: string } }[])?.[0]?.message?.content ?? '{}'
      }

      // Extract JSON — strip markdown fences, then find first {...} block
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      const candidate = fenceMatch ? fenceMatch[1] : rawText
      const objMatch = candidate.match(/\{[\s\S]*\}/)
      if (!objMatch) return reply.status(502).send({ error: 'AI returned no JSON object' })
      const health = JSON.parse(objMatch[0])

      return reply.send({ health, stats: { total: tasks.length, done: doneCount, inProgress: inProgressCount, todo: todoCount, overdue, highPriority, completionRate, pages, recentDone } })
    } catch (e) {
      fastify.log.error({ err: e }, 'AI project-health failed')
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Analysis failed' })
    }
  })
}

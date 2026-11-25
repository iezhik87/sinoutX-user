// ─── The SinoutX model, OpenAI-shaped ─────────────────────────────────────────
// `POST /api/v1/llm/chat/completions` — the door SinoutX Code (and any other
// OpenAI-compatible client) uses to run on the instance's model. The agent loop
// lives on the user's computer; this route only proxies one model call:
//
//   • the key is a workspace API key (`x-api-key` or `Authorization: Bearer`);
//   • the MODEL is the server's choice — slot `code`, else `ai`; whatever the
//     client puts into `model` is ignored;
//   • the provider's stream is passed through as is; an Anthropic slot is
//     translated into `chat.completion.chunk`s;
//   • every call is metered, and on an instance that bills, charged to the key
//     owner's balance with the same margin as the chat.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { getManagedCode, MODEL_TIERS } from '../../lib/managed.js'
import { isBillingEnabled } from '../../lib/billingMode.js'
import { canSpend, type SpendCheck } from '../../lib/wallet.js'
import { emptyUsage, addUsage, parseOpenAIUsage, recordUsage, type TokenUsage } from '../../lib/usage.js'
import { providerBaseUrl, openRouterPriceCap } from '../ai/ai.service.js'
import type { AISettings } from '../ai/ai.service.js'
import { streamAnthropicAsOpenAI, usageChunk, type OAIRequest } from './anthropic-bridge.js'
import { modelTiers, resolveAutoModel, RoutingError } from './model-routing.js'
import { isPriceCapRejection, PriceCapError, priceCapErrorBody } from '../../lib/openRouterPolicy.js'

/** Fields forwarded to the provider. An allow-list, not a deny-list: OpenRouter
 *  reads `models` and `provider` as routing orders, and a client must not be
 *  able to reroute the instance's key to a model of its own choosing. */
const FORWARDED = [
  'messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'top_p',
  'max_tokens', 'max_completion_tokens', 'stop', 'response_format', 'seed',
  'frequency_penalty', 'presence_penalty', 'reasoning_effort',
] as const

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']) }).passthrough()).min(1),
  stream: z.boolean().optional(),
  model_tier: z.enum(['auto', ...MODEL_TIERS]).optional(),
  routing_key: z.string().uuid().optional(),
  routing_task: z.string().trim().min(1).max(4000).optional(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).passthrough().optional(),
  tools: z.array(z.object({ function: z.object({ name: z.string().min(1) }).passthrough() }).passthrough()).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
}).passthrough()

/** OpenAI's error shape — what every compatible client knows how to read. */
function fail(reply: FastifyReply, status: number, message: string, code?: string) {
  return reply.status(status).send({ error: { message, type: status === 402 ? 'insufficient_quota' : 'invalid_request_error', code: code ?? null } })
}

/** The agent's own words for an empty wallet: it has no settings screen to point at. */
function walletRefusal(check: SpendCheck): string {
  if (check.reason === 'monthly_cap') {
    return 'Достигнут месячный лимит расходов на модель SinoutX. Поднимите лимит в настройках SinoutX или подключите свою модель (sinout config provider …).'
  }
  return 'Баланс SinoutX пуст: пополните его в приложении или подключите свою модель (sinout config provider …).'
}

/** Where the cost is written: the workspace the key is scoped to, else the
 *  owner's own (earliest) workspace. Usage rows need a workspace. */
async function usageWorkspace(prisma: PrismaClient, req: FastifyRequest): Promise<string | null> {
  const scoped = req.authWorkspaceScope?.[0]
  if (scoped) return scoped
  const m = await prisma.workspaceMember.findFirst({
    where: { userId: req.authUser!.id }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true },
  })
  return m?.workspaceId ?? null
}

/** Provider HTTP status → what the client should see. A 401 from the provider is
 *  OUR key failing, not the user's — it must not read as «wrong API key». */
function upstreamStatus(status: number): number {
  if (status === 400 || status === 413 || status === 422) return 400
  if (status === 429) return 429
  return 502
}

function upstreamMessage(raw: string): string {
  // The Anthropic SDK prefixes the body with the status: `400 {"type":"error",…}`.
  const json = /\{[\s\S]*\}/.exec(raw)?.[0]
  if (json) {
    try {
      const j = JSON.parse(json) as { error?: { message?: string } | string; message?: string }
      const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message
      if (m) return m
    } catch { /* not JSON after all */ }
  }
  return raw.slice(0, 300)
}

export async function llmRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/llm/model-tiers', async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…).')
    return reply.send(modelTiers())
  })
  app.post('/llm/chat/completions', {
    // An agent resends the whole conversation, file contents included.
    bodyLimit: 20 * 1024 * 1024,
  }, async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…) в Authorization: Bearer или x-api-key.')

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return fail(reply, 400, `Неверный запрос: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
    const body = parsed.data

    const auto = body.model_tier === 'auto'
    if (auto && (!body.routing_key || !body.routing_task)) return fail(reply, 400, 'Для Авто нужны routing_key (UUID одного хода агента) и routing_task (исходная задача, до 4000 символов).', 'routing_required')
    let slot = auto ? null : getManagedCode(body.model_tier as typeof MODEL_TIERS[number] | undefined)
    if (!auto && !slot && body.model_tier) return fail(reply, 503, `Уровень модели SinoutX «${body.model_tier}» не настроен. Выберите другой уровень или попросите администратора настроить его (админка → Ключи SinoutX → SinoutX Code).`, 'model_tier_not_configured')
    if (!auto && !slot) return fail(reply, 503, 'На этом сервере не настроена модель SinoutX (админка → Модель SinoutX).', 'model_not_configured')

    const userId = req.authUser!.id
    const billed = isBillingEnabled()
    // Checked BEFORE the call: the cheapest way not to pay for a runaway agent
    // is not to start it. A frozen account never gets this far — the global
    // guard refuses its POSTs with 402.
    if (billed) {
      const check = await canSpend(prisma, userId)
      if (!check.ok) return fail(reply, 402, walletRefusal(check), check.reason)
    }

    const workspaceId = await usageWorkspace(prisma, req)
    let resolvedTier = auto ? 'medium' : body.model_tier ?? 'medium'
    let routingFallback: string | undefined
    if (auto) {
      try {
        const selected = await resolveAutoModel({ prisma, userId, apiKeyId: req.authApiKeyId!, scope: req.authWorkspaceScope, workspaceId: workspaceId ?? undefined, billed, routingKey: body.routing_key!, task: body.routing_task!, initial: body.messages.at(-1)?.role === 'user' })
        slot = selected.slot
        resolvedTier = selected.tier
        routingFallback = selected.fallback
      } catch (e) {
        if (e instanceof PriceCapError) return reply.status(e.status).send(priceCapErrorBody(e))
        if (e instanceof RoutingError) return fail(reply, e.status, e.message, e.code)
        return fail(reply, 503, 'Хранилище маршрутов временно недоступно. Повторите запрос с тем же routing_key.', 'routing_unavailable')
      }
      // The classifier has its own metered call. Re-check before spending more.
      if (billed) {
        const check = await canSpend(prisma, userId)
        if (!check.ok) return fail(reply, 402, walletRefusal(check), check.reason)
      }
    }
    if (!slot) return fail(reply, 503, 'Выбранная модель не настроена.', 'model_tier_not_configured')
    const routingHeaders: Record<string, string> = {
      'X-SinoutX-Model-Tier': resolvedTier,
      ...(routingFallback ? { 'X-SinoutX-Routing-Fallback': routingFallback } : {}),
    }
    reply.headers(routingHeaders)
    const usage: TokenUsage = emptyUsage()
    const stream = body.stream === true
    const wantUsage = body.stream_options?.include_usage === true

    const forward: Record<string, unknown> = {}
    for (const k of FORWARDED) if (body[k] !== undefined) forward[k] = body[k]

    // The client hanging up must stop the provider too — otherwise an aborted
    // step keeps generating, and billing, until the model is done.
    const ctrl = new AbortController()
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) ctrl.abort() })
    const timeout = setTimeout(() => ctrl.abort(), 600_000)

    const record = () => {
      clearTimeout(timeout)
      void recordUsage(prisma, {
        workspaceId: workspaceId ?? undefined,
        userId,
        provider: `sinoutx:${slot.provider}`,
        model: slot.model,
        // Without billing the tokens are still counted, but nobody is charged:
        // on a self-hosted instance the key is the admin's own.
        managed: billed,
        source: 'code',
      }, usage)
    }

    const sseHeaders = {
      ...routingHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }

    // ── Anthropic: translate ────────────────────────────────────────────────
    if (slot.provider === 'anthropic') {
      const events = streamAnthropicAsOpenAI(forward as unknown as OAIRequest, { apiKey: slot.apiKey, model: slot.model, baseUrl: slot.baseUrl, signal: ctrl.signal })
      if (stream) {
        // The first event decides between an HTTP error and a stream: a request
        // the provider rejects must come back as a status code, not as 200.
        let first: IteratorResult<Awaited<ReturnType<typeof events.next>>['value']>
        try {
          first = await events.next()
        } catch (e) {
          record()
          const err = e as { status?: number; message?: string }
          return fail(reply, upstreamStatus(err.status ?? 502), upstreamMessage(err.message ?? String(e)))
        }
        reply.hijack()
        const raw = reply.raw
        raw.writeHead(200, sseHeaders)
        const write = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`)
        try {
          for (let it = first; !it.done; it = await events.next()) {
            const ev = it.value
            if (ev.kind === 'chunk') write(ev.chunk)
            else {
              addUsage(usage, { inputTokens: ev.usage.input, cachedInputTokens: ev.usage.cacheRead, outputTokens: ev.usage.output })
              if (wantUsage) write(usageChunk(ev.usage, slot.model))
            }
          }
          raw.write('data: [DONE]\n\n')
        } catch (e) {
          if (!ctrl.signal.aborted) write({ error: { message: upstreamMessage((e as Error).message ?? String(e)) } })
        } finally {
          raw.end()
          record()
        }
        return
      }

      // Not streamed: collect the same chunks into one completion.
      let content = ''
      let finish: string | null = null
      const calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
      let u = { input: 0, cacheRead: 0, output: 0 }
      try {
        for await (const ev of events) {
          if (ev.kind === 'usage') { u = ev.usage; continue }
          const ch = (ev.chunk.choices as Array<{ delta: Record<string, unknown>; finish_reason: string | null }>)[0]
          if (typeof ch.delta.content === 'string') content += ch.delta.content
          for (const tc of (ch.delta.tool_calls as Array<{ index: number; id?: string; function: { name?: string; arguments?: string } }> | undefined) ?? []) {
            const c = (calls[tc.index] ??= { id: tc.id ?? '', type: 'function', function: { name: '', arguments: '' } })
            if (tc.id) c.id = tc.id
            if (tc.function.name) c.function.name += tc.function.name
            if (tc.function.arguments) c.function.arguments += tc.function.arguments
          }
          if (ch.finish_reason) finish = ch.finish_reason
        }
      } catch (e) {
        record()
        const err = e as { status?: number; message?: string }
        return fail(reply, upstreamStatus(err.status ?? 502), upstreamMessage(err.message ?? String(e)))
      }
      addUsage(usage, { inputTokens: u.input, cachedInputTokens: u.cacheRead, outputTokens: u.output })
      record()
      return reply.send({
        id: 'chatcmpl-anthropic', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: slot.model,
        choices: [{ index: 0, message: { role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: finish ?? 'stop' }],
        usage: usageChunk(u, slot.model).usage,
      })
    }

    // ── OpenAI-compatible: pass through ─────────────────────────────────────
    const baseUrl = (slot.baseUrl || providerBaseUrl(slot.provider as AISettings['provider'])).replace(/\/$/, '')
    if (!baseUrl) {
      clearTimeout(timeout)
      return fail(reply, 503, 'У модели SinoutX не задан адрес поставщика (админка → Модель SinoutX).', 'model_not_configured')
    }

    const send = (withUsage: boolean) => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(slot.apiKey ? { Authorization: `Bearer ${slot.apiKey}` } : {}),
        'HTTP-Referer': 'https://sinoutx.app',
        'X-Title': 'SinoutX Code',
      },
      body: JSON.stringify({
        ...forward,
        model: slot.model,
        stream,
        // Usage is asked for even when the client did not: it is what the
        // answer is billed by. The extra chunk has empty `choices`, which any
        // compatible client already skips.
        ...(stream && withUsage ? { stream_options: { include_usage: true } } : {}),
        ...openRouterPriceCap(baseUrl, billed || slot.maxPrice != null, slot.maxPrice),
      }),
      signal: ctrl.signal,
    })

    let upstream: Response
    try {
      upstream = await send(true)
      if (!upstream.ok) {
        const err = await upstream.text()
        if (isPriceCapRejection(err)) { clearTimeout(timeout); const e = new PriceCapError(slot.model, slot.maxPrice, resolvedTier); return reply.status(e.status).send(priceCapErrorBody(e)) }
        if (upstream.status === 400 && /stream_options|include_usage/i.test(err)) upstream = await send(false)
        else { clearTimeout(timeout); return fail(reply, upstreamStatus(upstream.status), upstreamMessage(err)) }
      }
      if (!upstream.ok) {
        clearTimeout(timeout)
        const err = await upstream.text()
        if (isPriceCapRejection(err)) { const e = new PriceCapError(slot.model, slot.maxPrice, resolvedTier); return reply.status(e.status).send(priceCapErrorBody(e)) }
        return fail(reply, upstreamStatus(upstream.status), upstreamMessage(err))
      }
    } catch (e) {
      clearTimeout(timeout)
      if (ctrl.signal.aborted) return
      return fail(reply, 502, `Поставщик модели недоступен: ${(e as Error).message}`)
    }

    if (!stream) {
      const text = await upstream.text()
      try {
        const j = JSON.parse(text) as { usage?: Record<string, unknown>; error?: unknown }
        if (j.error && isPriceCapRejection(JSON.stringify(j.error))) {
          clearTimeout(timeout)
          const e = new PriceCapError(slot.model, slot.maxPrice, resolvedTier)
          return reply.status(e.status).send(priceCapErrorBody(e))
        }
        const u = parseOpenAIUsage(j.usage)
        if (u) addUsage(usage, u)
      } catch { /* the client gets it as is */ }
      record()
      return reply.status(200).header('Content-Type', 'application/json').send(text)
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, sseHeaders)
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        // Forward whole SSE events only: the usage chunk is read on the way and,
        // when the client did not ask for it, kept back.
        let cut: number
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, cut + 2)
          buffer = buffer.slice(cut + 2)
          let isUsageOnly = false
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            // Some gateways return an error event after an HTTP 200. Use the
            // same non-retryable contract as pre-stream HTTP rejections.
            if (isPriceCapRejection(data)) {
              try {
                const chunk = JSON.parse(data) as { error?: unknown }
                if (chunk.error) {
                  raw.write(`data: ${JSON.stringify(priceCapErrorBody(new PriceCapError(slot.model, slot.maxPrice, resolvedTier)))}\n\n`)
                  ctrl.abort()
                  return
                }
              } catch { /* not an error JSON event */ }
            }
            try {
              const chunk = JSON.parse(data) as { usage?: Record<string, unknown>; choices?: unknown[] }
              const u = parseOpenAIUsage(chunk.usage ?? undefined)
              if (u) {
                addUsage(usage, u)
                isUsageOnly = !chunk.choices || chunk.choices.length === 0
              }
            } catch { /* keep-alive or a comment line */ }
          }
          if (isUsageOnly && !wantUsage) continue
          raw.write(event)
        }
      }
      if (buffer.trim()) raw.write(buffer)
    } catch (e) {
      if (!ctrl.signal.aborted) raw.write(`data: ${JSON.stringify({ error: { message: `Обрыв потока поставщика: ${(e as Error).message}` } })}\n\n`)
    } finally {
      raw.end()
      record()
    }
  })
}

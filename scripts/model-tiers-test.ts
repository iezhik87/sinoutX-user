// Real Fastify handlers + managed storage/resolution, with fake external services.
// Run: node --import tsx scripts/model-tiers-test.ts
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

async function main() {
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', MEILI_KEY: 'test',
    MINIO_PASSWORD: 'test', JWT_SECRET: 'test-key-with-at-least-thirty-two-characters',
    ENCRYPTION_KEY: 'test-encryption-key', MANAGED_AI_KEY: '', DEPLOYMENT_MODE: 'self-hosted',
    OPENROUTER_MAX_PROMPT_USD: '0.25', OPENROUTER_MAX_COMPLETION_USD: '0.7',
  })
  const { default: Fastify } = await import('fastify')
  const { primeManaged, saveManaged, managedForAdmin, getManagedCode, getManagedKey } = await import('../packages/backend/src/lib/managed.js')
  const { llmRoutes } = await import('../packages/backend/src/modules/llm/llm.routes.js')
  const { aiSettingsRoutes } = await import('../packages/backend/src/modules/ai/ai-settings.routes.js')
  const { adminRoutes } = await import('../packages/backend/src/modules/admin/admin.routes.js')
  const { redis } = await import('../packages/backend/src/lib/redis.js')
  const { setBillingMode } = await import('../packages/backend/src/lib/billingMode.js')
  const { activePricingSlots } = await import('../packages/backend/src/lib/pricing.js')
  const { effectiveMaxPrice, openRouterPriceCap, PriceCapError } = await import('../packages/backend/src/lib/openRouterPolicy.js')
  const { completeManaged, streamChat } = await import('../packages/backend/src/modules/ai/ai.service.js')
  const { errorHandler } = await import('../packages/backend/src/middleware/errorHandler.js')
  let stored: any = { ai: { provider: 'openai', model: 'old-chat', apiKey: 'chat-key', baseUrl: 'https://fake.test/ai' }, code: { provider: 'openai', model: 'old-code', baseUrl: 'https://fake.test/code' } }
  const rows: any[] = []
  let balance = 1_000_000
  const prisma: any = {
    appSettings: { findUnique: async () => ({ managed: stored }), upsert: async ({ update }: any) => { stored = JSON.parse(JSON.stringify(update.managed)); return { managed: stored } } },
    workspaceMember: { findFirst: async () => ({ workspaceId: 'ws' }) },
    aiUsage: { create: async ({ data }: any) => { rows.push(data); return data }, aggregate: async () => ({ _sum: { chargedMicroUsd: 0 } }) },
    user: { findUnique: async () => ({ balanceMicroUsd: balance, monthlyCapMicroUsd: 10_000_000 }), update: async ({ data }: any) => ({ balanceMicroUsd: balance -= data.balanceMicroUsd.decrement }) },
    auditLog: { create: async () => ({}) },
    apiKey: { findUnique: async () => ({ id: 'key-a', name: 'test', workspaceIds: ['ws'], user: { id: 'user', email: 'test@example.invalid', name: 'Test', role: 'ADMIN', isActive: true } }), update: async () => ({}) },
  }
  const cache = new Map<string, string>()
  ;(redis as any).status = 'ready'
  redis.get = (async (key: string) => cache.get(key) ?? null) as any
  redis.set = (async (key: string, value: string, ...opts: any[]) => { if (opts.includes('NX') && cache.has(key)) return null; cache.set(key, value); return 'OK' }) as any
  redis.expire = (async () => 1) as any
  redis.eval = (async (_s: string, _n: number, key: string, owner: string) => { if (cache.get(key) === owner) cache.delete(key); return 1 }) as any

  let routerCalls = 0
  let routerAnswer = 'light'
  let routerFails = false
  let routerHangs = false
  let lastForward: any
  let lastAuthorization: unknown
  const providerRequests: any[] = []
  let priceFailure: '' | 'http' | 'sse' | 'json' | 'retry' = ''
  let priceMessage = 'No endpoints found that satisfy the max price for this request'
  let anthropicBody: any
  let anthropicPath: string | undefined
  const anthropic = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    anthropicBody = JSON.parse(raw)
    anthropicPath = req.url
    const events = [
      { type: 'message_start', message: { id: 'test', type: 'message', role: 'assistant', model: anthropicBody.model, content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Claude OK' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
      { type: 'message_stop' },
    ]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))
  })
  await new Promise<void>((resolve) => anthropic.listen(0, '127.0.0.1', resolve))
  const anthropicBase = `http://127.0.0.1:${(anthropic.address() as { port: number }).port}`
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    lastAuthorization = init?.headers?.Authorization
    if (String(url).endsWith('/endpoints')) return new Response(JSON.stringify({ data: { endpoints: [{ pricing: { prompt: '0.000002', completion: '0.000004' } }, { pricing: { prompt: '0.000001', completion: '0.000008' } }] } }))
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }))
    assert.ok(body, 'unexpected network request')
    providerRequests.push(body)
    if (priceFailure) {
      if (priceFailure === 'retry' && body.stream_options) return new Response('stream_options is unsupported', { status: 400 })
      const error = { error: { message: priceMessage } }
      if (priceFailure === 'sse') return new Response(`data: ${JSON.stringify(error)}\n\ndata: [DONE]\n\n`)
      return new Response(JSON.stringify(error), { status: priceFailure === 'json' ? 200 : 404 })
    }
    if (body.model === 'router') {
      routerCalls++
      if (routerHangs) await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
      if (routerFails) return new Response('unavailable', { status: 503 })
      await new Promise((r) => setTimeout(r, 10))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tier: routerAnswer }) } }], usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.0001 } }))
    }
    lastForward = body
    const usage = { prompt_tokens: 30, completion_tokens: 5, cost: 0.0002 }
    const completion = { model: body.model, choices: [{ message: { role: 'assistant', content: 'OK' } }], usage }
    return new Response(body.stream ? `data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: 'OK' } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n` : JSON.stringify(completion))
  }) as any
  const app = Fastify()
  app.setErrorHandler(errorHandler)
  app.addHook('preHandler', async (req) => {
    req.authVia = req.headers['x-auth-mode'] === 'jwt' ? 'jwt' : 'apikey'
    req.authUser = { id: 'user', email: 'test@example.invalid', name: 'Test', role: req.headers['x-role'] === 'user' ? 'USER' : 'ADMIN' }
    req.authApiKeyId = String(req.headers['x-test-key'] ?? 'key-a')
    req.authWorkspaceScope = [String(req.headers['x-test-scope'] ?? 'ws')]
  })
  await llmRoutes(app, prisma)
  await aiSettingsRoutes(app, prisma)
  await adminRoutes(app, prisma)
  const ask = (body: any = {}, headers: any = {}) => app.inject({ method: 'POST', url: '/llm/chat/completions', payload: { messages: [{ role: 'user', content: 'Fix a typo' }], ...body }, headers })
  const check = (name: string) => console.log(`PASS ${name}`)
  try {
    await primeManaged(prisma)
    assert.equal(getManagedCode()?.model, 'old-code')
    assert.equal(getManagedCode('medium')?.model, 'old-code')
    assert.equal(getManagedCode('light'), null)
    assert.deepEqual((await app.inject('/llm/model-tiers')).json(), { tiers: [{ id: 'auto', configured: false }, { id: 'light', configured: false }, { id: 'medium', configured: true }, { id: 'strong', configured: false }] })
    assert.equal((await app.inject({ url: '/llm/model-tiers', headers: { 'x-auth-mode': 'jwt' } })).statusCode, 401)
    assert.equal((await ask({}, { 'x-auth-mode': 'jwt' })).statusCode, 401)
    check('legacy config, capability endpoint and API-key requirement')

    assert.equal((await ask()).json().model, 'old-code')
    const unavailable = await ask({ model_tier: 'strong' })
    assert.equal(unavailable.statusCode, 503)
    assert.equal(unavailable.json().error.code, 'model_tier_not_configured')
    assert.equal((await ask({ model_tier: 'invalid' })).statusCode, 400)
    assert.equal((await ask({ model_tier: 'auto' })).json().error.code, 'routing_required')
    check('explicit unconfigured/invalid tiers never fall back')

    const configured = await app.inject({ method: 'PATCH', url: '/admin/managed', headers: { 'x-api-key': 'test' }, payload: {
      codeLight: { provider: 'openai', model: 'light-model', apiKey: 'light-key', baseUrl: 'https://fake.test/light' },
      codeStrong: { provider: 'openai', model: 'strong-model', baseUrl: 'https://fake.test/strong' },
      codeRouter: { provider: 'openai', model: 'router', baseUrl: 'https://fake.test/router' },
    } })
    assert.equal(configured.statusCode, 200)
    assert.equal(stored.codeLight.apiKey.startsWith('enc:v1:'), true)
    assert.equal(JSON.stringify(configured.json()).includes('light-key'), false)
    assert.equal(managedForAdmin().codeStrong.hasKey, true)
    await primeManaged(prisma)
    assert.equal(getManagedCode('light')?.apiKey, 'light-key')
    assert.equal(getManagedCode('strong')?.apiKey, 'chat-key')
    await saveManaged(prisma, { codeLight: { model: 'light-model-v2' } })
    assert.equal(getManagedCode('light')?.apiKey, 'light-key')
    assert.equal(getManagedCode()?.model, 'old-code')
    check('admin saves every tier, encryption, reload and partial patch preserve legacy keys')

    for (const [tier, model] of [['light', 'light-model-v2'], ['medium', 'old-code'], ['strong', 'strong-model']]) {
      const r = await ask({ model_tier: tier, model: 'client-override', provider: { order: ['evil'] }, models: ['evil'], reasoning_effort: 'high', routing_task: 'private', routing_key: randomUUID() })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().model, model)
      assert.equal(r.headers['x-sinoutx-model-tier'], tier)
      assert.equal(lastForward.reasoning_effort, 'high')
      for (const key of ['model_tier', 'routing_task', 'routing_key', 'models', 'provider']) assert.equal(key in lastForward, false)
      assert.equal(rows.at(-1).model, model)
    }
    assert.ok(activePricingSlots().some((s) => s.slot === 'codeLight' && s.model === 'light-model-v2'))
    assert.ok(activePricingSlots().some((s) => s.slot === 'codeRouter' && s.model === 'router'))
    check('real model selection, independent reasoning, allow-list and usage/pricing for every tier')

    const stream = await ask({ model_tier: 'strong', stream: true })
    assert.equal(stream.headers['x-sinoutx-model-tier'], 'strong')
    assert.match(stream.body, /strong-model/)
    assert.match(stream.body, /\[DONE\]/)
    assert.doesNotMatch(stream.body, /prompt_tokens/)
    check('SSE forwards selected model, routing headers and filters usage-only chunk')

    await saveManaged(prisma, { codeStrong: { provider: 'anthropic', model: 'claude-strong', apiKey: 'claude-key', baseUrl: anthropicBase } })
    for (const stream of [false, true]) {
      const claude = await ask({ model_tier: 'strong', stream })
      assert.equal(claude.statusCode, 200, claude.body)
      assert.equal(anthropicPath, '/v1/messages')
      assert.equal(anthropicBody.model, 'claude-strong')
      assert.match(claude.body, /Claude OK/)
      assert.match(claude.body, /claude-strong/)
      assert.equal(rows.at(-1).model, 'claude-strong')
      assert.equal(rows.at(-1).inputTokens, 20)
    }
    check('Anthropic tier uses its configured endpoint; streaming and collected output are metered')

    // The connection test needs an inherited key BEFORE its model is picked.
    await saveManaged(prisma, { codeStrong: { provider: '', model: '', apiKey: '' } })
    assert.equal(getManagedKey('codeStrong', 'openai'), 'chat-key')
    const probe = await app.inject({ method: 'POST', url: '/ai/settings/test', payload: { slot: 'codeStrong', provider: 'openai', baseUrl: 'https://fake.test' } })
    assert.equal(probe.json().ok, true)
    assert.equal(lastAuthorization, 'Bearer chat-key')
    assert.equal((await app.inject({ method: 'POST', url: '/ai/settings/test', headers: { 'x-role': 'user' }, payload: { slot: 'codeLight', provider: 'openai' } })).statusCode, 403)
    check('admin model listing inherits same-provider key; regular users cannot use it')

    const routingKey = randomUUID()
    const auto = { model_tier: 'auto', routing_key: routingKey, routing_task: 'Fix a typo' }
    setBillingMode(true)
    const start = routerCalls
    const initial = await ask(auto)
    assert.equal(initial.statusCode, 200)
    assert.equal(initial.json().model, 'light-model-v2')
    assert.equal(routerCalls, start + 1)
    assert.equal(rows.at(-2).source, 'code_router')
    assert.equal(rows.at(-2).model, 'router')
    assert.equal(rows.at(-2).managed, true)
    assert.ok(rows.at(-2).chargedMicroUsd > 0)
    routerAnswer = 'medium'
    const continuation = await ask({ ...auto, messages: [{ role: 'tool', content: 'Done', tool_call_id: 'call' }] })
    assert.equal(continuation.json().model, 'light-model-v2')
    assert.equal(routerCalls, start + 1)
    const isolated = await ask(auto, { 'x-test-key': 'key-b' })
    assert.equal(isolated.json().model, 'old-code')
    assert.equal(routerCalls, start + 2)
    const scope = await ask(auto, { 'x-test-scope': 'other' })
    assert.equal(scope.json().model, 'old-code')
    assert.equal(routerCalls, start + 3)
    check('auto classifier billed once, pinned across tools, isolated by key and scope')

    const concurrent = { ...auto, routing_key: randomUUID() }
    const before = routerCalls
    const pair = await Promise.all([ask(concurrent), ask(concurrent)])
    assert.equal(pair[0].statusCode, 200)
    assert.equal(pair[1].statusCode, 200)
    assert.equal(routerCalls, before + 1)
    check('concurrent requests share one pinned classification')

    await saveManaged(prisma, { codeLight: { model: 'changed-model' } })
    assert.equal((await ask(auto)).json().error.code, 'model_route_changed')
    assert.equal((await ask({ ...auto, routing_key: randomUUID(), messages: [{ role: 'tool', content: 'Done' }] })).json().error.code, 'model_route_expired')
    check('changed/expired routes refuse a silent model switch')

    routerFails = true
    const fallback = await ask({ ...auto, routing_key: randomUUID(), stream: true })
    assert.equal(fallback.statusCode, 200)
    assert.equal(fallback.headers['x-sinoutx-model-tier'], 'medium')
    assert.equal(fallback.headers['x-sinoutx-routing-fallback'], 'router_failed')
    assert.match(fallback.body, /old-code/)
    check('router failure explicitly reports medium fallback in SSE headers')

    routerFails = false
    routerHangs = true
    const timedOutAt = Date.now()
    const timedOut = await ask({ ...auto, routing_key: randomUUID() })
    assert.equal(timedOut.statusCode, 200)
    assert.equal(timedOut.headers['x-sinoutx-routing-fallback'], 'router_failed')
    assert.ok(Date.now() - timedOutAt >= 7900 && Date.now() - timedOutAt < 11000)
    routerHangs = false
    routerFails = true
    ;(redis as any).status = 'end'
    assert.equal((await ask(auto)).json().error.code, 'routing_unavailable')
    ;(redis as any).status = 'ready'
    check('router stops after eight seconds; storage outage refuses rerouting')

    const beforeCaps = JSON.parse(JSON.stringify(stored))
    routerFails = false
    assert.deepEqual(effectiveMaxPrice(), { prompt: 0.25, completion: 0.7 })
    assert.deepEqual(openRouterPriceCap('https://openrouter.ai/api/v1', true, { prompt: 0, completion: 2 }), { provider: { max_price: { completion: 2 } } })
    assert.deepEqual(openRouterPriceCap('https://openrouter.ai.evil.invalid', true), {})
    for (const invalid of [{ prompt: -1 }, { completion: '2' }, { prompt: null }, { completion: Infinity }]) {
      const r = await app.inject({ method: 'PATCH', url: '/admin/managed', headers: { 'x-api-key': 'test' }, payload: { codeLight: { maxPrice: invalid } } })
      assert.equal(r.statusCode, 400)
    }
    const patchCaps = await app.inject({ method: 'PATCH', url: '/admin/managed', headers: { 'x-api-key': 'test' }, payload: {
      codeLight: { provider: 'openrouter', model: 'vendor/light', baseUrl: 'https://openrouter.ai/api/v1', maxPrice: { prompt: 1, completion: 3 } },
      code: { provider: 'openrouter', model: 'vendor/medium', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'code-key', maxPrice: { prompt: 2, completion: 5 } },
      codeStrong: { provider: 'openrouter', model: 'vendor/strong', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'strong-key', maxPrice: { prompt: 4, completion: 12 } },
      codeRouter: { provider: 'openrouter', model: 'router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'router-key', maxPrice: { prompt: 0.1, completion: 0.2 } },
    } })
    assert.equal(patchCaps.statusCode, 200)
    assert.equal(JSON.stringify(patchCaps.json()).includes('code-key'), false)
    await primeManaged(prisma)
    setBillingMode(false)
    for (const [tier, cap] of [['light', { prompt: 1, completion: 3 }], ['medium', { prompt: 2, completion: 5 }], ['strong', { prompt: 4, completion: 12 }]] as const) {
      const r = await ask({ model_tier: tier, provider: { max_price: { prompt: 999 } } })
      assert.equal(r.statusCode, 200)
      assert.deepEqual(providerRequests.at(-1).provider.max_price, cap)
    }
    check('finite nonnegative caps, independent tiers, encrypted settings preserved; explicit caps work without billing')

    const priceCheck = () => app.inject({ method: 'POST', url: '/admin/managed/price-check', headers: { 'x-api-key': 'test' }, payload: { slot: 'codeLight' } })
    assert.equal((await priceCheck()).json().status, 'blocked')
    await saveManaged(prisma, { codeLight: { maxPrice: { prompt: 2, completion: 4 } } })
    assert.equal((await priceCheck()).json().status, 'compatible')
    assert.equal((await app.inject('/llm/model-tiers')).json().tiers.find((t: any) => t.id === 'light').configured, true)
    check('public per-endpoint prices checked together; capabilities remain backward compatible')

    for (const failure of ['http', 'json', 'sse', 'retry'] as const) {
      priceFailure = failure
      const start = providerRequests.length
      const r = await ask({ model_tier: 'light', stream: failure === 'sse' || failure === 'retry' })
      const error = failure === 'sse' ? JSON.parse(r.body.split('data: ')[1].split('\n')[0]).error : r.json().error
      assert.equal(r.statusCode, failure === 'sse' ? 200 : 503)
      assert.equal(error.code, 'price_cap_exceeded')
      assert.equal(error.retryable, false)
      assert.match(error.message, /vendor\/light/)
      assert.match(error.message, /Лимит не снят/)
      assert.equal(providerRequests.length - start, failure === 'retry' ? 2 : 1)
      for (const call of providerRequests.slice(start)) assert.deepEqual(call.provider.max_price, { prompt: 2, completion: 4 })
    }
    priceFailure = 'http'
    priceMessage = 'No allowed provider matches max_price'
    const noUncap = providerRequests.length
    assert.equal((await ask({ model_tier: 'strong' })).json().error.code, 'price_cap_exceeded')
    assert.equal(providerRequests.length, noUncap + 1)
    check('HTTP/JSON/SSE price failures share a non-retryable code; compatibility retry keeps the same cap')

    priceMessage = 'No endpoints found that satisfy the max price for this request'
    const routingStart = providerRequests.length
    const routerRefused = await ask({ ...auto, routing_key: randomUUID() })
    assert.equal(routerRefused.statusCode, 503)
    assert.equal(routerRefused.json().error.code, 'price_cap_exceeded')
    assert.match(routerRefused.json().error.message, /router/)
    assert.equal(providerRequests.length, routingStart + 1)
    assert.equal(providerRequests.at(-1).model, 'router')
    assert.deepEqual(providerRequests.at(-1).provider.max_price, { prompt: 0.1, completion: 0.2 })
    assert.equal(routerRefused.headers['x-sinoutx-routing-fallback'], undefined)
    priceFailure = ''
    routerAnswer = 'light'
    const pinnedCaps = { ...auto, routing_key: randomUUID() }
    assert.equal((await ask(pinnedCaps)).json().model, 'vendor/light')
    await saveManaged(prisma, { codeLight: { maxPrice: { prompt: 0.5, completion: 1 } } })
    priceFailure = 'http'
    const pinnedStart = providerRequests.length
    const targetRefused = await ask({ ...pinnedCaps, messages: [{ role: 'tool', content: 'done' }] })
    assert.equal(targetRefused.json().error.code, 'price_cap_exceeded')
    assert.equal(providerRequests.length, pinnedStart + 1)
    assert.equal(providerRequests.at(-1).model, 'vendor/light')
    assert.deepEqual(providerRequests.at(-1).provider.max_price, { prompt: 0.5, completion: 1 })
    check('router cap refusal never falls back; pinned target stays on the same model after a cap change')

    await saveManaged(prisma, { ai: { provider: 'openrouter', model: 'vendor/chat', apiKey: 'chat-key', baseUrl: 'https://openrouter.ai/api/v1', maxPrice: { prompt: 1, completion: 2 } } })
    await assert.rejects(completeManaged('system', 'hello'), (e: any) => e instanceof PriceCapError && e.code === 'price_cap_exceeded')
    prisma.workspace = { findUnique: async () => ({ settings: { ai: { provider: 'sinoutx' } } }) }
    prisma.project = { findFirst: async () => null, findMany: async () => [] }
    const originalUserLookup = prisma.user.findUnique
    prisma.user.findUnique = async () => ({ balanceMicroUsd: balance, monthlyCapMicroUsd: 10_000_000, personalWorkspaceId: 'ws' })
    const chatStart = providerRequests.length
    let chat = ''
    for await (const event of streamChat([{ role: 'user', content: 'Hello' }], { workspaceId: 'ws', userId: 'user' }, prisma)) chat += event
    assert.match(chat, /price_cap_exceeded/)
    assert.match(chat, /"retryable":false/)
    assert.equal(providerRequests.length, chatStart + 1)
    assert.deepEqual(providerRequests.at(-1).provider.max_price, { prompt: 1, completion: 2 })
    prisma.user.findUnique = originalUserLookup
    stored = beforeCaps
    await primeManaged(prisma)
    priceFailure = ''
    routerFails = true
    setBillingMode(true)
    check('managed assistant and one-shot calls respect caps and never retry without them')

    balance = 0
    const spentCalls = routerCalls
    prisma.walletTransaction = { count: async () => 1 }
    const refused = await ask({ ...auto, routing_key: randomUUID() })
    assert.equal(refused.statusCode, 402)
    assert.equal(routerCalls, spentCalls)
    setBillingMode(false)
    await saveManaged(prisma, { code: { provider: '', model: '', apiKey: '', baseUrl: '' } })
    assert.equal(getManagedCode('medium')?.model, 'old-chat')
    await saveManaged(prisma, { codeRouter: { apiKey: 'router-key' } })
    await saveManaged(prisma, { ai: { apiKey: '' } })
    const noFallback = await ask({ ...auto, routing_key: randomUUID() })
    assert.equal(noFallback.statusCode, 503)
    assert.equal(noFallback.json().error.code, 'router_failed')
    check('wallet prevents router spending; legacy medium fallback retained; no strong fallback')
    console.log('All model tier integration checks passed')
  } finally {
    await app.close()
    await new Promise<void>((resolve, reject) => anthropic.close((e) => e ? reject(e) : resolve()))
    redis.disconnect()
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

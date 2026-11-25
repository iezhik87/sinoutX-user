// Real web_search chain with fake providers, no paid requests.
import assert from 'node:assert/strict'

async function main() {
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', MEILI_KEY: 'test', MINIO_PASSWORD: 'test', JWT_SECRET: 'test-with-at-least-thirty-two-characters', SEARCH_API: 'serper', SEARCH_API_KEY: 'private-serper-key', SEARXNG_URL: 'https://searx.invalid', BROWSER_SEARCH_TOKEN: 'private-browser-token' })
  const { config } = await import('../packages/backend/src/config/index.js')
  const { webSearch } = await import('../packages/backend/src/modules/ai/ai.service.js')
  const calls: Array<{ url: string; body: any; headers: any }> = []
  let apiWorks = true
  let browserWorks = true
  globalThis.fetch = (async (url: any, options: any = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers })
    const hit = { title: 'Weather', url: 'https://example.org', snippet: 'Text' }
    if (String(url).includes('browser-search:8090')) return new Response(JSON.stringify({ results: browserWorks ? [hit] : [], engine: 'bing', cached: true }))
    if (String(url).includes('google.serper.dev')) return new Response(JSON.stringify({ organic: apiWorks ? [{ title: hit.title, link: hit.url, snippet: hit.snippet }] : [] }))
    if (String(url).includes('searx.invalid')) return new Response(JSON.stringify({ results: [{ ...hit, content: 'weak', engine: 'seznam' }] }))
    throw new Error('Unexpected network request: ' + url)
  }) as any
  const opts = { userId: 'user-a', workspaceId: 'workspace-a', userLanguage: 'ru' as const, searchRegion: 'by-be' }
  const ask = () => webSearch('погода Минск', 3, opts, {} as any)
  config.BROWSER_SEARCH_MODE = 'off'
  assert.equal((await ask()).source, 'serper')
  assert.equal(calls.length, 1)
  config.BROWSER_SEARCH_MODE = 'fallback'
  calls.length = 0
  assert.equal((await ask()).source, 'serper')
  assert.equal(calls.length, 1)
  apiWorks = false
  calls.length = 0
  assert.equal((await ask()).source, 'browser_search')
  assert.deepEqual(calls.map((c) => new URL(c.url).hostname), ['google.serper.dev', 'searx.invalid', 'browser-search'])
  const internal = calls.at(-1)!
  assert.equal(internal.headers.Authorization, 'Bearer private-browser-token')
  assert.equal(JSON.stringify(internal).includes('private-serper-key'), false)
  assert.match(internal.body.scope, /^[a-f0-9]{64}$/)
  assert.equal(internal.body.language, 'ru')
  assert.equal(internal.body.country, 'by')
  console.log('PASS off/fallback preserve Serper, browser beats weak results, keys and locales are isolated')
  config.BROWSER_SEARCH_MODE = 'primary'
  calls.length = 0
  assert.equal((await ask()).source, 'browser_search')
  assert.equal(calls.length, 1)
  const firstScope = calls[0].body.scope
  await webSearch('погода Минск', 3, { ...opts, userId: 'user-b' }, {} as any)
  assert.notEqual(calls.at(-1)!.body.scope, firstScope)
  await webSearch('погода Минск', 3, { ...opts, workspaceId: 'workspace-b' }, {} as any)
  assert.notEqual(calls.at(-1)!.body.scope, firstScope)
  browserWorks = false
  apiWorks = true
  calls.length = 0
  assert.equal((await ask()).source, 'serper')
  assert.equal(calls.length, 2)
  config.BROWSER_SEARCH_TOKEN = ''
  calls.length = 0
  assert.equal((await ask()).source, 'serper')
  assert.equal(calls.length, 1)
  console.log('PASS primary uses real browser path once, tenant cache scopes differ, blocked/missing browser falls back to API')
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

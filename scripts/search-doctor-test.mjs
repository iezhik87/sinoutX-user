// Exercise the shipped diagnostic script without network access or real keys.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./search-doctor.mjs', import.meta.url), 'utf8')
async function run(env, handler) {
  const output = []
  const calls = []
  const process = { env, exitCode: 0, stdout: { write: (s) => output.push(String(s)) } }
  const context = {
    URL, URLSearchParams, AbortSignal, process,
    console: { log: (...s) => output.push(s.join(' ')) },
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init) },
  }
  await vm.runInNewContext(`(async () => { ${source}\n })()`, context)
  return { output: output.join('\n'), code: process.exitCode, calls }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const key = 'TEST-SECRET-DO-NOT-LOG'
const env = { SEARCH_DOCTOR_API_ONLY: '1', SEARCH_API: 'serper', SEARCH_API_KEY: key, SEARCH_DOCTOR_QUERY: 'погода Минск' }

let r = await run(env, (_url, init) => {
  assert.equal(init.headers['X-API-KEY'], key)
  assert.deepEqual(JSON.parse(init.body), { q: 'погода Минск', num: 3 })
  return json({ organic: [{ title: 'Weather', link: 'https://weather.example/minsk' }] })
})
assert.equal(r.calls.length, 1)
assert.equal(r.calls[0].url, 'https://google.serper.dev/search')
assert.match(r.output, /Serper: ✅ 1/)
assert.equal(r.code, 0)
assert.ok(!r.output.includes(key))
console.log('PASS Serper API-only makes one bounded request using the real backend endpoint')

for (const status of [401, 403, 429, 500]) {
  r = await run(env, () => new Response(`error with ${key}`, { status }))
  assert.equal(r.calls.length, 1)
  assert.equal(r.code, 1)
  assert.match(r.output, new RegExp(`HTTP ${status}`))
  assert.ok(!r.output.includes(key))
}
for (const response of [() => new Response('<html>not JSON</html>'), () => json({ error: key }), () => { throw new Error(`network error ${key}`) }]) {
  r = await run(env, response)
  assert.equal(r.code, 1)
  assert.ok(!r.output.includes(key))
}
r = await run(env, () => json({ organic: [] }))
assert.match(r.output, /пусто/)
assert.equal(r.code, 0)
r = await run({ ...env, SEARCH_API_KEY: '' }, () => assert.fail('Missing key must not call a provider'))
assert.equal(r.calls.length, 0)
assert.equal(r.code, 1)
console.log('PASS errors, empty results and missing keys are distinguished without leaking a key')

r = await run({ SEARCH_DOCTOR_QUERY: 'погода Минск' }, (url) => {
  if (url.endsWith('/config')) return json({ engines: [{ name: 'bing', enabled: false }, { name: 'wikipedia', enabled: true }, { name: 'yandex', enabled: true }] })
  if (url.includes('duckduckgo.com')) return new Response('challenge', { status: 202 })
  const engine = new URL(url).searchParams.get('engines')
  if (engine === 'yandex') return json({ results: [], unresponsive_engines: [['yandex', 'HTTP 403']] })
  if (engine === 'wikipedia') return json({ results: [], unresponsive_engines: [] })
  return json({ results: [{ title: 'Weather', url: 'https://weather.example', engine: 'bing' }] })
})
assert.match(r.output, /Общий поиск SearXNG: 1 результатов/)
assert.match(r.output, /bing\s+✅ 1\s+\[не в общем поиске\]/)
assert.match(r.output, /yandex\s+— ошибка\s+HTTP 403/)
assert.match(r.output, /wikipedia\s+— пусто\s+результатов нет; причина неизвестна/)
assert.match(r.output, /marginalia\s+— отсутствует/)
assert.ok(!r.output.includes('проверка на робота'))
console.log('PASS default and forced searches differ; empty results do not imply a CAPTCHA')

const browserEnv = { SEARCH_DOCTOR_BROWSER_ONLY: '1', BROWSER_SEARCH_TOKEN: key, BROWSER_SEARCH_MODE: 'fallback' }
r = await run(browserEnv, (url, init) => {
  assert.equal(url, 'http://browser-search:8090/search')
  assert.equal(init.headers.Authorization, 'Bearer ' + key)
  assert.match(JSON.parse(init.body).scope, /^[a-f0-9]{64}$/)
  return json({ results: [{ title: 'weather', url: 'https://weather.example' }], engine: 'bing', cached: true, attempts: [{ engine: 'bing', status: 'ok' }] })
})
assert.equal(r.calls.length, 1)
assert.equal(r.code, 0)
assert.match(r.output, /Браузерный поиск: ✅ 1/)
assert.ok(!r.output.includes(key))
r = await run(browserEnv, () => json({ results: [], attempts: [{ engine: 'bing', status: 'blocked' }] }))
assert.equal(r.code, 1)
assert.match(r.output, /bing: blocked/)
r = await run(browserEnv, () => { throw new Error('failed with ' + key) })
assert.equal(r.code, 1)
assert.ok(!r.output.includes(key))
console.log('PASS browser-only diagnostic skips Serper, reports blocks/cache, and redacts the shared token')
r = await run(browserEnv, () => json({ error: 'browser_search_timeout', stage: 'navigating', engine: 'bing', elapsedMs: 20000, attempts: [{ engine: 'google', status: 'blocked', elapsedMs: 1200 }] }, 504))
assert.equal(r.code, 1)
assert.match(r.output, /HTTP 504/)
assert.match(r.output, /navigating.*bing.*20000/)
assert.match(r.output, /google: blocked \(1200 мс\)/)
r = await run(browserEnv, () => json({ results: [], timedOut: true, elapsedMs: 18000, attempts: [{ engine: 'bing', status: 'timeout', stage: 'navigating', elapsedMs: 6000 }] }))
assert.match(r.output, /общий бюджет времени исчерпан/)
assert.match(r.output, /bing: timeout/)
assert.match(r.output, /этап: navigating/)
console.log('PASS timeout diagnostics include stage, engine and bounded timing without query/token data')
r = await run(browserEnv, () => json({ results: [], attempts: [{ engine: 'google', status: 'error', httpStatus: 200, pageKind: 'other', matchedRows: 0, visibleRows: 0, failedRequests: 2, errorCode: 'browser_closed' }] }))
assert.match(r.output, /HTTP: 200/)
assert.match(r.output, /элементов выдачи: 0/)
assert.match(r.output, /сбоев загрузки: 2/)
assert.match(r.output, /причина: browser_closed/)
console.log('PASS empty-page diagnostics distinguish DOM, loading and browser failures')

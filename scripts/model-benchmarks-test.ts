import assert from 'node:assert/strict'
import { LiveBenchClient, parseBenchmarkCsv, parseBenchmarkRuns, attachModelBenchmark, type BenchmarkResult } from '../packages/backend/src/lib/modelBenchmarks.ts'
import { taskBenchmark, compareBenchmark } from '../packages/frontend/src/lib/modelBenchmarks.ts'
import { emptyModelFilters, matchesModelFilters } from '../packages/frontend/src/lib/modelFilters.ts'

const categories = {
  'Long Agentic': ['agentic'], Reasoning: ['reasoning'], Coding: ['coding'], Browser: ['browser'],
  'Data Analysis': ['data'], Research: ['research'], Design: ['design'],
  _overall_weights: { 'Long Agentic': 2, Coding: 1.5, Design: 1.5 },
}
const csv = 'model,agentic,reasoning,coding,browser,data,research,design\r\n"gpt-6.2-astra",80,90,95,70,60,50,40\r\nclaude-opus-5.5,90,80,85,70,60,50,40\r\ngpt-6.2-sol,0,0,0,0,0,0,\r\n'
const date = Date.parse('2026-11-25T12:00:00Z')
const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), init)

async function main() {
  assert.deepEqual(parseBenchmarkCsv('model,x\n"a,""b""",1\n'), [['model', 'x'], ['a,"b"', '1']])
  const runs = parseBenchmarkRuns(csv, categories)
  assert.equal(runs[0].scores.coding, 95)
  assert.equal(runs[0].scores.overall, (80 * 2 + 90 + 95 * 1.5 + 70 + 60 + 50 + 40 * 1.5) / 9)
  assert.equal(runs[2].scores.coding, 0)
  assert.equal(runs[2].scores.design, undefined)
  assert.equal(runs[2].scores.overall, 0)
  assert.throws(() => parseBenchmarkRuns(csv.replace(',95,', ',101,'), categories))
  assert.throws(() => parseBenchmarkRuns(csv, { ...categories, Coding: ['missing'] }))
  console.log('PASS quoted CSV, task scores, current source weights, missing values and malformed schemas')

  let calls = 0, fail = false, now = date, saved: string | null = null
  const fetcher: typeof fetch = async (input) => {
    calls++
    if (fail) return new Response('unavailable', { status: 503 })
    const url = String(input)
    if (url === 'https://livebench.ai/') return new Response('<script defer="defer" src="./static/js/main.hash.js"></script>')
    if (url.endsWith('main.hash.js')) return new Response('const renamed=["20261014","20261106","20990101"];')
    if (url.endsWith('/table.csv')) return new Response(csv, { headers: { 'last-modified': 'Tue, 24 Nov 2026 00:11:21 GMT' } })
    if (url.endsWith('/categories.json')) return json(categories)
    if (url.endsWith('/notes.json')) return json(['Models run with the highest supported effort setting.'])
    throw new Error('Unexpected public URL')
  }
  const client = new LiveBenchClient({ read: async () => saved, write: async (data) => { saved = data } }, fetcher, () => now)
  const [first, concurrent] = await Promise.all([client.load(), client.load()])
  assert.equal(first, concurrent)
  assert.equal(calls, 5)
  assert.equal(first.status, 'fresh')
  assert.equal(first.snapshot?.release, '2026-11-06')
  assert.equal(first.snapshot?.publishedAt, '2026-11-24T00:11:21.000Z')
  await client.load(); assert.equal(calls, 5)
  const restored = new LiveBenchClient({ read: async () => saved, write: async () => {} }, fetcher, () => now)
  assert.equal((await restored.load()).status, 'fresh'); assert.equal(calls, 5)
  fail = true
  assert.equal((await client.load(true)).status, 'stale')
  const afterFailure = calls
  assert.equal((await client.load()).status, 'stale'); assert.equal(calls, afterFailure)
  now += 5 * 60_000 + 1
  await client.load(); assert.ok(calls > afterFailure)
  const unavailable = new LiveBenchClient(undefined, fetcher, () => now)
  assert.equal((await unavailable.load()).status, 'unavailable')
  console.log('PASS current release discovery, coalescing, persistent cache, refresh failure/backoff and no fabricated fallback')

  const benchmark = attachModelBenchmark('openai/gpt-6.2-astra', first)
  assert.equal(benchmark?.runs[0].model, 'gpt-6.2-astra')
  for (const id of ['openai/gpt-6.3-astra', 'openai/gpt-6.2-astra-mini', 'other/gpt-6.2-astra', 'openai/gpt-6.2-astra:free']) assert.equal(attachModelBenchmark(id, first), null)
  const versioned: BenchmarkResult = { ...first, snapshot: { ...first.snapshot!, runs: [{ model: 'gpt-6.2-astra-20261119-high', scores: { coding: 90 } }] } }
  assert.equal(attachModelBenchmark('openai/gpt-6.2-astra', versioned)?.runs[0].scores.coding, 90)
  const base = { tags: ['coding'], contextLength: 128000, promptPer1M: 1, completionPer1M: 2 }
  const measured = { ...base, id: 'openai/gpt-6.2-astra', benchmark }
  const missing = { ...base, id: 'new-model' }
  const zero = { ...base, id: 'openai/gpt-6.2-sol', benchmark: attachModelBenchmark('openai/gpt-6.2-sol', first) }
  assert.equal(taskBenchmark(measured, 'coding')?.score, 95)
  assert.equal(taskBenchmark(zero, 'coding')?.score, 0)
  const filters = { ...emptyModelFilters(), benchmarkTask: 'coding' as const, minScore: '90', maxPrompt: '1' }
  assert.equal(matchesModelFilters(measured, filters), true)
  assert.equal(matchesModelFilters(missing, filters), false)
  assert.equal(matchesModelFilters(zero, { ...filters, minScore: '0' }), true)
  assert.equal(matchesModelFilters(missing, { ...filters, minScore: '0' }), false)
  assert.deepEqual([missing, zero, measured].sort((a, b) => compareBenchmark(a, b, 'coding')).map((m) => m.id), [measured.id, zero.id, missing.id])
  assert.deepEqual([missing, zero, measured].sort((a, b) => compareBenchmark(a, b, 'coding', true)).map((m) => m.id), [zero.id, measured.id, missing.id])
  assert.equal(matchesModelFilters(missing, { ...emptyModelFilters(), benchmarkPresence: 'unscored' }), true)
  console.log('PASS exact model versions, zero-vs-missing, task ranking, combined price/score filters and unrated last')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

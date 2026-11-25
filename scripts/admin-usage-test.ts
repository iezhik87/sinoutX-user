import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { usagePeriod, monthlyUsageSql } from '../packages/backend/src/lib/adminUsage.ts'
import { emptyModelFilters, matchesModelFilters, compareModelPrice } from '../packages/frontend/src/lib/modelFilters.ts'

async function main() {
  const now = new Date('2026-11-25T12:00:00Z')
  assert.deepEqual(usagePeriod({}).where, {})
  assert.equal(usagePeriod({ days: '30' }, now).since?.toISOString(), '2026-10-26T12:00:00.000Z')
  const leap = usagePeriod({ period: 'month', month: '2024-02' })
  assert.equal(leap.since?.toISOString(), '2024-02-01T00:00:00.000Z')
  assert.equal(leap.until?.toISOString(), '2024-03-01T00:00:00.000Z')
  for (const query of [
    { period: 'month' }, { period: 'month', month: '2025-13' }, { days: 'NaN' }, { days: '1.5' },
    { period: 'range', from: '2025-02-29', to: '2025-03-01' },
    { period: 'range', from: '2026-03-01', to: '2026-02-01' },
    { period: 'all', from: '2026-01-01' }, { period: 'all', days: '30' },
  ]) assert.throws(() => usagePeriod(query))
  console.log('PASS all-time, legacy window, leap months and invalid/contradictory date ranges')

  const models = [
    { id: 'free', tags: ['coding', 'tools'], contextLength: 128000, promptPer1M: 0, completionPer1M: 0 },
    { id: 'cheap', tags: ['coding', 'tools'], contextLength: 128000, promptPer1M: 1, completionPer1M: 2 },
    { id: 'expensive', tags: ['coding'], contextLength: 32000, promptPer1M: 10, completionPer1M: 20 },
    { id: 'unknown', tags: ['vision'], contextLength: 64000, promptPer1M: null, completionPer1M: null },
  ]
  const filters = { ...emptyModelFilters(), tags: ['coding', 'tools'], minContext: '128000', maxCompletion: '2' }
  assert.deepEqual(models.filter((m) => matchesModelFilters(m, filters)).map((m) => m.id), ['free', 'cheap'])
  assert.deepEqual(models.filter((m) => matchesModelFilters(m, { ...emptyModelFilters(), price: 'free' })).map((m) => m.id), ['free'])
  assert.deepEqual(models.filter((m) => matchesModelFilters(m, { ...emptyModelFilters(), maxPrompt: '0' })).map((m) => m.id), ['free'])
  for (const basis of ['blended', 'prompt', 'completion'] as const) {
    assert.deepEqual([...models].sort((a, b) => compareModelPrice(a, b, basis)).map((m) => m.id), ['free', 'cheap', 'expensive', 'unknown'])
    assert.deepEqual([...models].sort((a, b) => compareModelPrice(a, b, basis, true)).map((m) => m.id), ['expensive', 'cheap', 'free', 'unknown'])
  }
  console.log('PASS combined model filters, zero-price limits and unknown prices last in both sort directions')

  // PostgreSQL engine in WASM, isolated in memory. No application DB credentials.
  // npm install --prefix .tools/usage-tests --no-package-lock @electric-sql/pglite
  const { PGlite } = await import(pathToFileURL(resolve(process.env.PGLITE_MODULE ?? '.tools/usage-tests/node_modules/@electric-sql/pglite/dist/index.js')).href)
  const db = await PGlite.create()
  try {
    await db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES (\'ws\');')
    for (const migration of ['20260710120000_ai_usage', '20260710130000_ai_usage_cost', '20261125120000_usage_history']) {
      await db.exec(await readFile(`packages/backend/prisma/migrations/${migration}/migration.sql`, 'utf8'))
    }
    await db.exec("SET TIME ZONE 'Pacific/Honolulu'")
    const entries = [
      ['2024-02-29T23:59:59.999Z', true, 1000000, 1200000],
      ['2024-03-01T00:00:00.000Z', false, 2000000, 0],
      ['2025-12-31T23:59:59.999Z', true, 3000000, 3600000],
      ['2026-01-01T00:00:00.000Z', false, 4000000, 0],
      ['2026-11-25T12:00:00.000Z', true, 5000000, 6000000],
    ] as const
    for (const [i, [at, managed, cost, charged]] of entries.entries()) {
      await db.query(`INSERT INTO ai_usage (id, workspace_id, user_id, provider, model, created_at, managed, input_tokens, cached_input_tokens, output_tokens, calls, cost_micro_usd, charged_micro_usd)
        VALUES ($1, 'ws', 'user', 'test', 'test', $2, $3, 100, 50, 20, 2, $4, $5)`, [String(i), at, managed, cost, charged])
    }
    const report = async (query: unknown) => {
      const sql = monthlyUsageSql(usagePeriod(query, now))
      return (await db.query(sql.text, sql.values)).rows
    }
    const all = await report({})
    assert.deepEqual(all.map((m: any) => m.month), ['2026-11', '2026-01', '2025-12', '2024-03', '2024-02'])
    assert.equal(all.reduce((n: number, m: any) => n + m.answers, 0), 5)
    assert.equal(all.reduce((n: number, m: any) => n + m.costUsd, 0), 9)
    assert.equal(all.reduce((n: number, m: any) => n + m.byokCostUsd, 0), 6)
    assert.equal(all[0].inputTokens, 100)
    assert.equal(all[0].cachedInputTokens, 50)
    const feb = await report({ period: 'month', month: '2024-02' })
    assert.equal(feb.length, 1)
    assert.equal(feb[0].answers, 1)
    assert.equal((await report({ period: 'month', month: '2026-02' })).length, 0)
    const boundary = await report({ period: 'range', from: '2025-12-31', to: '2025-12-31' })
    assert.equal(boundary.length, 1)
    assert.equal(boundary[0].month, '2025-12')
    assert.equal(boundary[0].costUsd, 3)
    console.log('PASS PostgreSQL monthly sums, multi-year history, UTC boundaries, inclusive last day, and empty months')
    await db.exec("DELETE FROM workspaces WHERE id = 'ws'")
    assert.deepEqual(await report({}), all)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_usage WHERE workspace_id IS NULL')).rows[0].n, 5)
    console.log('PASS migration retains the full accounting ledger after workspace deletion')
  } finally { await db.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

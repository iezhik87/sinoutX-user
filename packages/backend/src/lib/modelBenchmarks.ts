// Public results only. Never send a model query, user data or provider key here.
const ROOT = 'https://livebench.ai/'
export const BENCHMARK_SOURCE = ROOT
export const BENCHMARK_TASKS = ['overall', 'coding', 'agentic', 'reasoning', 'dataAnalysis', 'browser', 'research', 'design'] as const
export type BenchmarkTask = typeof BENCHMARK_TASKS[number]
const CATEGORIES: Record<Exclude<BenchmarkTask, 'overall'>, string> = {
  coding: 'Coding', agentic: 'Long Agentic', reasoning: 'Reasoning',
  dataAnalysis: 'Data Analysis', browser: 'Browser', research: 'Research', design: 'Design',
}
export interface BenchmarkRun { model: string; scores: Partial<Record<BenchmarkTask, number>> }
export interface BenchmarkSnapshot {
  version: 2; release: string; publishedAt: string | null; fetchedAt: string; source: string; dataUrl: string; runs: BenchmarkRun[]; notes: string[]
}
export interface BenchmarkResult { status: 'fresh' | 'stale' | 'unavailable'; snapshot: BenchmarkSnapshot | null }
export interface ModelBenchmark {
  source: string; dataUrl: string; release: string; publishedAt: string | null; fetchedAt: string; stale: boolean; runs: BenchmarkRun[]; notes: string[]
}

/** Small RFC-style CSV reader: quoted fields, escaped quotes and CR/LF. */
export function parseBenchmarkCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false
  text = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n')
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i] ?? '\n'
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(field); field = ''
      if (ch === '\n') { if (row.some((x) => x.trim())) rows.push(row); row = [] }
    } else field += ch
  }
  if (quoted) throw new Error('Invalid benchmark CSV')
  return rows
}

export function parseBenchmarkRuns(csv: string, categories: unknown): BenchmarkRun[] {
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('Invalid categories')
  const groups = categories as Record<string, unknown>
  const [header, ...rows] = parseBenchmarkCsv(csv)
  if (!header || header[0] !== 'model' || new Set(header).size !== header.length) throw new Error('Invalid benchmark header')
  const columns = new Map(header.map((name, i) => [name, i]))
  const tasks = Object.entries(CATEGORIES).map(([task, category]) => {
    const names = groups[category]
    if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== 'string' || !columns.has(name))) throw new Error('Benchmark schema changed')
    return [task as Exclude<BenchmarkTask, 'overall'>, names.map((name) => columns.get(name)!)] as const
  })
  const seen = new Set<string>()
  const runs = rows.map((row) => {
    const model = row[0]
    if (row.length > header.length || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(model) || seen.has(model)) throw new Error('Invalid benchmark row')
    seen.add(model)
    const scores: BenchmarkRun['scores'] = {}
    for (const [task, indices] of tasks) {
      const values = indices.map((index) => {
        const value = (row[index] ?? '').trim()
        if (['', '-', 'n/a', 'N/A', 'NaN'].includes(value)) return null
        const score = Number(value)
        if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid benchmark score')
        return score
      })
      // An incomplete category is not silently promoted by averaging fewer tasks.
      if (values.every((v): v is number => v !== null)) scores[task] = values.reduce((a, b) => a + b, 0) / values.length
    }
    // Follow the site's category weights; missing categories are omitted, not zero.
    let sum = 0, totalWeight = 0
    const weights = groups._overall_weights as Record<string, unknown> | undefined
    for (const [task, category] of Object.entries(CATEGORIES)) {
      const score = scores[task as BenchmarkTask]
      const weight = weights?.[category] ?? 1
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) throw new Error('Invalid benchmark weights')
      if (score !== undefined) { sum += score * weight; totalWeight += weight }
    }
    if (totalWeight) scores.overall = sum / totalWeight
    return { model, scores }
  })
  if (!runs.length) throw new Error('Empty benchmark')
  return runs
}

const FAMILIES: Record<string, RegExp> = {
  anthropic: /^claude-/, openai: /^(gpt-|o[1-9]|chatgpt-)/, google: /^(gemini|gemma)-/, deepseek: /^deepseek-/,
  'z-ai': /^glm-/, 'x-ai': /^grok-/, qwen: /^qwen/, moonshotai: /^kimi-/, minimax: /^minimax-/,
  mistralai: /^mistral-/, meta: /^muse-/, 'meta-llama': /^(llama-|muse-)/, xiaomi: /^mimo-/,
}
const normal = (s: string) => s.toLowerCase().replace(/\./g, '-')
const RUN_SUFFIX = /^(?:-(?:\d{8}|\d{4}-\d{2}-\d{2}))?(?:-thinking(?:-(?:auto|\d+k))?)?(?:-(?:low|medium|high|xhigh)(?:-effort)?)?$/

/** Exact version + known evaluation suffixes, never substring/fuzzy matching. */
export function attachModelBenchmark(modelId: string, result: BenchmarkResult): ModelBenchmark | null {
  const snapshot = result.snapshot
  if (!snapshot) return null
  const [vendor, name, extra] = modelId.split('/')
  if (extra || !name || !FAMILIES[vendor]?.test(name) || name.includes(':')) return null
  const base = normal(name)
  const runs = snapshot.runs.filter((run) => {
    const candidate = normal(run.model)
    return candidate.startsWith(base) && RUN_SUFFIX.test(candidate.slice(base.length))
  })
  return runs.length ? { source: snapshot.source, dataUrl: snapshot.dataUrl, release: snapshot.release, publishedAt: snapshot.publishedAt, fetchedAt: snapshot.fetchedAt, notes: snapshot.notes, stale: result.status === 'stale', runs } : null
}

type Store = { read: () => Promise<string | null>; write: (value: string) => Promise<unknown> }
const TTL = 6 * 60 * 60_000
export class LiveBenchClient {
  private cached: BenchmarkSnapshot | null = null
  private pending: Promise<BenchmarkResult> | null = null
  private retryAfter = 0
  private refreshFailed = false
  constructor(private store?: Store, private fetcher: typeof fetch = fetch, private clock = Date.now) {}

  private async text(url: string): Promise<{ text: string; modified: string | null }> {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json, text/plain', 'User-Agent': 'SinoutX-model-catalog' } })
    if (!response.ok) throw new Error('Benchmark source unavailable')
    const text = await response.text()
    if (text.length > 2_000_000) throw new Error('Benchmark source too large')
    const modified = response.headers.get('last-modified')
    return { text, modified: modified && Number.isFinite(Date.parse(modified)) ? new Date(modified).toISOString() : null }
  }

  private validCache(value: unknown): value is BenchmarkSnapshot {
    const s = value as BenchmarkSnapshot | null
    return !!s && s.version === 2 && /^\d{4}-\d{2}-\d{2}$/.test(s.release)
      && Number.isFinite(Date.parse(s.fetchedAt)) && s.source === BENCHMARK_SOURCE
      && s.dataUrl === ROOT + 'data/' + s.release.replace(/-/g, '') + '/table.csv'
      && Array.isArray(s.notes) && s.notes.every((note) => typeof note === 'string')
      && Array.isArray(s.runs) && s.runs.length > 0 && s.runs.every((r) => typeof r.model === 'string' && !!r.scores
        && Object.entries(r.scores).every(([key, n]) => BENCHMARK_TASKS.includes(key as BenchmarkTask) && typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100))
  }

  async load(force = false): Promise<BenchmarkResult> {
    if (this.pending) return this.pending
    this.pending = this.refresh(force).finally(() => { this.pending = null })
    return this.pending
  }

  private async refresh(force: boolean): Promise<BenchmarkResult> {
    if (!this.cached && this.store) {
      try { const saved = JSON.parse(await this.store.read() ?? 'null'); if (this.validCache(saved)) this.cached = saved } catch { /* Optional cache. */ }
    }
    if (!force && this.cached && !this.refreshFailed && this.clock() - Date.parse(this.cached.fetchedAt) < TTL) return { status: 'fresh', snapshot: this.cached }
    if (!force && this.clock() < this.retryAfter) return { status: this.cached ? 'stale' : 'unavailable', snapshot: this.cached }
    try {
      // Parse the public release list as DATA. Never execute downloaded JavaScript.
      const page = await this.text(ROOT)
      const asset = /(?:src=["'])(?:\.\/|\/)?(static\/js\/main\.[a-zA-Z0-9_-]+\.js)(?:\?[^"']*)?["']/.exec(page.text)?.[1]
      if (!asset) throw new Error('Benchmark page changed')
      const script = await this.text(ROOT + asset)
      const today = new Date(this.clock()).toISOString().slice(0, 10).replace(/-/g, '')
      const releases = [...new Set([...script.text.matchAll(/\[\s*"20\d{6}"(?:\s*,\s*"20\d{6}")*\s*\]/g)]
        .flatMap((match) => JSON.parse(match[0]) as string[]))].filter((date) => date <= today).sort().reverse()
      if (!releases.length) throw new Error('No benchmark release')
      const release = releases[0]
      const dataUrl = ROOT + 'data/' + release + '/table.csv'
      const [csv, categories, noteFile] = await Promise.all([
        this.text(dataUrl), this.text(ROOT + 'data/' + release + '/categories.json'),
        this.text(ROOT + 'data/' + release + '/notes.json').catch(() => null),
      ])
      const notes: unknown = noteFile ? JSON.parse(noteFile.text) : []
      if (!Array.isArray(notes) || notes.some((note) => typeof note !== 'string' || note.length > 4000)) throw new Error('Invalid benchmark notes')
      const snapshot: BenchmarkSnapshot = {
        version: 2, release: release.slice(0, 4) + '-' + release.slice(4, 6) + '-' + release.slice(6),
        publishedAt: csv.modified, fetchedAt: new Date(this.clock()).toISOString(), source: BENCHMARK_SOURCE,
        dataUrl, runs: parseBenchmarkRuns(csv.text, JSON.parse(categories.text)), notes,
      }
      this.cached = snapshot
      this.retryAfter = 0
      this.refreshFailed = false
      if (this.store) await this.store.write(JSON.stringify(snapshot)).catch(() => {})
      return { status: 'fresh', snapshot }
    } catch {
      this.retryAfter = this.clock() + 5 * 60_000
      this.refreshFailed = true
      return { status: this.cached ? 'stale' : 'unavailable', snapshot: this.cached }
    }
  }
}

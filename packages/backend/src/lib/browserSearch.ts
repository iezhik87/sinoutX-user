import { createHash } from 'node:crypto'
import { config } from '../config/index.js'

export interface BrowserSearchHit { title: string; url: string; snippet: string }
export async function browserSearch(query: string, limit: number, opts: {
  language?: string; country?: string; userId?: string; workspaceId?: string
}): Promise<{ results: BrowserSearchHit[]; engine?: string; cached?: boolean } | null> {
  if (config.BROWSER_SEARCH_MODE === 'off' || !config.BROWSER_SEARCH_TOKEN) return null
  const count = Math.max(1, Math.min(10, Number.isFinite(limit) ? Math.floor(limit) : 8))
  const scope = createHash('sha256').update(JSON.stringify([opts.userId ?? null, opts.workspaceId ?? null])).digest('hex')
  try {
    const response = await fetch(`${config.BROWSER_SEARCH_URL.replace(/\/$/, '')}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.BROWSER_SEARCH_TOKEN}` },
      body: JSON.stringify({ query, limit: count, language: ['ru', 'be'].includes(opts.language ?? '') ? opts.language : 'en', country: opts.country ?? '', scope }),
      signal: AbortSignal.timeout(43_000),
    })
    if (!response.ok) { console.warn('[browser-search] HTTP', response.status); return null }
    const data = await response.json() as { results?: BrowserSearchHit[]; engine?: string; cached?: boolean }
    if (!Array.isArray(data.results)) return null
    const results = data.results.filter((r) => typeof r.title === 'string' && typeof r.url === 'string' && r.url.length <= 4096 && /^https?:\/\//i.test(r.url))
      .slice(0, count).map((r) => ({ title: r.title.slice(0, 300), url: r.url, snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 1200) : '' }))
    return { results, engine: data.engine, cached: data.cached === true }
  } catch {
    // Browser errors may embed the original query. Log a category, not internals.
    console.warn('[browser-search] unavailable')
    return null
  }
}

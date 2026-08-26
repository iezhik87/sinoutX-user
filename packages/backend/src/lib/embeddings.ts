// Semantic embeddings for memory recall (Phase 2). BYOK — runs on the workspace's
// OWN provider key (resolved by getEmbeddingsConfig in ai.service), so each user
// pays for their own usage. Vectors stored as JSON, cosine-ranked in app (no
// pgvector). When a workspace has no embeddings-capable key, callers fall back to
// keyword recall.
import type { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

export interface EmbeddingsConfig {
  apiKey: string
  baseUrl: string
  model: string
  /** Set only when the key is ours: the tokens are then charged to the user. */
  onUsage?: (u: { inputTokens: number; cachedInputTokens: number; outputTokens: number }) => void
}

export async function embed(texts: string[], cfg: EmbeddingsConfig): Promise<number[][] | null> {
  // A key is required of a hosted provider, but a local embedder has none —
  // demanding one made self-hosting semantic memory impossible, which is the
  // only option left where the hosted ones are geo-blocked.
  if (!cfg?.baseUrl || texts.length === 0) return null
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) { console.error('[embeddings]', res.status, (await res.text()).slice(0, 200)); return null }
    const json = (await res.json()) as { data?: { embedding: number[] }[]; usage?: { prompt_tokens?: number } }
    // Embeddings bill for input only; there is no completion to pay for.
    if (cfg.onUsage && json.usage?.prompt_tokens) {
      cfg.onUsage({ inputTokens: json.usage.prompt_tokens, cachedInputTokens: 0, outputTokens: 0 })
    }
    const out = json.data?.map((d) => d.embedding)
    return out && out.length === texts.length ? out : null
  } catch (e) { console.error('[embeddings] error', e); return null }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// Flatten a record's data into a text blob for embedding.
export function recordText(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data ?? '')
  return Object.entries(data as Record<string, unknown>)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => (v == null || v === '' ? '' : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`))
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000)
}

export function textHash(s: string, model: string): string { return createHash('sha1').update(model + ':' + s).digest('hex') }

export interface RecallHit { recordId: string; collectionId: string; data: unknown; score: number }

/**
 * Semantic recall over a workspace's collection records. Shared by the
 * /collections/recall route AND the built-in agent's `recall` tool. Resolves
 * candidate collections (constrained to the workspace), backfills missing
 * embeddings on the fly, and returns records ranked by cosine to the query.
 * Caller must have already resolved `cfg` (null cfg → keyword fallback upstream).
 */
// Small nudges layered on top of cosine relevance for MEMORY recall, so that
// among the relevant memories the important and the recent surface first. They
// are deliberately tiny next to the cosine range (~0.3–0.7): a weak-but-recent
// match can never beat a strong one, and the relevance floor still gates on raw
// cosine. (Idea from Stanford's Generative Agents: relevance × recency × importance.)
const RECENCY_MAX = 0.08
const RECENCY_HALFLIFE_DAYS = 30
function recencyBoost(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000
  return RECENCY_MAX * Math.exp(-Math.max(0, ageDays) / RECENCY_HALFLIFE_DAYS)
}
function importanceBoost(data: unknown): number {
  const imp = (data as { importance?: string } | null)?.importance
  if (imp === 'high') return 0.1
  if (imp === 'low') return -0.08
  return 0
}

export async function recallRecords(
  prisma: PrismaClient,
  cfg: EmbeddingsConfig,
  params: { workspaceId: string; query: string; collectionIds?: string[]; limit?: number; since?: string; until?: string; backfill?: boolean; maxRecords?: number; minScore?: number; memoryRank?: boolean },
): Promise<RecallHit[]> {
  const { workspaceId, query } = params
  const limit = params.limit ?? 10
  const backfill = params.backfill !== false // default true; pass false on hot paths
  const projs = await prisma.project.findMany({ where: { workspaceId }, select: { id: true } })
  const wsCols = await prisma.collection.findMany({ where: { projectId: { in: projs.map((p) => p.id) } }, select: { id: true } })
  const wsColSet = new Set(wsCols.map((c) => c.id))
  const colIds = (params.collectionIds?.length ? params.collectionIds : wsCols.map((c) => c.id)).filter((id) => wsColSet.has(id))
  if (!colIds.length) return []

  const dateWhere = (params.since || params.until)
    ? { createdAt: { ...(params.since ? { gte: new Date(params.since) } : {}), ...(params.until ? { lte: new Date(params.until) } : {}) } }
    : {}
  const records = await prisma.collectionRecord.findMany({ where: { collectionId: { in: colIds }, ...dateWhere }, include: { embedding: true }, take: params.maxRecords ?? 4000 })
  if (!records.length) return []

  const missing = backfill ? records.filter((r) => !r.embedding) : []
  if (missing.length) {
    const vecs = await embed(missing.map((r) => recordText(r.data)), cfg)
    if (vecs) {
      await Promise.all(missing.map((r, i) =>
        prisma.recordEmbedding.upsert({
          where: { recordId: r.id },
          create: { recordId: r.id, collectionId: r.collectionId, workspaceId, model: cfg.model, vector: vecs[i] as object, textHash: textHash(recordText(r.data), cfg.model) },
          update: { vector: vecs[i] as object, textHash: textHash(recordText(r.data), cfg.model), model: cfg.model },
        }).then(() => { (r as { embedding?: { vector: unknown } }).embedding = { vector: vecs[i] } }).catch(() => {}),
      ))
    }
  }

  const qv = (await embed([query], cfg))?.[0]
  if (!qv) return []
  // A relevance floor keeps recall clean: without it the top-N are returned no
  // matter how weak, so an unrelated query still injects N low-similarity memories
  // as noise. Callers that want everything pass minScore 0 (the default).
  const floor = params.minScore ?? 0
  // Rank by cosine, plus (for memory) gentle recency/importance nudges. The floor
  // is always on RAW cosine, so the nudges only reorder the already-relevant set.
  const rankScore = (r: (typeof records)[number], cos: number) =>
    params.memoryRank ? cos + importanceBoost(r.data) + recencyBoost(r.createdAt) : cos
  return records
    .map((r) => ({ r, score: r.embedding ? cosine(qv, (r.embedding.vector as number[])) : -1 }))
    // Never recall a memory that was superseded by a newer/contradicting one.
    .filter((x) => x.score >= floor && !(x.r.data as Record<string, unknown> | null)?._superseded)
    .sort((a, b) => rankScore(b.r, b.score) - rankScore(a.r, a.score))
    .slice(0, limit)
    .map(({ r, score }) => ({ recordId: r.id, collectionId: r.collectionId, data: stripPrivate(r.data), score: Number(score.toFixed(4)) }))
}

// Drop reserved `_`-prefixed keys (e.g. `_sec` encrypted secrets) so recall
// results never expose secret ciphertext to the agent.
function stripPrivate(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (!k.startsWith('_')) out[k] = v
  return out
}

// Compute + upsert the embedding for a single record. Safe to fire-and-forget.
export async function indexRecord(prisma: PrismaClient, rec: { id: string; collectionId: string; data: unknown }, workspaceId: string, cfg: EmbeddingsConfig): Promise<void> {
  // A base URL is what makes the config usable; the key is optional, because the
  // embedder running inside the stack has none. Checking the key here meant
  // nothing was ever indexed against a local embedder — silently.
  if (!cfg?.baseUrl) return
  const text = recordText(rec.data)
  if (!text.trim()) return
  const hash = textHash(text, cfg.model)
  const existing = await prisma.recordEmbedding.findUnique({ where: { recordId: rec.id }, select: { textHash: true } }).catch(() => null)
  if (existing?.textHash === hash) return
  const vecs = await embed([text], cfg)
  if (!vecs) return
  await prisma.recordEmbedding.upsert({
    where: { recordId: rec.id },
    create: { recordId: rec.id, collectionId: rec.collectionId, workspaceId, model: cfg.model, vector: vecs[0] as object, textHash: hash },
    update: { vector: vecs[0] as object, textHash: hash, model: cfg.model, collectionId: rec.collectionId, workspaceId },
  }).catch((e) => console.error('[embeddings] upsert', e))
}

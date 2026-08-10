// ─── User-defined Custom Tools (HTTP) ─────────────────────────────────────────
// A custom tool wraps any HTTP API into a model-callable tool. Defined by the
// user (usually via AI-assembly), stored per-workspace in
// `workspace.settings.customTools` (JSON — no migration). Secrets are encrypted
// at rest. The agent calls it like any built-in tool; executeCustomTool performs
// the request with an SSRF guard, secret injection, timeout and response shaping.
import type { PrismaClient } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { encryptSecret, decryptSecret } from '../../lib/crypto.js'

export type ParamType = 'string' | 'number' | 'boolean' | 'enum'

export interface CustomToolParam {
  key: string
  type: ParamType
  required?: boolean
  description?: string
  example?: string | number | boolean
  enumValues?: string[]
  default?: string | number | boolean
}

export interface CustomTool {
  id: string                 // also the tool name exposed to the agent (ascii)
  name: string               // human label
  description: string        // agent contract: when/why to call
  params: CustomToolParam[]
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url: string              // with {param} placeholders
    headers: { key: string; value: string }[]  // value may contain {{secret.name}} / {param}
    query?: { key: string; value: string }[]
    bodyType: 'none' | 'json' | 'form'
    bodyTemplate?: string    // with {param} placeholders
  }
  auth: { type: 'none' | 'bearer' | 'header' | 'basic'; secretName?: string; headerName?: string }
  secrets: Record<string, string>   // name → encrypted (plaintext when sent from the form)
  responseHint?: string      // dot-path to the useful field, or '' for whole response
  enabled: boolean
  createdBy?: string
  // Skill kind. 'http' = a tool the agent CALLS (the original custom tool).
  // 'scheduled' = recurring behaviour on a clock; 'trigger' = behaviour that fires
  // on a workspace EVENT (e.g. a record/task created). Both run `prompt` via the
  // runner; neither is exposed as a callable tool.
  kind?: 'http' | 'scheduled' | 'trigger'
  schedule?: { hour: number }   // 'scheduled': run daily at this local hour
  event?: string                // 'trigger': event type to react to (e.g. 'record.created')
  prompt?: string               // 'scheduled'/'trigger': what the agent does each run
  lastRunAt?: string
}

const ALLOW_INTERNAL = process.env.ALLOW_CUSTOM_TOOL_INTERNAL === 'true'

// ─── Persistence ──────────────────────────────────────────────────────────────

function sanitize(t: Partial<CustomTool>, prev?: CustomTool): CustomTool | null {
  if (!t || typeof t.name !== 'string') return null
  const id = (typeof t.id === 'string' && t.id) || prev?.id || ('ct_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
  const r = t.request ?? prev?.request
  // Encrypt any plaintext secrets coming from the form; keep already-encrypted as-is.
  const secrets: Record<string, string> = {}
  for (const [k, v] of Object.entries(t.secrets ?? prev?.secrets ?? {})) {
    if (typeof v !== 'string' || !v) continue
    // Heuristic: values that look masked (all asterisks) keep the previous encrypted one.
    if (/^\*+$/.test(v) && prev?.secrets?.[k]) { secrets[k] = prev.secrets[k]; continue }
    // If it decrypts cleanly it's already encrypted; otherwise encrypt it.
    secrets[k] = isEncrypted(v) ? v : (encryptSecret(v) ?? v)
  }
  return {
    id,
    name: t.name.slice(0, 80),
    description: String(t.description ?? '').slice(0, 600),
    params: Array.isArray(t.params) ? t.params.filter((p) => p && typeof p.key === 'string').slice(0, 30).map((p) => ({
      key: p.key.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'param',
      type: (['string', 'number', 'boolean', 'enum'] as ParamType[]).includes(p.type) ? p.type : 'string',
      required: !!p.required,
      description: String(p.description ?? '').slice(0, 300),
      example: p.example,
      enumValues: Array.isArray(p.enumValues) ? p.enumValues.map(String).slice(0, 40) : undefined,
      default: p.default,
    })) : [],
    request: {
      method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(r?.method as any) ? (r!.method) : 'GET',
      url: String(r?.url ?? '').slice(0, 2000),
      headers: Array.isArray(r?.headers) ? r!.headers.filter((h) => h && typeof h.key === 'string').slice(0, 30).map((h) => ({ key: String(h.key), value: String(h.value ?? '') })) : [],
      query: Array.isArray(r?.query) ? r!.query.filter((q) => q && typeof q.key === 'string').slice(0, 30).map((q) => ({ key: String(q.key), value: String(q.value ?? '') })) : [],
      bodyType: (['none', 'json', 'form'] as const).includes(r?.bodyType as any) ? (r!.bodyType) : 'none',
      bodyTemplate: r?.bodyTemplate ? String(r.bodyTemplate).slice(0, 8000) : undefined,
    },
    auth: {
      type: (['none', 'bearer', 'header', 'basic'] as const).includes(t.auth?.type as any) ? (t.auth!.type) : 'none',
      secretName: t.auth?.secretName ? String(t.auth.secretName).replace(/[^a-zA-Z0-9_]/g, '') : undefined,
      headerName: t.auth?.headerName ? String(t.auth.headerName) : undefined,
    },
    secrets,
    responseHint: t.responseHint ? String(t.responseHint).slice(0, 200) : undefined,
    enabled: t.enabled !== false,
    createdBy: t.createdBy ?? prev?.createdBy,
    kind: t.kind === 'scheduled' ? 'scheduled' : t.kind === 'trigger' ? 'trigger' : 'http',
    schedule: t.kind === 'scheduled' ? { hour: Math.max(0, Math.min(23, Math.trunc(Number(t.schedule?.hour ?? prev?.schedule?.hour ?? 9)) || 9)) } : undefined,
    event: t.kind === 'trigger' ? String(t.event ?? prev?.event ?? '').slice(0, 60) : undefined,
    prompt: (t.kind === 'scheduled' || t.kind === 'trigger') ? String(t.prompt ?? prev?.prompt ?? '').slice(0, 2000) : undefined,
    lastRunAt: t.lastRunAt ?? prev?.lastRunAt,
  }
}

function isEncrypted(v: string): boolean {
  try { decryptSecret(v); return v.includes(':') && v.length > 24 } catch { return false }
}

export async function getCustomTools(workspaceId: string, prisma: PrismaClient): Promise<CustomTool[]> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } })
  const settings = (ws?.settings ?? {}) as Record<string, unknown>
  const stored = settings.customTools as Partial<CustomTool>[] | undefined
  if (!Array.isArray(stored)) return []
  return stored.map((t) => sanitize(t)).filter((t): t is CustomTool => !!t)
}

export async function saveCustomTools(workspaceId: string, prisma: PrismaClient, tools: Partial<CustomTool>[]): Promise<CustomTool[]> {
  const existing = await getCustomTools(workspaceId, prisma)
  const byId = new Map(existing.map((t) => [t.id, t]))
  const clean = tools.map((t) => sanitize(t, t.id ? byId.get(t.id) : undefined)).filter((t): t is CustomTool => !!t)
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } })
  const settings = (ws?.settings ?? {}) as Record<string, unknown>
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings: { ...settings, customTools: clean } as any } })
  return clean
}

/** Strip secrets for sending to the client (masked). */
export function maskCustomTool(t: CustomTool): CustomTool {
  return { ...t, secrets: Object.fromEntries(Object.keys(t.secrets).map((k) => [k, '****'])) }
}

// ─── Convert to a model-callable tool ─────────────────────────────────────────

export function toAnthropicTool(t: CustomTool): Anthropic.Tool {
  const properties: Record<string, any> = {}
  const required: string[] = []
  for (const p of t.params) {
    const schema: Record<string, any> = { type: p.type === 'enum' ? 'string' : p.type, description: p.description || undefined }
    if (p.type === 'enum' && p.enumValues?.length) schema.enum = p.enumValues
    properties[p.key] = schema
    if (p.required) required.push(p.key)
  }
  return {
    name: t.id,
    description: t.description,
    input_schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
  }
}

// ─── Execute (the HTTP request) ───────────────────────────────────────────────

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h === 'metadata' || h.endsWith('.internal')) return true
  if (isIP(h)) return isPrivateIp(h)
  return false
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a >= 224
}

/** SSRF guard: https-only, no private/internal hosts (DNS-resolved too).
 *  Exported so the lab reuses the SAME protection — even an owner-only tool must
 *  not let a prompt-injected agent reach postgres/minio on the docker network. */
export async function guardUrl(rawUrl: string): Promise<URL> {
  let u: URL
  try { u = new URL(rawUrl) } catch { throw new Error('Invalid URL') }
  if (u.protocol !== 'https:' && !(ALLOW_INTERNAL && u.protocol === 'http:')) throw new Error('Only https URLs are allowed')
  if (!ALLOW_INTERNAL) {
    if (isBlockedHost(u.hostname)) throw new Error('Target host is not allowed')
    if (!isIP(u.hostname)) {
      try {
        const addrs = await dns.lookup(u.hostname, { all: true })
        if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('Target resolves to a private address')
      } catch (e) { if (e instanceof Error && /private/.test(e.message)) throw e /* DNS failure → let fetch surface it */ }
    }
  }
  return u
}

const substitute = (tpl: string, input: Record<string, unknown>, secrets: Record<string, string>): string =>
  tpl
    .replace(/\{\{\s*secret\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, n) => secrets[n] ?? '')
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, n) => (input[n] != null ? String(input[n]) : ''))

export async function executeCustomTool(tool: CustomTool, input: Record<string, unknown>): Promise<unknown> {
  const secrets: Record<string, string> = {}
  for (const [k, v] of Object.entries(tool.secrets)) { secrets[k] = (() => { try { return decryptSecret(v) ?? v } catch { return v } })() }

  // URL + query
  const u = await guardUrl(substitute(tool.request.url, input, secrets))
  for (const q of tool.request.query ?? []) {
    const val = substitute(q.value, input, secrets)
    if (val !== '') u.searchParams.set(q.key, val)
  }
  await guardUrl(u.toString())

  // Headers
  const headers: Record<string, string> = {}
  for (const h of tool.request.headers) headers[h.key] = substitute(h.value, input, secrets)
  if (tool.auth.type === 'bearer' && tool.auth.secretName) headers['Authorization'] = `Bearer ${secrets[tool.auth.secretName] ?? ''}`
  if (tool.auth.type === 'header' && tool.auth.headerName && tool.auth.secretName) headers[tool.auth.headerName] = secrets[tool.auth.secretName] ?? ''
  if (tool.auth.type === 'basic' && tool.auth.secretName) headers['Authorization'] = `Basic ${secrets[tool.auth.secretName] ?? ''}`

  // Body
  let body: string | undefined
  if (tool.request.method !== 'GET' && tool.request.bodyType !== 'none' && tool.request.bodyTemplate) {
    body = substitute(tool.request.bodyTemplate, input, secrets)
    if (tool.request.bodyType === 'json' && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
    if (tool.request.bodyType === 'form' && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  let res: Response
  try {
    res = await fetch(u.toString(), { method: tool.request.method, headers, body, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
  } catch (e) {
    return { error: `Request failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const text = (await res.text()).slice(0, 256 * 1024)
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* keep text */ }

  // Response shaping (dot-path)
  if (tool.responseHint && typeof data === 'object' && data) {
    const picked = tool.responseHint.split('.').reduce<any>((acc, k) => (acc == null ? acc : acc[k]), data)
    if (picked !== undefined) data = picked
  }

  const out = JSON.stringify({ status: res.status, data })
  return out.length > 8000 ? { status: res.status, data: out.slice(0, 8000) + '…[truncated]' } : { status: res.status, data }
}

// ─── AI assembly ──────────────────────────────────────────────────────────────

export const SKILL_BUILDER_SYSTEM = `Ты — конструктор навыков (инструментов) для ИИ-ассистента. По описанию пользователя (и при наличии — по cURL или фрагменту документации API) ты проектируешь ОДИН вызываемый HTTP-инструмент и возвращаешь его СТРОГО как JSON по схеме ниже. Никакого текста вне JSON, без markdown-ограждений.

Главное: этот инструмент читает ДРУГАЯ модель, чтобы решить, когда и как его вызвать. Поэтому name, description и описания параметров — это «контракт для агента»: кратко, по делу, в повелительном тоне, на языке: {LANG}.

СХЕМА ВЫВОДА (только эти ключи):
{
  "name": "короткое человекочитаемое имя",
  "description": "1–2 предложения: КОГДА вызывать и ЧТО возвращает",
  "params": [{"key":"ascii","type":"string|number|boolean|enum","required":true,"description":"для агента","example":"пример","enumValues":["для enum"],"default":"опц."}],
  "request": {"method":"GET|POST|PUT|PATCH|DELETE","url":"https://... с {placeholder}","headers":[{"key":"X-Api-Key","value":"{{secret.api_key}}"}],"query":[{"key":"q","value":"{param}"}],"bodyType":"none|json|form","bodyTemplate":""},
  "auth": {"type":"none|bearer|header|basic","secretName":"api_key","headerName":"X-Api-Key"},
  "secretsNeeded": [{"name":"api_key","hint":"где взять"}],
  "responseHint": "dot-путь или \\"\\"",
  "notes": "что проверить",
  "confidence": "high|medium|low"
}

ПРАВИЛА:
1. Параметры — только значения, реально меняющиеся между вызовами. Постоянное — литералом. Не over-параметризуй.
2. Типы — самые узкие. Закрытый список значений → type:"enum" + enumValues.
3. required — только если API без этого не работает.
4. example — реалистичный для каждого параметра.
5. СЕКРЕТЫ НЕ ВЫДУМЫВАЙ. Нужен токен → auth.type + secretName + secretsNeeded с hint; в url/headers плейсхолдер {{secret.имя}}. Реальных ключей в выводе нет.
6. url — только https; изменяемое → {placeholder}.
7. Дан cURL → бери метод/url/заголовки/тело из него точно; продвинь динамику в параметры.
8. Эндпоинт неизвестен и не выводится → НЕ выдумывай. Лучший черновик, url пустой/с пометкой, confidence:"low", объясни в notes.
9. Описания — на {LANG}; идентификаторы (key, headerName) — латиницей.
10. Верни ТОЛЬКО валидный JSON по схеме. Без комментариев и ограждений.`

export function buildAssemblyUserMessage(p: { lang: string; description: string; curl?: string; docs?: string }): string {
  return [
    `Язык интерфейса: ${p.lang}`,
    `Описание от пользователя:\n${p.description}`,
    `cURL (если дал):\n${p.curl || '—'}`,
    `Документация / заметки (если дал):\n${p.docs || '—'}`,
  ].join('\n\n')
}

/** Parse the model's assembly output (tolerant of fences, reasoning, trailing commas). */
export function parseAssembled(text: string): Record<string, unknown> {
  let s = (text ?? '').trim()
  if (!s) throw new Error('Модель вернула пустой ответ. Проверьте, что в Настройках → ИИ подключён рабочий провайдер, и попробуйте ещё раз.')
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()       // strip reasoning blocks
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{'); const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Модель вернула не-JSON ответ: ' + s.slice(0, 200))
  s = s.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')    // drop trailing commas
  try {
    return JSON.parse(s)
  } catch {
    throw new Error('Не удалось разобрать ответ модели как JSON: ' + s.slice(0, 200))
  }
}

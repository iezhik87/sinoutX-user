import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { runWithApiKey } from './client.js'
import { registerWorkspaceTools } from './tools/workspace.tools.js'
import { registerPageTools } from './tools/page.tools.js'
import { registerTaskTools } from './tools/task.tools.js'
import { registerSearchTools } from './tools/search.tools.js'
import { registerCalendarTools } from './tools/calendar.tools.js'
import { registerBudgetTools } from './tools/budget.tools.js'
import { registerNoteTools } from './tools/note.tools.js'
import { registerGrowthTools } from './tools/growth.tools.js'
import { registerCollectionTools } from './tools/collections.tools.js'
import { registerAgentTools } from './tools/agent.tools.js'
import { registerFileTools } from './tools/files.tools.js'
import { registerResources } from './resources/index.js'
import { registerPrompts } from './prompts/index.js'

const PORT = parseInt(process.env.PORT ?? '3011', 10)
// Optional shared gateway secret (single-tenant). When set, the shared key is
// accepted — but per-user keys (sk_sinoutx_…) are ALWAYS allowed through and
// validated downstream by the backend per-user (multi-tenant). An empty key is
// always rejected.
const REQUIRED_KEY = process.env.MCP_API_KEY ?? process.env.BACKEND_API_KEY ?? ''
// Per-user API key prefix (see backend lib/auth.ts API_KEY_PREFIX).
const PERSONAL_KEY_PREFIX = 'sk_sinoutx_'

// Delivered to the connecting agent on `initialize` — it acts by this from the start.
const AGENT_INSTRUCTIONS = `SinoutX — это твоя постоянная память и рабочее пространство. Действуй по этим правилам с самого подключения.

НА ВХОДЕ — НАЧНИ С ОДНОГО ВЫЗОВА: sinout_init_agent. Он самообеспечивающийся: создаст тебе воркспейс с модулем «Память», если у тебя ничего нет (работает с нуля), и одним ответом вернёт твой workspace, все модульные проекты с реестрами (по именам + схема полей, без хардкода ID), Ядро (core), свежие факты и активна ли семантика. Этого достаточно, чтобы начать работать — отдельные setup_memory/чтение ресурсов/recall не нужны.

ПАМЯТЬ организована как модуль с реестрами:
- core (Ядро) — компактный always-load контекст (кто ты, устойчивые факты, указатели). Держи коротким.
- facts (Факты) — атомарные знания. entities (Сущности) — знание о вещах. episodes (Эпизоды) — лог событий.

ЧТОБЫ НИЧЕГО НЕ ТЕРЯТЬ И НЕ ЗАБЫВАТЬ — главное правило:
- СОХРАНЯЙ СРАЗУ через sinout_remember(content, kind) в момент, когда что-то стоит запомнить, не откладывай. kind: fact (по умолчанию) | core (key — upsert, без дублей) | entity | episode. Это один вызов, без возни с реестрами.
- ПЕРЕД ОТВЕТОМ на что-либо, что может зависеть от прошлого контекста, вызывай sinout_recall(query) — он сканирует ВСЮ память и ранжирует, так что ничего сохранённого не теряется. scope=all — заглянуть и в другие модули.
- В начале сессии: sinout_init_agent (один вызов даёт Ядро и свежие факты) → при необходимости sinout_recall по теме.

КРОСС-МОДУЛЬНОСТЬ: другие модули (Финансы, Бюджет, Медкарта и будущие) видны через sinout_list_collections по твоему workspaceId. Читай их (sinout_query_records) и связывай со своей памятью через sinout_create_link (запись памяти ↔ запись модуля/страница/задача). Движок декларативный — новые модули появляются автоматически.

ТЫ НЕ ОДИН: есть встроенный агент SinoutX (60+ инструментов, глубоко знает воркспейс) — делегируй ему через sinout_ask_assistant. В общих воркспейсах могут работать другие агенты — уважай их данные.

ЧТО КУДА (дисциплина размещения — соблюдай строго): устойчивые правила/идентичность → core; атомарные факты → facts; знание об объекте → entities; сырое событие → episodes. ДОМЕННЫЕ ДАННЫЕ (деньги/здоровье/привычки) — НЕ в память, а в профильный модуль через sinout_create_record. КРУПНАЯ ДОМЕННАЯ ТЕМА/база знаний (например, спортивная команда и её соревнования) — НЕ в память, а в ОТДЕЛЬНЫЙ ПРОЕКТ (sinout_create_project + страницы); в памяти оставь лишь ключевые факты + ССЫЛКУ (sinout_create_link) на проект, не копируй тело темы в память.

НИКОГДА не храни в памяти SinoutX свой собственный рантайм/окружение/идентичность (фреймворк, контейнер, пути вроде ~/.hermes, на каком сервере крутишься) — это твой конфиг, а не знание о пользователе. Память SinoutX — ТОЛЬКО про пользователя и мир. Не дублируй своё «я» в общую память: её читают и другие агенты.

ЧЕСТНОСТЬ ДЕЙСТВИЙ: не утверждай, что запомнил/сохранил/создал, если не вызвал соответствующий инструмент в этом ходе и не получил результат. Сначала вызов (sinout_remember/sinout_create_record/…), потом подтверждение. «Запомнил» без реального вызова — запрещено.

ДИСЦИПЛИНА: Ядро компактно; важное сохраняй немедленно; перед созданием ищи существующее (без дублей); перед ответом сверяйся с памятью.`

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'sinout', version: '1.0.0' }, { instructions: AGENT_INSTRUCTIONS })
  registerWorkspaceTools(server)
  registerPageTools(server)
  registerTaskTools(server)
  registerSearchTools(server)
  registerCalendarTools(server)
  registerBudgetTools(server)
  registerNoteTools(server)
  registerGrowthTools(server)
  registerCollectionTools(server)
  registerAgentTools(server)
  registerFileTools(server)
  registerResources(server)
  registerPrompts(server)
  return server
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : undefined) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// Active sessions: a StreamableHTTP transport (+ its connected server) is kept
// alive across requests so the post-initialize state survives. Keyed by the
// mcp-session-id the transport hands out at initialize.
const transports: Record<string, StreamableHTTPServerTransport> = {}

function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): string | null {
  const apiKey = (req.headers['x-api-key'] as string | undefined)?.trim()
  // Accept a per-user personal key (the backend then validates it against its
  // hashed store) or, if a shared gateway secret is configured, that exact key.
  // Fail CLOSED: an unset REQUIRED_KEY must NOT turn into "any non-empty key
  // passes" — only real personal keys or the configured secret get through.
  const allowed = !!apiKey && (
    apiKey.startsWith(PERSONAL_KEY_PREFIX) || (!!REQUIRED_KEY && apiKey === REQUIRED_KEY)
  )
  if (!allowed) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized: valid x-api-key required' }))
    return null
  }
  return apiKey!
}

const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (req.url !== '/mcp') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const apiKey = checkAuth(req, res)
  if (!apiKey) return

  const sessionId = req.headers['mcp-session-id'] as string | undefined

  try {
    // POST — JSON-RPC requests (initialize, tools/list, tools/call, …)
    if (req.method === 'POST') {
      const body = await readBody(req)
      let transport: StreamableHTTPServerTransport | undefined

      if (sessionId && transports[sessionId]) {
        // Existing session — reuse its transport (keeps initialized state).
        transport = transports[sessionId]
      } else if (!sessionId && isInitializeRequest(body)) {
        // New session — spin up a transport+server and remember it by session id.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport! },
        })
        transport.onclose = () => {
          if (transport!.sessionId) delete transports[transport!.sessionId]
        }
        const server = createMcpServer()
        await server.connect(transport)
      } else {
        // No session and not an initialize request — invalid.
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session: send initialize first' }, id: null }))
        return
      }

      // The per-user key rides on every request; scope tool execution to it.
      await runWithApiKey(apiKey, () => transport!.handleRequest(req, res, body))
      return
    }

    // GET — server→client SSE stream; DELETE — terminate session.
    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!sessionId || !transports[sessionId]) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid or missing mcp-session-id' }))
        return
      }
      await runWithApiKey(apiKey, () => transports[sessionId].handleRequest(req, res))
      return
    }

    res.writeHead(405)
    res.end('Method not allowed')
  } catch (err) {
    console.error('MCP error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }
})

httpServer.listen(PORT, () => {
  console.log(`MCP HTTP server listening on port ${PORT}`)
})

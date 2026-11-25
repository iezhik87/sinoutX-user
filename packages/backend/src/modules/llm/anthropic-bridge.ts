// ─── Anthropic behind an OpenAI-shaped door ───────────────────────────────────
// SinoutX Code speaks `chat/completions` and nothing else. When the admin puts an
// Anthropic model into the slot, the request is translated into Messages API and
// the stream back into chunks of `chat.completion.chunk` — the client must not be
// able to tell which provider answered.
import Anthropic from '@anthropic-ai/sdk'

/** One OpenAI message as clients send it. Content may be a string or parts. */
export interface OAIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content?: string | Array<Record<string, unknown>> | null
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments?: string } }>
  tool_call_id?: string
}

export interface OAITool {
  type?: string
  function: { name: string; description?: string; parameters?: Record<string, unknown> }
}

export interface OAIRequest {
  messages: OAIMessage[]
  tools?: OAITool[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  stop?: string | string[]
}

/** Usage in the shape the client expects at the end of the stream. */
export interface BridgeUsage {
  input: number          // fresh input + cache writes (the expensive kind)
  cacheRead: number
  output: number
}

/** What the bridge yields: a chunk to forward, or the final usage. */
export type BridgeEvent =
  | { kind: 'chunk'; chunk: Record<string, unknown> }
  | { kind: 'usage'; usage: BridgeUsage }

const DEFAULT_MAX_TOKENS = 16_000

function textOf(content: OAIMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** User content parts → Anthropic blocks. Images come as data URLs or links. */
function userBlocks(content: OAIMessage['content']): Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  const out: Anthropic.ContentBlockParam[] = []
  for (const p of content) {
    if (p.type === 'text' && typeof p.text === 'string' && p.text) {
      out.push({ type: 'text', text: p.text })
    } else if (p.type === 'image_url') {
      const url = typeof p.image_url === 'string' ? p.image_url : (p.image_url as { url?: string } | undefined)?.url
      if (!url) continue
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url)
      if (m) {
        out.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } })
      } else if (/^https?:\/\//.test(url)) {
        out.push({ type: 'image', source: { type: 'url', url } })
      }
    }
  }
  return out
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }
  } catch {
    // A truncated call the model produced earlier. Anthropic insists on an
    // object; keeping the raw text lets the model see what went wrong.
    return { _raw: raw }
  }
}

/**
 * OpenAI history → Anthropic `system` + `messages`.
 *
 * Anthropic wants tool results inside a USER turn, and alternating roles; OpenAI
 * sends one `tool` message per result. Consecutive results, and a user message
 * that follows them, are folded into one user turn.
 */
export function toAnthropicMessages(messages: OAIMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system: string[] = []
  const out: Anthropic.MessageParam[] = []

  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) {
      ;(last.content as Anthropic.ContentBlockParam[]).push(...blocks)
    } else {
      out.push({ role, content: blocks })
    }
  }

  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') {
      const t = textOf(m.content)
      if (t) system.push(t)
    } else if (m.role === 'user') {
      push('user', userBlocks(m.content))
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: textOf(m.content) || '(пусто)' }])
    } else if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = []
      const t = textOf(m.content)
      if (t.trim()) blocks.push({ type: 'text', text: t })
      for (const tc of m.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) })
      }
      push('assistant', blocks)
    }
  }

  // The conversation must open with the user.
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(начало разговора)' }] })
  return { system: system.join('\n\n'), messages: out }
}

function toolChoice(choice: unknown, parallel: boolean | undefined): Anthropic.ToolChoice | undefined {
  const noParallel = parallel === false ? { disable_parallel_tool_use: true } : {}
  if (choice === 'none') return { type: 'none' }
  if (choice === 'required') return { type: 'any', ...noParallel }
  if (choice && typeof choice === 'object') {
    const name = (choice as { function?: { name?: string } }).function?.name
    if (name) return { type: 'tool', name, ...noParallel }
  }
  return parallel === false ? { type: 'auto', disable_parallel_tool_use: true } : undefined
}

function finishReason(stop: string | null | undefined): string {
  switch (stop) {
    case 'tool_use': return 'tool_calls'
    case 'max_tokens': return 'length'
    case 'refusal': return 'content_filter'
    default: return 'stop'
  }
}

/**
 * Run the request on Anthropic and yield OpenAI chunks.
 *
 * Prompt caching is switched on here, not left to the client: an agent resends
 * the whole history on every step, and without a cache each step pays for all of
 * it again. Two breakpoints — after the system prompt (with the tools before it)
 * and on the last message — cover both the fixed part and the growing tail.
 */
export async function* streamAnthropicAsOpenAI(
  req: OAIRequest,
  opts: { apiKey: string; model: string; signal: AbortSignal; baseUrl?: string },
): AsyncGenerator<BridgeEvent> {
  const client = new Anthropic({ apiKey: opts.apiKey, ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}) })
  const { system, messages } = toAnthropicMessages(req.messages)

  const lastMsg = messages[messages.length - 1]
  const lastBlock = lastMsg ? (lastMsg.content as Anthropic.ContentBlockParam[])[(lastMsg.content as unknown[]).length - 1] : undefined
  if (lastBlock && (lastBlock.type === 'text' || lastBlock.type === 'tool_result')) {
    ;(lastBlock as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' }
  }

  const tools: Anthropic.Tool[] = (req.tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
  }))
  const choice = tools.length ? toolChoice(req.tool_choice, req.parallel_tool_calls) : undefined
  const stop = typeof req.stop === 'string' ? [req.stop] : req.stop

  const stream = await client.messages.create({
    model: opts.model,
    max_tokens: req.max_tokens ?? req.max_completion_tokens ?? DEFAULT_MAX_TOKENS,
    ...(system ? { system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] } : {}),
    messages,
    ...(tools.length ? { tools } : {}),
    ...(choice ? { tool_choice: choice } : {}),
    ...(req.temperature !== undefined ? { temperature: Math.min(1, Math.max(0, req.temperature)) } : {}),
    ...(stop?.length ? { stop_sequences: stop } : {}),
    stream: true,
  }, { signal: opts.signal })

  let id = 'chatcmpl-anthropic'
  const created = Math.floor(Date.now() / 1000)
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    kind: 'chunk' as const,
    chunk: { id, object: 'chat.completion.chunk', created, model: opts.model, choices: [{ index: 0, delta, finish_reason: finish }] },
  })

  // Anthropic numbers every content block; OpenAI numbers tool calls only.
  const toolIndex = new Map<number, number>()
  const usage: BridgeUsage = { input: 0, cacheRead: 0, output: 0 }
  let stopReason: string | null = null

  for await (const ev of stream) {
    if (ev.type === 'message_start') {
      id = `chatcmpl-${ev.message.id}`
      const u = ev.message.usage
      usage.input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      usage.cacheRead = u.cache_read_input_tokens ?? 0
      yield chunk({ role: 'assistant', content: '' })
    } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
      const n = toolIndex.size
      toolIndex.set(ev.index, n)
      yield chunk({ tool_calls: [{ index: n, id: ev.content_block.id, type: 'function', function: { name: ev.content_block.name, arguments: '' } }] })
    } else if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') {
        yield chunk({ content: ev.delta.text })
      } else if (ev.delta.type === 'input_json_delta') {
        const n = toolIndex.get(ev.index)
        if (n !== undefined && ev.delta.partial_json) {
          yield chunk({ tool_calls: [{ index: n, function: { arguments: ev.delta.partial_json } }] })
        }
      }
    } else if (ev.type === 'message_delta') {
      stopReason = ev.delta.stop_reason ?? stopReason
      usage.output = ev.usage.output_tokens ?? usage.output
    }
  }

  yield chunk({}, finishReason(stopReason))
  yield { kind: 'usage', usage }
}

/** The usage chunk OpenAI sends last when `stream_options.include_usage` is set. */
export function usageChunk(u: BridgeUsage, model: string): Record<string, unknown> {
  const prompt = u.input + u.cacheRead
  return {
    id: 'chatcmpl-usage', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: u.output,
      total_tokens: prompt + u.output,
      prompt_tokens_details: { cached_tokens: u.cacheRead },
    },
  }
}

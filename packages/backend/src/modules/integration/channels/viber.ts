import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ChannelAdapter, ChannelButton, IncomingFile } from './types.js'

const API = 'https://chatapi.viber.com/pa'

// ─── Viber REST Bot API helper ────────────────────────────────────────────────
// Every call is POST + X-Viber-Auth-Token; success is `status: 0` in the body,
// NOT the HTTP code — a rejected send still returns 200.
export async function viberApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ status?: number; status_message?: string; message_token?: number } | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return (await res.json().catch(() => null)) as { status?: number; status_message?: string; message_token?: number } | null
  } catch { return null }
}

const ok = (r: { status?: number } | null) => !!r && r.status === 0

/**
 * Viber webhook signature: HMAC-SHA256 of the raw body, keyed with the auth
 * token, hex-encoded in `X-Viber-Content-Signature`. Compared in constant time.
 */
export function verifyViberSignature(token: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', token).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Viber has no markup at all — flatten the model's markdown to plain text. */
export function formatForViber(text: string): string {
  const blocks: string[] = []
  let t = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(code.replace(/\n$/, ''))
    return ` B${blocks.length - 1} `
  })

  t = t.split('\n')
    .filter((ln) => !/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(ln))
    .map((ln) => {
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        const cells = ln.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean)
        return cells.join(' — ')
      }
      return ln.replace(/^(#{1,6})\s*(.+)$/, '$2').replace(/^\s*[-*+]\s+/, '• ')
    })
    .join('\n')

  t = t
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')

  t = t.replace(/ B(\d+) /g, (_m, i: string) => blocks[+i] ?? '')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

// A tapped button sends its ActionBody back as a plain `message` event, so the
// callback payload rides in ActionBody exactly like Telegram's callback_data.
const keyboard = (buttons?: ChannelButton[]) =>
  buttons?.length
    ? {
        keyboard: {
          Type: 'keyboard',
          DefaultHeight: false,
          Buttons: buttons.map((b) => ({
            Columns: Math.max(2, Math.floor(6 / buttons.length)),
            Rows: 1,
            ActionType: 'reply',
            ActionBody: b.data,
            Text: b.text,
            TextSize: 'regular',
          })),
        },
      }
    : {}

/**
 * Viber: can talk to a subscriber at any time (so proactive briefs work), but
 * the public bot API has no message editing, no deletion and no typing
 * indicator. The flags say so, and callers degrade instead of silently failing.
 */
export function viberAdapter(token: string, receiverId: string, senderName = 'SinoutX'): ChannelAdapter {
  return {
    id: 'viber',
    chatKey: receiverId,
    canType: false,
    canEdit: false,
    canDelete: false,
    canUploadFile: false, // files must be served from a public URL

    format: formatForViber,
    plain: formatForViber,

    async typing() { /* no such API */ },

    async send(text, buttons) {
      const r = await viberApi(token, 'send_message', {
        receiver: receiverId,
        min_api_version: 3,
        sender: { name: senderName },
        type: 'text',
        text: text.slice(0, 7000),
        ...keyboard(buttons),
      })
      if (!ok(r)) return undefined
      // Viber returns a message_token, not an id we could edit or delete later.
      return r?.message_token?.toString()
    },

    // Viber шлёт картинки по одной — альбомов у него нет. Тип picture требует
    // публичного адреса, скачать за нас он не умеет, поэтому недоставленное
    // возвращаем ссылками.
    async sendPhotos(urls, caption) {
      const failed: string[] = []
      for (let i = 0; i < urls.length; i++) {
        const r = await viberApi(token, 'send_message', {
          receiver: receiverId,
          min_api_version: 3,
          sender: { name: senderName },
          type: 'picture',
          media: urls[i],
          text: i === 0 && caption ? caption.slice(0, 120) : '',
        })
        if (!ok(r)) failed.push(urls[i])
      }
      return failed
    },

    async edit() { return false },
    async delete() { return false },

    async downloadFile(url, hint): Promise<IncomingFile | null> {
      // Incoming media arrives as a URL with a 1-hour TTL — fetch it right away.
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) return null
        const name = hint?.filename || url.split('?')[0].split('/').pop() || 'file'
        return { buffer: Buffer.from(await res.arrayBuffer()), filename: name, mime: hint?.mime }
      } catch { return null }
    },
  }
}

/** Register the public webhook. Viber verifies it with a test request at once. */
export async function setViberWebhook(token: string, url: string) {
  return viberApi(token, 'set_webhook', {
    url,
    event_types: ['message', 'subscribed', 'unsubscribed', 'conversation_started'],
    send_name: true,
    send_photo: false,
  })
}

export async function getViberAccountInfo(token: string) {
  return viberApi(token, 'get_account_info', {})
}

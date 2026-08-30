import type { ChannelAdapter, ChannelButton, IncomingFile } from './types.js'

// ─── Telegram API helper ──────────────────────────────────────────────────────
export async function tgApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok?: boolean; result?: { message_id?: number } } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number } } | null
  } catch { return null }
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Convert the markdown the model emits into Telegram-safe HTML (bold/italic/code/
// links), turning tables/headers into readable lines. Telegram has no tables or
// headers, so those are flattened. Send with parse_mode: 'HTML' (+ a plain-text
// fallback if Telegram ever rejects the markup).
export function formatForTelegram(text: string): string {
  // 1) Protect fenced code blocks (escape content, stash as placeholders).
  const blocks: string[] = []
  let t = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre>${escHtml(code.replace(/\n$/, ''))}</pre>`)
    return ` B${blocks.length - 1} `
  })

  // 2) Line-level: drop table separators, flatten table rows, headers → bold, bullets → •.
  t = t.split('\n')
    .filter((ln) => !/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(ln))
    .map((ln) => {
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        const cells = ln.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean)
        return cells.join(' — ')
      }
      return ln.replace(/^(#{1,6})\s*(.+)$/, '**$2**').replace(/^\s*[-*+]\s+/, '• ')
    })
    .join('\n')

  // 3) Escape HTML in the body (placeholders contain no <>, so they survive).
  t = escHtml(t)

  // 4) Inline: code first (protect it), then links, bold, italic.
  const code: string[] = []
  t = t.replace(/`([^`\n]+)`/g, (_m, c: string) => { code.push(`<code>${c}</code>`); return ` C${code.length - 1} ` })
  t = t
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt: string, url: string) => `<a href="${url.replace(/"/g, '%22')}">${txt}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[^*<])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')

  // 5) Restore placeholders.
  t = t.replace(/ C(\d+) /g, (_m, i: string) => code[+i] ?? '')
    .replace(/ B(\d+) /g, (_m, i: string) => blocks[+i] ?? '')

  return t.replace(/\n{3,}/g, '\n\n').trim()
}

// Strip Telegram HTML tags for the plain-text fallback.
export const stripTgHtml = (s: string) => s.replace(/<\/?(b|i|u|s|code|pre|a)(\s[^>]*)?>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const keyboard = (buttons?: ChannelButton[]) =>
  buttons?.length
    ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } }
    : {}

/** Telegram: everything the agent wants — edit, delete, typing, file upload. */
export function telegramAdapter(botToken: string, chatId: number): ChannelAdapter {
  const send = async (text: string, buttons?: ChannelButton[]) => {
    const km = keyboard(buttons)
    const html = await tgApi(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...km })
    if (html && html.ok !== false) return html.result?.message_id?.toString()
    // Telegram rejected the markup (or the message was too long) — retry plain.
    const plain = await tgApi(botToken, 'sendMessage', { chat_id: chatId, text: stripTgHtml(text), ...km })
    return plain?.result?.message_id?.toString()
  }

  return {
    id: 'telegram',
    chatKey: String(chatId),
    canType: true,
    canEdit: true,
    canDelete: true,
    canUploadFile: true,

    format: formatForTelegram,
    plain: stripTgHtml,

    async typing() { await tgApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' }) },

    send,

    // Одиночное фото — sendPhoto, несколько — альбомом по 10 (предел Telegram).
    // Telegram сам скачивает картинку по адресу, поэтому чужой хост может
    // отказать: такие адреса возвращаем, чтобы показать их ссылкой.
    async sendPhotos(urls, caption) {
      const failed: string[] = []
      if (urls.length === 1) {
        const r = await tgApi(botToken, 'sendPhoto', {
          chat_id: chatId, photo: urls[0],
          ...(caption ? { caption: caption.slice(0, 1024) } : {}),
        })
        if (!r || r.ok === false) failed.push(urls[0])
        return failed
      }
      for (let i = 0; i < urls.length; i += 10) {
        const batch = urls.slice(i, i + 10)
        const r = await tgApi(botToken, 'sendMediaGroup', {
          chat_id: chatId,
          media: batch.map((u, k) => ({
            type: 'photo', media: u,
            ...(k === 0 && i === 0 && caption ? { caption: caption.slice(0, 1024) } : {}),
          })),
        })
        if (!r || r.ok === false) failed.push(...batch)
      }
      return failed
    },

    // Файл уходит multipart-ом: Telegram принимает байты напрямую, качать
    // ему ничего не надо.
    async sendDocument(file, caption) {
      try {
        const form = new FormData()
        form.append('chat_id', String(chatId))
        form.append('document', new Blob([file.buffer as unknown as ArrayBuffer], { type: file.mime }), file.filename)
        if (caption) form.append('caption', caption.slice(0, 1024))
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(60_000),
        })
        return res.ok
      } catch { return false }
    },

    async edit(messageId, text, buttons) {
      const km = keyboard(buttons)
      const e = await tgApi(botToken, 'editMessageText', { chat_id: chatId, message_id: Number(messageId), text, parse_mode: 'HTML', disable_web_page_preview: true, ...km })
      if (e && e.ok !== false) return true
      const e2 = await tgApi(botToken, 'editMessageText', { chat_id: chatId, message_id: Number(messageId), text: stripTgHtml(text), ...km })
      return !!e2 && e2.ok !== false
    },

    async delete(messageId) {
      const r = await tgApi(botToken, 'deleteMessage', { chat_id: chatId, message_id: Number(messageId) })
      return !!r && r.ok !== false
    },

    async downloadFile(fileId): Promise<IncomingFile | null> {
      try {
        const meta = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, { signal: AbortSignal.timeout(15_000) })
        const j = (await meta.json()) as { ok?: boolean; result?: { file_path?: string } }
        const fp = j?.result?.file_path
        if (!fp) return null
        const bin = await fetch(`https://api.telegram.org/file/bot${botToken}/${fp}`, { signal: AbortSignal.timeout(60_000) })
        if (!bin.ok) return null
        return { buffer: Buffer.from(await bin.arrayBuffer()), filename: fp.split('/').pop() || 'file' }
      } catch { return null }
    },
  }
}

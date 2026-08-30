// ─── ChannelAdapter ───────────────────────────────────────────────────────────
// The AI agent, OCR routing and the proactive cron are channel-agnostic. Only
// the transport differs, and channels differ in what they *cannot* do — Viber
// has no message editing, no deletion and no typing indicator. Those gaps are
// declared here as capability flags rather than discovered at runtime, so the
// caller can degrade deliberately (skip the live progress line) or refuse
// outright (never hand a Vault secret to a channel that cannot delete it).

export type ChannelId = 'telegram' | 'viber'

/** A tappable button under a bot message. `data` is what comes back on tap. */
export interface ChannelButton {
  text: string
  data: string
}

export interface IncomingFile {
  buffer: Buffer
  filename: string
  mime?: string
}

export interface ChannelAdapter {
  readonly id: ChannelId
  /** Stable conversation key (Telegram chat_id / Viber user id). Scopes the
   *  Redis history so a scheduled skill continues the user's own thread. */
  readonly chatKey: string

  /** Live "typing…" indicator. Viber has none. */
  readonly canType: boolean
  /** Edit an already-sent message — needed for the live progress line. */
  readonly canEdit: boolean
  /** Delete an already-sent message — required to hand out Vault secrets. */
  readonly canDelete: boolean
  /** Upload a file from bytes. Viber only accepts a public URL. */
  readonly canUploadFile: boolean

  /** Render the model's markdown into whatever markup the channel understands. */
  format(text: string): string
  /** Strip all markup — the fallback when the channel rejects formatted text. */
  plain(text: string): string

  typing(): Promise<void>
  /** Returns the sent message id, or undefined when the channel hides it. */
  send(text: string, buttons?: ChannelButton[]): Promise<string | undefined>
  edit(messageId: string, text: string, buttons?: ChannelButton[]): Promise<boolean>
  delete(messageId: string): Promise<boolean>

  /**
   * Отправить изображения по адресам. Возвращает те, что доставить НЕ удалось,
   * — их вызывающий покажет ссылками, чтобы человек не остался ни с чем.
   */
  sendPhotos(urls: string[], caption?: string): Promise<string[]>

  /**
   * Отправить файл байтами. Viber так не умеет — ему нужен публичный адрес,
   * которого у нас нет, поэтому у него это всегда false (см. canUploadFile).
   */
  sendDocument(file: { buffer: Buffer; filename: string; mime: string }, caption?: string): Promise<boolean>

  /** `ref` is a Telegram file_id or a Viber media URL. */
  downloadFile(ref: string, hint?: { filename?: string; mime?: string }): Promise<IncomingFile | null>
}

/** What the agent is allowed to do on this channel. Sent into ChatContext. */
export interface ChannelCaps {
  id: ChannelId
  /** Vault reveal is gated on this: a secret we cannot delete must never be sent. */
  canDelete: boolean
}

export const capsOf = (a: ChannelAdapter): ChannelCaps => ({ id: a.id, canDelete: a.canDelete })

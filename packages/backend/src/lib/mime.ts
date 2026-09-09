// ─── Тип файла, когда отправитель его не сообщил ─────────────────────────────
//
// Мессенджеры этим грешат постоянно: Telegram присылает документ то с
// `mime_type`, то без него, Viber не сообщает тип вообще — там его приходится
// угадывать по расширению. Раньше в таком случае ставился
// `application/octet-stream`, и дальше по цепочке файл считался двоичным.
//
// Чем это кончалось на практике: человек прислал в чат `corner-wardrobe.html`,
// ассистент сохранил его и отказался читать — «формат не поддерживается», — хотя
// расширение стояло прямо в имени файла. Совет, который он выдал («переименуйте
// в .txt»), лечил симптом и перекладывал работу на человека.
//
// Правило простое: объявленному типу верим, но только если он что-то значит.
// `application/octet-stream` — это не тип, это «я не знаю»; в таком случае имя
// файла знает больше.

/** Расширение → тип. Только то, что мы действительно умеем обрабатывать дальше. */
export const MIME_BY_EXT: Record<string, string> = {
  // текст и разметка
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  csv: 'text/csv',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  // исходники — читаются как текст
  ts: 'text/plain', tsx: 'text/plain', js: 'text/plain', jsx: 'text/plain',
  py: 'text/plain', sh: 'text/plain', sql: 'text/plain', css: 'text/plain',
  // документы
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // изображения — их читает vision-модель
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  // звук и видео
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
}

export const extensionOf = (filename: string): string =>
  (filename.split('.').pop() ?? '').toLowerCase()

/** Тип по имени файла, или undefined — расширения нет либо оно нам незнакомо. */
export const mimeFromFilename = (filename: string): string | undefined =>
  MIME_BY_EXT[extensionOf(filename)]

/**
 * «Тип» без содержания: отправитель не знал, что шлёт. Такому значению верить
 * нельзя — оно перекрывает то, что видно из имени файла.
 */
export const isGenericMime = (mime: string | undefined | null): boolean =>
  !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream'

/**
 * Что записать в хранилище. Объявленный тип побеждает — кроме случая, когда он
 * ничего не значит, и тогда решает имя файла.
 */
export function resolveMime(declared: string | undefined | null, filename: string): string {
  if (!isGenericMime(declared)) return declared as string
  return mimeFromFilename(filename) ?? 'application/octet-stream'
}

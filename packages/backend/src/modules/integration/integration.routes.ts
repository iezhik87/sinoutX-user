import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomBytes, randomUUID } from 'crypto'
import { IntegrationService } from './integration.service.js'
import { denyIfNotMember } from '../../lib/requireAccess.js'
import { isSafeWebhookUrl } from '../../lib/webhook.js'
import { config } from '../../config/index.js'
import { uploadFile } from '../../lib/storage.js'
import { redis } from '../../lib/redis.js'
import { getAISettings, streamChat, type ChatContext, type ChatMessage } from '../ai/ai.service.js'
import { getManifest } from '../../lib/modules/service.js'
import { runMedicalScan, runReceiptScan } from '../../lib/modules/pipelines.js'
import { checkPipelineAccess, incrementPipelineUsage, canUploadFile } from '../../lib/plans.js'
import { maybeWarnStorage } from '../../lib/storageAlert.js'
import { type OcrConfig } from '../../lib/modules/vision.js'
import { decryptSecret } from '../../lib/crypto.js'
import { toStorableImage } from '../../lib/images.js'
import { managedVisionFor, workspaceOwnerId } from '../../lib/managedAccess.js'
import { tgApi, telegramAdapter, formatForTelegram } from './channels/telegram.js'
import { viberAdapter, viberApi, verifyViberSignature, setViberWebhook, getViberAccountInfo } from './channels/viber.js'
import { capsOf, type ChannelAdapter, type ChannelButton } from './channels/types.js'

type TgLang = 'ru' | 'en' | 'be'
// Localized bot replies for media capture and the /new command.
const MEDIA_TXT: Record<TgLang, {
  dlVoiceFail: string; noWhisper: string; transcribeFail: string; emptyTranscript: string
  dlFileFail: string; savedSource: string; imageToAgent: string; newDialog: string; noSpace: (used: number, limit: number) => string; ocrDone: string; ocrFail: string; ocrStudy: string; ocrVisit: string; ocrDoc: string; ocrPremium: string; dxSuffix: string; medSuffix: string; ocrReceipt: string; ocrStatement: string; txSuffix: string
  viberWelcome: string
}> = {
  ru: {
    dlVoiceFail: 'Не смог скачать голосовое.',
    noWhisper: 'Для расшифровки голосовых нужен локальный whisper-сервис или ключ OpenAI (Настройки → AI Ассистент).',
    transcribeFail: 'Не удалось расшифровать голосовое.',
    emptyTranscript: 'Пустая расшифровка.',
    dlFileFail: 'Не смог скачать файл.',
    savedSource: '📎 Сохранено в источники проекта.',
    imageToAgent: 'Посмотри это изображение.',
    noSpace: (u, l) => `💾 Место закончилось: ${u} из ${l} МБ. Купите пакет в Настройки → Тариф или удалите ненужные файлы — тогда пришлите ещё раз.`,
    newDialog: '🆕 Начат новый диалог. Контекст очищен.',
    ocrDone: '🩺 Распознал анализ и добавил в Медкарту. Показателей: ',
    ocrFail: '⚠️ Не удалось распознать: ',
    ocrStudy: '🩻 Распознал исследование и добавил в Медкарту (Исследования + Документы).',
    ocrVisit: '🩺 Распознал приём и добавил в Медкарту (Приёмы).',
    ocrDoc: '📄 Документ сохранён в Медкарту.',
    ocrPremium: '🔒 Лимит бесплатных распознаваний исчерпан на этом тарифе.',
    dxSuffix: ' · диагнозов: ', medSuffix: ' · лекарств: ',
    ocrReceipt: '🧾 Чек распознан и добавлен в Финансы.', ocrStatement: '🧾 Выписка импортирована в Финансы.', txSuffix: ' · операций: ',
    viberWelcome: 'Привет! Я ассистент SinoutX. Пиши текстом, шли фото чека или анализа — разложу по местам. Секреты из Сейфа в Viber не выдаю: здесь нельзя удалить сообщение.',
  },
  en: {
    dlVoiceFail: 'Could not download the voice message.',
    noWhisper: 'Voice transcription needs a local whisper service or an OpenAI key (Settings → AI Assistant).',
    transcribeFail: 'Could not transcribe the voice message.',
    emptyTranscript: 'Empty transcript.',
    dlFileFail: 'Could not download the file.',
    savedSource: '📎 Saved to the project sources.',
    imageToAgent: 'Take a look at this image.',
    noSpace: (u, l) => `💾 Out of space: ${u} of ${l} MB. Buy a pack in Settings → Plan or delete something, then send it again.`,
    newDialog: '🆕 New conversation started. Context cleared.',
    ocrDone: '🩺 Recognized the lab result and added it to Medical Record. Indicators: ',
    ocrFail: '⚠️ Could not recognize: ',
    ocrStudy: '🩻 Recognized the study and added it to Medical Record (Studies + Documents).',
    ocrVisit: '🩺 Recognized the visit and added it to Medical Record (Visits).',
    ocrDoc: '📄 Document saved to Medical Record.',
    ocrPremium: '🔒 Free document-recognition trials are used up on this plan.',
    dxSuffix: ' · diagnoses: ', medSuffix: ' · meds: ',
    ocrReceipt: '🧾 Receipt recognized and added to Finance.', ocrStatement: '🧾 Statement imported into Finance.', txSuffix: ' · transactions: ',
    viberWelcome: 'Hi! I am the SinoutX assistant. Write to me, send a photo of a receipt or a lab result — I will file it. I do not hand out Vault secrets on Viber: messages here cannot be deleted.',
  },
  be: {
    dlVoiceFail: 'Не змог спампаваць галасавое.',
    noWhisper: 'Для распазнавання галасавых патрэбны лакальны whisper-сэрвіс або ключ OpenAI (Налады → AI Асістэнт).',
    transcribeFail: 'Не ўдалося распазнаць галасавое.',
    emptyTranscript: 'Пусты тэкст.',
    dlFileFail: 'Не змог спампаваць файл.',
    savedSource: '📎 Захавана ў крыніцы праекта.',
    imageToAgent: 'Паглядзі гэтую выяву.',
    noSpace: (u, l) => `💾 Месца скончылася: ${u} з ${l} МБ. Купіце пакет у Налады → Тарыф або выдаліце файлы і дашліце зноў.`,
    newDialog: '🆕 Пачаты новы дыялог. Кантэкст ачышчаны.',
    ocrDone: '🩺 Распазнаў аналіз і дадаў у Медкарту. Паказчыкаў: ',
    ocrFail: '⚠️ Не ўдалося распазнаць: ',
    ocrStudy: '🩻 Распазнаў даследаванне і дадаў у Медкарту (Даследаванні + Дакументы).',
    ocrVisit: '🩺 Распазнаў прыём і дадаў у Медкарту (Прыёмы).',
    ocrDoc: '📄 Дакумент захаваны ў Медкарту.',
    ocrPremium: '🔒 Ліміт бясплатных распазнаванняў вычарпаны на гэтым тарыфе.',
    dxSuffix: ' · дыягназаў: ', medSuffix: ' · лекаў: ',
    ocrReceipt: '🧾 Чэк распазнаны і дададзены ў Фінансы.', ocrStatement: '🧾 Выпіска імпартавана ў Фінансы.', txSuffix: ' · аперацый: ',
    viberWelcome: 'Прывітанне! Я асістэнт SinoutX. Пішы тэкстам, дасылай фота чэка ці аналізу — раскладу па месцах. Сакрэты з Сейфа ў Viber не выдаю: тут нельга выдаліць паведамленне.',
  },
}

// Find-or-create the Telegram agent's "home" project for a workspace. Its id is
// cached in the integration config so it's created only once. Notes/tasks/events
// without an explicit project land here.
async function ensureAgentProject(
  prisma: PrismaClient,
  workspaceId: string,
  integrationId: string,
  cfg: Record<string, unknown>,
): Promise<string> {
  const existing = cfg.agentProjectId as string | undefined
  if (existing) {
    const p = await prisma.project.findFirst({ where: { id: existing, workspaceId }, select: { id: true, isSystem: true } })
    if (p) {
      // Backfill the system flag for assistant projects created before it existed.
      if (!p.isSystem) await prisma.project.update({ where: { id: p.id }, data: { isSystem: true } }).catch(() => null)
      return p.id
    }
  }
  const lastPos = await prisma.project.findFirst({
    where: { workspaceId }, orderBy: { position: 'desc' }, select: { position: true },
  })
  const proj = await prisma.project.create({
    data: {
      workspaceId,
      name: 'Ассистент',
      description: 'Личный проект Telegram-ассистента: заметки, задачи и события без явного проекта попадают сюда.',
      icon: 'lucide:Bot',
      isSystem: true,
      position: (lastPos?.position ?? -1) + 1,
    },
  })
  cfg.agentProjectId = proj.id
  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: { ...cfg } as object },
  }).catch(() => null)
  return proj.id
}

// NB: the assistant's identity (name + character) is configured once in
// Settings → AI ("Личность ассистента") and applied on every channel by
// streamChat — Telegram no longer carries its own persona.

// Telegram is sent as plain text (no markdown render). Strip/convert the markdown
// the model tends to emit so tables/headers/bold don't show up as raw symbols.
// Live "what the bot is doing now" labels, keyed by tool name (from streamChat's
// tool_start events). Shown on the placeholder while the agent works.
const STEP_LABELS: Record<string, { ru: string; en: string; be: string }> = {
  list_tasks:         { ru: '🔍 Смотрю задачи',       en: '🔍 Checking tasks',      be: '🔍 Гляджу задачы' },
  create_task:        { ru: '✍️ Создаю задачу',       en: '✍️ Creating a task',     be: '✍️ Ствараю задачу' },
  create_tasks_batch: { ru: '✍️ Создаю задачи',       en: '✍️ Creating tasks',      be: '✍️ Ствараю задачы' },
  update_task:        { ru: '✏️ Обновляю задачу',     en: '✏️ Updating a task',     be: '✏️ Абнаўляю задачу' },
  delete_item:        { ru: '🗑 Удаляю',              en: '🗑 Deleting',            be: '🗑 Выдаляю' },
  list_collections:   { ru: '🔍 Смотрю реестры',      en: '🔍 Checking data',       be: '🔍 Гляджу рэестры' },
  query_records:      { ru: '🔍 Читаю реестр',        en: '🔍 Reading data',        be: '🔍 Чытаю рэестр' },
  create_record:      { ru: '✍️ Записываю в реестр',  en: '✍️ Saving a record',     be: '✍️ Запісваю' },
  update_record:      { ru: '✏️ Обновляю запись',     en: '✏️ Updating a record',   be: '✏️ Абнаўляю запіс' },
  finance_overview:   { ru: '📊 Считаю баланс',       en: '📊 Computing balances',  be: '📊 Лічу баланс' },
  recall:             { ru: '🧠 Вспоминаю',           en: '🧠 Recalling',           be: '🧠 Прыгадваю' },
  remember:           { ru: '🧠 Запоминаю',           en: '🧠 Remembering',         be: '🧠 Запамінаю' },
  create_page:        { ru: '📄 Пишу страницу',       en: '📄 Writing a page',      be: '📄 Пішу старонку' },
  update_page:        { ru: '📄 Обновляю страницу',   en: '📄 Updating a page',     be: '📄 Абнаўляю старонку' },
  create_project:     { ru: '📁 Создаю проект',       en: '📁 Creating a project',  be: '📁 Ствараю праект' },
  create_event:       { ru: '📅 Создаю событие',      en: '📅 Creating an event',   be: '📅 Ствараю падзею' },
  create_note:        { ru: '📝 Пишу заметку',        en: '📝 Writing a note',      be: '📝 Пішу нататку' },
  execute_code:       { ru: '🧮 Считаю кодом',        en: '🧮 Running code',        be: '🧮 Лічу кодам' },
  export_project:     { ru: '📦 Готовлю файл',        en: '📦 Preparing a file',    be: '📦 Рыхтую файл' },
  get_secret:         { ru: '🔐 Достаю из сейфа',     en: '🔐 Opening the vault',   be: '🔐 Дастаю з сейфа' },
}
function stepLabel(tool: string, lang: 'ru' | 'en' | 'be'): string {
  const l = STEP_LABELS[tool]
  if (l) return l[lang]
  if (/search|web/i.test(tool)) return { ru: '🌐 Ищу в интернете', en: '🌐 Searching the web', be: '🌐 Шукаю ў інтэрнэце' }[lang]
  if (/skill/i.test(tool)) return { ru: '⚙️ Настраиваю скилы', en: '⚙️ Setting up skills', be: '⚙️ Наладжваю скілы' }[lang]
  return { ru: '⏳ Работаю', en: '⏳ Working', be: '⏳ Працую' }[lang]
}

/** Viber sends the user's app language ("en", "ru-RU", "be"). */
const viberLang = (raw: string | undefined): TgLang => {
  const l = raw?.toLowerCase()
  return l?.startsWith('be') ? 'be' : l?.startsWith('en') ? 'en' : 'ru'
}

/** Menu commands the user can type in any channel → explicit agent prompts. */
const CMD: Record<string, string> = {
  '/tasks': 'Покажи все мои задачи списком (list_tasks без projectId): название, статус, срок, проект.',
  '/balance': 'Покажи баланс всех моих счетов и карт (finance_overview) + доход/расход за месяц.',
  '/today': 'Что у меня на сегодня: задачи со сроком сегодня и просроченные + события сегодня. Коротко.',
  // Telegram intercepts /help earlier (static reply + the "/" menu); Viber has neither.
  '/help': 'Коротко расскажи, что ты умеешь: заметки и задачи, события, финансы, распознавание фото и PDF, напоминания. Перечисли команды /tasks, /today, /balance, /new. Без воды.',
}

/** Resolve a typed command to its prompt; plain text passes through unchanged. */
const commandPrompt = (text: string) => CMD[text.split(/[\s@]/)[0].toLowerCase()] ?? text

/** Redis key of a chat's short history. The only place this shape is spelled out:
 *  `/new` must clear exactly what the agent writes. */
export const agentHistKey = (channel: string, workspaceId: string, chatKey: string) =>
  `${channel}:agent:${workspaceId}:${chatKey}`

// ─── Channel AI agent ─────────────────────────────────────────────────────────
// Runs the full tool-calling agent (provider-agnostic via streamChat) for a free
// text message, keeping a short per-chat history in Redis. Designed to run in the
// background: the webhook returns 200 immediately, results are pushed back through
// the adapter.
//
// Channels differ in what they can do, and the agent degrades rather than fails:
//   • no typing indicator / no editing (Viber) → no live "thinking…" placeholder
//   • no deletion (Viber)                      → get_secret is stripped from the
//     toolset upstream, so a Vault secret can never reach a chat we cannot clean.
// Telegram/Viber не принимают сообщение длиннее ~4096 символов. Раньше мы просто
// резали ответ на 3900 и ТЕРЯЛИ хвост — пользователь видел обрыв на полуслове и
// был вынужден просить «продолжи» (а модель до-генерировала заново). Режем ДО
// форматирования (чтобы не разорвать HTML-тег) по границам абзацев/строк.
function splitForChannel(text: string, limit = 3500): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let buf = ''
  const push = () => { if (buf.trim()) chunks.push(buf); buf = '' }
  for (const para of text.split('\n\n')) {
    if (para.length > limit) {
      push()
      let rest = para
      while (rest.length > limit) {
        let cut = rest.lastIndexOf('\n', limit)
        if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit)
        if (cut < limit * 0.5) cut = limit
        chunks.push(rest.slice(0, cut))
        rest = rest.slice(cut).replace(/^[\n ]+/, '')
      }
      buf = rest
      continue
    }
    if (buf && (buf.length + 2 + para.length) > limit) push()
    buf = buf ? `${buf}\n\n${para}` : para
  }
  push()
  return chunks.length ? chunks : [text.slice(0, limit)]
}

export async function runChannelAgent(
  prisma: PrismaClient,
  adapter: ChannelAdapter,
  workspaceId: string,
  chatKey: string,               // stable per-conversation id (tg chat_id / viber user id)
  userId: string | undefined,
  defaultProjectId: string | undefined,
  text: string,
  userLanguage: 'ru' | 'en' | 'be',
  persist = true, // persist this exchange as an AiConversation (false for skill runs)
  telegram?: { botToken: string; chatId: number }, // lets file-producing tools upload
): Promise<void> {
  const L = {
    thinking: { ru: '⏳ Думаю…', en: '⏳ Thinking…', be: '⏳ Думаю…' }[userLanguage],
    empty: { ru: '🤔 Пустой ответ — попробуй переформулировать.', en: '🤔 Empty response — try rephrasing.', be: '🤔 Пусты адказ — паспрабуй перафармуляваць.' }[userLanguage],
  }

  // The live placeholder needs BOTH a typing indicator and message editing.
  // Without them (Viber) we stay silent until the answer is ready — a stream of
  // un-deletable "thinking" messages would be worse than nothing.
  // Automated runs (scheduled skills, persist=false) skip the placeholder entirely:
  // a scheduled brief shouldn't post "⏳ Думаю…" first, and on a SKIP day it must be
  // able to send nothing at all without leaving a stray placeholder behind.
  const live = adapter.canType && adapter.canEdit && persist
  let currentStep = L.thinking
  let phId: string | undefined
  let busy: NodeJS.Timeout | undefined
  if (live) {
    await adapter.typing()
    phId = await adapter.send(L.thinking)
    let dots = 0
    busy = setInterval(() => {
      void adapter.typing().catch(() => {})
      dots = (dots + 1) % 4
      if (phId) void adapter.edit(phId, `${currentStep}${' •'.repeat(dots)}`).catch(() => {})
    }, 3000)
  }

  const histKey = agentHistKey(adapter.id, workspaceId, chatKey)
  const convKey = `${adapter.id}_conv:${workspaceId}:${chatKey}`
  let history: ChatMessage[] = []
  try {
    // Prefer the DURABLE conversation as the source of truth: the old Redis window
    // kept only the last 10 messages for 1h, so anything said earlier (or after an
    // hour's pause) was invisible — the agent literally could not "look above".
    // Load a wider recent slice from the AiConversation; streamChat still trims/
    // summarizes if it gets long.
    const convId = await redis.get(convKey)
    if (convId) {
      // Load a WIDE recent slice: a data-entry session (dictating a draw / weigh-in)
      // is hundreds of tiny turns, and at 30 the agent couldn't see its own data
      // from a few minutes ago → it «lost the thread» and miscalculated. streamChat
      // then trims by a character budget, so loading many small messages is cheap
      // and safe; the budget caps what actually reaches the model.
      const rows = await prisma.aiMessage.findMany({
        where: { conversationId: convId, role: { in: ['user', 'assistant'] } },
        orderBy: { createdAt: 'desc' }, take: 400,
        select: { role: true, content: true },
      })
      history = rows.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    }
    if (!history.length) {
      const raw = await redis.get(histKey)
      if (raw) history = JSON.parse(raw) as ChatMessage[]
    }
  } catch { /* ignore */ }
  const messages: ChatMessage[] = [...history, { role: 'user', content: text }]

  // Default project gives the model a place to work, but we do NOT scope-lock it
  // (so "create a new project" still works).
  let projectName: string | undefined
  if (defaultProjectId) {
    const p = await prisma.project.findFirst({ where: { id: defaultProjectId, workspaceId }, select: { name: true } })
    projectName = p?.name
  }
  const context: ChatContext = {
    workspaceId,
    userId,
    projectId: defaultProjectId,
    projectName,
    userLanguage,
    // The default project is the agent's home: unspecified items land here, but
    // the agent can still work in other projects on request (not a hard lock).
    homeProjectId: defaultProjectId,
    // Hard tenant isolation: the agent can never touch another workspace, even
    // if the (untrusted) message tries to make it.
    lockWorkspaceId: workspaceId,
    // Drives the plain-text prompt block and the Vault guard.
    channel: capsOf(adapter),
    // Lets file-producing tools (export_project) deliver straight to this chat.
    // Only Telegram accepts an upload; Viber would need a public URL.
    ...(telegram && adapter.canUploadFile ? { telegram } : {}),
  }

  let reply = ''
  let errorText = ''            // provider/refusal error surfaced by streamChat
  let lastTask: { id: string; title?: string } | null = null
  let revealedSecret = false // get_secret was used → this reply contains Vault secrets
  try {
    for await (const chunk of streamChat(messages, context, prisma)) {
      const line = chunk.replace(/^data: /, '').trim()
      if (!line) continue
      try {
        const parsed = JSON.parse(line) as { type?: string; text?: string; tool?: string; kind?: string; id?: string; title?: string }
        if (parsed.type === 'text' && parsed.text) reply += parsed.text
        // ⚠️ streamChat отдаёт реальную причину (баланс/квота исчерпаны, отказ,
        // ключ не настроен) как type:'error'. Раньше здесь это игнорировалось —
        // и пользователь в Telegram вместо «на ключе кончились деньги» получал
        // «🤔 Пустой ответ, переформулируй» и по 13 раз диктовал впустую.
        else if (parsed.type === 'error' && parsed.text) errorText = parsed.text
        else if (parsed.type === 'tool_start' && parsed.tool) { currentStep = stepLabel(parsed.tool, userLanguage); if (parsed.tool === 'get_secret') revealedSecret = true }
        else if (parsed.type === 'entity' && parsed.kind === 'task' && parsed.id) lastTask = { id: parsed.id, title: parsed.title }
      } catch { /* ignore */ }
    }
  } catch (err) {
    reply = '❌ ' + (err instanceof Error ? err.message : String(err)).slice(0, 300)
  } finally {
    if (busy) clearInterval(busy) // stop the typing/dots animation once the answer is ready
  }
  // Ошибка провайдера важнее пустого текста: показываем её, а не «переформулируй».
  if (!reply.trim() && errorText) reply = '❌ ' + errorText

  // Баланс ключа исчерпан (BYOK — свой ключ провайдера; заранее его не узнать,
  // сигнал только сам 402). На скилах по расписанию НЕ заваливаем чат красной
  // ошибкой каждый запуск (утро+вечер+аудит = 3 в день) — шлём ОДИН алерт раз в
  // 6 часов, и в приложение, и в мессенджер, и на этом умолкаем. В интерактивном
  // чате ошибку оставляем как есть: человек тут и сразу видит причину.
  if (!persist && /💳|баланс|credit|quota|insufficient|\b402\b/i.test(errorText)) {
    try {
      if (await redis.set(`ai:lowbalance:${workspaceId}`, '1', 'EX', 21600, 'NX') === 'OK') {
        const title = { ru: '💳 Баланс AI-ключа исчерпан', en: '💳 AI key balance exhausted', be: '💳 Баланс AI-ключа скончыўся' }[userLanguage]
        const body = { ru: 'Пополни ключ провайдера или подключи свой в Настройки → AI. Автоматические сводки не приходят, пока баланс на нуле.',
          en: 'Top up your provider key or connect your own in Settings → AI. Scheduled digests are paused while the balance is zero.',
          be: 'Папоўні ключ або падключы свой у Настройках → AI. Аўтаматычныя зводкі не прыходзяць, пакуль баланс нулявы.' }[userLanguage]
        if (userId) {
          const { NotificationService } = await import('../notification/notification.service.js')
          await new NotificationService(prisma).create({ userId, type: 'system', title, body, link: '/settings' }).catch(() => {})
        }
        await adapter.send(`${title}\n${body}`).catch(() => {})
      }
    } catch { /* redis/notify — best effort */ }
    return // на автопрогоне сырую ошибку в чат не шлём
  }

  reply = reply.trim() || L.empty

  // Automated runs (scheduled skills) may answer "SKIP" to stay silent on an empty
  // day. Suppress a standalone/trailing SKIP so the token never leaks into the chat;
  // if nothing meaningful remains, send nothing at all.
  if (!persist && /(^|\n)\s*skip\.?\s*$/i.test(reply)) {
    const stripped = reply.replace(/(^|\n)\s*skip\.?\s*$/i, '').trim()
    if (!stripped) return
    reply = stripped
  }

  // Persist trimmed history (last 10 turns, 1h TTL) for follow-up questions.
  try {
    const next = [...messages, { role: 'assistant' as const, content: reply }].slice(-10)
    await redis.set(histKey, JSON.stringify(next), 'EX', 3600)
  } catch { /* ignore */ }

  // Persist the exchange as an AiConversation (durable history + feeds episodic
  // memory). Skipped for skill/trigger runs (persist=false) and for replies that
  // reveal Vault secrets (never store passwords in durable history).
  if (persist && !revealedSecret) {
    try {
      const key = `${adapter.id}_conv:${workspaceId}:${chatKey}`
      let convId = await redis.get(key)
      if (convId) { const ex = await prisma.aiConversation.findUnique({ where: { id: convId }, select: { id: true } }); if (!ex) convId = null }
      if (!convId) {
        const conv = await prisma.aiConversation.create({ data: { workspaceId, title: `${adapter.id} ${chatKey}` } })
        convId = conv.id
        await redis.set(key, convId)
      }
      await prisma.aiConversation.update({
        where: { id: convId },
        data: { updatedAt: new Date(), messages: { create: [{ role: 'user', content: text.slice(0, 8000) }, { role: 'assistant', content: reply.slice(0, 8000) }] } },
      })
    } catch (e) { console.error(`[${adapter.id}] persist conversation`, e) }
  }

  const buttons: ChannelButton[] | undefined = lastTask ? taskButtons(lastTask.id, userLanguage) : undefined

  // Секретный ответ — коротко и ОДНИМ сообщением (так его проще удалить через
  // минуту); длинные обычные ответы шлём несколькими сообщениями, не теряя хвост.
  if (revealedSecret) {
    const out = adapter.format(reply).slice(0, 3900) +
      { ru: '\n\n🕐 <i>Это сообщение с секретами удалю через 1 минуту.</i>', en: '\n\n🕐 <i>I will delete this secret message in 1 minute.</i>', be: '\n\n🕐 <i>Гэта паведамленне выдалю праз 1 хвіліну.</i>' }[userLanguage]
    let sentId: string | undefined
    if (live && phId && await adapter.edit(phId, out, buttons)) sentId = phId
    else sentId = await adapter.send(out, buttons)
    if (sentId !== undefined && adapter.canDelete) {
      setTimeout(() => { void adapter.delete(sentId!).catch(() => {}) }, 60_000)
    }
    return
  }

  const chunks = splitForChannel(reply)
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const out = adapter.format(chunks[i])            // форматируем каждый кусок отдельно — тег не разорвётся
    const btns = isLast ? buttons : undefined         // кнопки задачи только на последнем сообщении
    if (i === 0 && live && phId && await adapter.edit(phId, out, btns)) continue // первый — в плейсхолдер
    await adapter.send(out, btns)
  }
}

/** Back-compat wrapper: cron/skills still address Telegram by bot token. */
export async function runTelegramAgent(
  prisma: PrismaClient,
  botToken: string,
  workspaceId: string,
  chatId: number,
  userId: string | undefined,
  defaultProjectId: string | undefined,
  text: string,
  userLanguage: 'ru' | 'en' | 'be',
  persist = true,
): Promise<void> {
  return runChannelAgent(
    prisma, telegramAdapter(botToken, chatId), workspaceId, String(chatId),
    userId, defaultProjectId, text, userLanguage, persist, { botToken, chatId },
  )
}

// Quick-action buttons shown under a task the agent just created/updated.
function taskButtons(taskId: string, lang: 'ru' | 'en' | 'be'): ChannelButton[] {
  const T = {
    done: { ru: '✅ Готово', en: '✅ Done', be: '✅ Гатова' }[lang],
    snooze: { ru: '🕑 +1 день', en: '🕑 +1 day', be: '🕑 +1 дзень' }[lang],
    del: { ru: '🗑 Удалить', en: '🗑 Delete', be: '🗑 Выдаліць' }[lang],
  }
  return [
    { text: T.done, data: `t:d:${taskId}` },
    { text: T.snooze, data: `t:s:${taskId}` },
    { text: T.del, data: `t:x:${taskId}` },
  ]
}

// Telegram media capture: voice → Whisper transcript → note; photo/document →
// attachment (source). Returns a reply, or null if the message has no media.
// Find an installed module in the workspace that has a configured lab-ocr
// pipeline (e.g. Medical Record). Returns the project + decrypted OCR config.
// Find an installed module that declares the given pipeline AND has OCR configured.
async function findOcrTarget(prisma: PrismaClient, workspaceId: string, pipelineId: string, userId: string | null, source: string): Promise<{ projectId: string; moduleId: string | null; ocr: OcrConfig } | null> {
  const projects = await prisma.project.findMany({ where: { workspaceId, isModule: true, moduleId: { not: null } }, select: { id: true, moduleId: true, settings: true } })
  // The module's own key wins. Ours is the fallback, and only for a user who
  // opted into the managed model, is not frozen and has a balance — his tokens
  // are then charged like any other.
  const managed = await managedVisionFor(prisma, workspaceId, userId, source)
  let fallback: { projectId: string; moduleId: string | null } | null = null

  for (const p of projects) {
    const m = await getManifest(prisma, p.moduleId!)
    if (!(m?.ai?.pipelines ?? []).some((pl) => pl.id === pipelineId)) continue
    const ocr = (p.settings as Record<string, unknown>)?.ocr as Record<string, string> | undefined
    if (ocr?.apiKey && ocr?.model) {
      return { projectId: p.id, moduleId: p.moduleId, ocr: { provider: ocr.provider, model: ocr.model, baseUrl: ocr.baseUrl, apiKey: decryptSecret(ocr.apiKey)! } }
    }
    fallback ??= { projectId: p.id, moduleId: p.moduleId }
  }

  if (fallback && managed) return { ...fallback, ocr: managed }
  return null
}

// ─── Shared media ingest ──────────────────────────────────────────────────────
// Channel-agnostic: takes already-downloaded bytes and decides what they are.
//   voice → Whisper transcript, handed back to the agent as if it were typed
//   image/pdf → a module OCR pipeline (receipt / medical scan) when installed
//   anything else → stored as an attachment (source)
async function ingestMedia(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string | undefined,
  lang: 'ru' | 'en' | 'be',
  file: { buf: Buffer; mime: string; filename: string },
  caption: string | undefined,
  channel: 'telegram' | 'viber',
): Promise<{ reply?: string; agentText?: string; echo?: string }> {
  const M = MEDIA_TXT[lang]
  const ext = (file.filename.split('.').pop() || 'bin').toLowerCase()

  // The messenger is a door into the same disk: without this a user could fill
  // the quota through the bot while the web upload politely refused him.
  //
  // Checked BEFORE recognition, and against the size that will actually be
  // stored — the downscaled copy, not the 5 MB the phone sent. Compressing once
  // here and reusing the result below also spares a second sharp pass.
  // Voice notes are transcribed, never stored, so they must not be refused for
  // lack of disk — nothing of them lands on it.
  const isAudio = file.mime.startsWith('audio/')
  const small = isAudio ? null : await toStorableImage(file.buf, file.mime, file.filename)
  const quota = isAudio ? null : await canUploadFile(prisma, workspaceId, (small?.buffer ?? file.buf).byteLength)
  if (quota && !quota.ok) return { reply: M.noSpace(quota.usedMb, quota.limitMb) }

  // Voice / audio → transcribe → feed to the AI agent as if it were text.
  if (file.mime.startsWith('audio/')) {
    // Prefer the local faster-whisper service when configured; otherwise fall
    // back to OpenAI Whisper using the workspace's AI key.
    const form = new FormData()
    form.append('file', new Blob([file.buf as unknown as ArrayBuffer], { type: file.mime }), file.filename)
    form.append('response_format', 'text')
    let endpoint: string
    const headers: Record<string, string> = {}
    if (config.WHISPER_URL) {
      endpoint = `${config.WHISPER_URL.replace(/\/$/, '')}/audio/transcriptions`
      form.append('model', 'Systran/faster-whisper-base')
    } else {
      const settings = await getAISettings(workspaceId, prisma)
      const openaiKey = settings?.providers?.openai?.apiKey ?? (settings?.provider === 'openai' ? settings?.apiKey : null)
      if (!openaiKey) return { reply: M.noWhisper }
      endpoint = 'https://api.openai.com/v1/audio/transcriptions'
      headers.Authorization = `Bearer ${openaiKey}`
      form.append('model', 'whisper-1')
    }
    const wr = await fetch(endpoint, {
      method: 'POST', headers, body: form, signal: AbortSignal.timeout(180_000),
    }).catch(() => null)
    if (!wr || !wr.ok) return { reply: M.transcribeFail }
    const transcript = (await wr.text()).trim()
    if (!transcript) return { reply: M.emptyTranscript }
    // Echo the transcript back so the user sees what was heard.
    return { agentText: transcript, echo: `🎙 ${transcript}` }
  }

  // Photo/PDF → auto-file into Finance (receipt/statement) or Medical Record ONLY
  // on an explicit caption hint. Anything ambiguous is NOT guessed here — it goes
  // to the agent, which reads the image and files it correctly. The agent is the
  // smart classifier; the keyword path is just the fast lane for a clear hint.
  if (file.mime.startsWith('image/') || file.mime === 'application/pdf') {
    const cap = caption ?? ''
    const wantFinance = /чек|receipt|выпис|statement|расход|трат|оплат|покупк|spent|paid|bill|invoice|финанс/i.test(cap)
    const wantMedical = /анализ|медкарт|при[её]м|узи|снимок|диагноз|справк|lab|analys|medical|x-?ray|mri|ecg|экг/i.test(cap)
    // The workspace owner is who pays: the bot has no session of its own.
    const payer = await workspaceOwnerId(prisma, workspaceId)
    const medTarget = await findOcrTarget(prisma, workspaceId, 'medical-scan', payer, channel)
    const finTarget = await findOcrTarget(prisma, workspaceId, 'receipt-scan', payer, channel)
    // Auto-file only on an EXPLICIT caption hint. Guessing by "whichever module
    // is installed" filed bare receipts into the Medical Record — and, worse, it
    // hijacked every photo so the user could never just ask the agent about it.
    // With no hint the image goes to the agent instead (saved + read on request).
    let pick: { id: 'medical-scan' | 'receipt-scan'; target: { projectId: string; moduleId: string | null; ocr: OcrConfig } } | null = null
    if (finTarget && wantFinance && !wantMedical) pick = { id: 'receipt-scan', target: finTarget }
    else if (medTarget && wantMedical && !wantFinance) pick = { id: 'medical-scan', target: medTarget }

    if (pick) {
      try {
        const access = await checkPipelineAccess(prisma, workspaceId, pick.target.moduleId)
        if (!access.ok) return { reply: M.ocrPremium }
        const fileArg = { buffer: file.buf, mime: file.mime, filename: file.filename }
        if (pick.id === 'receipt-scan') {
          const r = await runReceiptScan(prisma, workspaceId, pick.target.projectId, pick.target.ocr, fileArg, null)
          if (!access.premium && r.kind !== 'none') await incrementPipelineUsage(prisma, workspaceId, pick.target.moduleId)
          if (r.kind === 'receipt') return { reply: M.ocrReceipt }
          if (r.kind === 'statement') return { reply: M.ocrStatement + (r.transactions ? M.txSuffix + r.transactions : '') }
        } else {
          const r = await runMedicalScan(prisma, workspaceId, pick.target.projectId, pick.target.ocr, fileArg, null)
          if (!access.premium && r.kind !== 'none') await incrementPipelineUsage(prisma, workspaceId, pick.target.moduleId)
          const extra = (r.medications ? M.medSuffix + r.medications : '') + (r.diagnoses ? M.dxSuffix + r.diagnoses : '')
          if (r.kind === 'lab') return { reply: M.ocrDone + r.indicators }
          if (r.kind === 'imaging') return { reply: M.ocrStudy + extra }
          if (r.kind === 'encounter') return { reply: M.ocrVisit + extra }
          if (r.kind === 'document') return { reply: M.ocrDoc + extra }
        }
        // Not recognised → fall through to saving a plain source.
      } catch (e) {
        return { reply: M.ocrFail + (e instanceof Error ? e.message : 'error') }
      }
    }
  }

  // `small` was computed up front (see the quota check): recognition saw the
  // full-resolution bytes, the disk gets a copy a human can still read.
  const buf = small?.buffer ?? file.buf
  const mime = small?.mime ?? file.mime
  const name = small?.filename ?? file.filename
  const storedExt = small ? name.split('.').pop()! : ext

  const key = `${workspaceId}/${randomUUID()}.${storedExt}`
  await uploadFile(key, buf, mime, buf.byteLength)
  const att = await prisma.attachment.create({
    data: {
      workspaceId, ...(projectId ? { projectId } : {}),
      filename: name,
      description: caption ?? null,
      mimeType: mime, size: buf.byteLength, storagePath: key, isImportant: false,
      metadata: { source: channel },
    },
  })
  if (quota) void maybeWarnStorage(prisma, workspaceId, quota.usedMb + Math.round(buf.byteLength / 1024 / 1024), quota.limitMb)

  // An image with no auto-file hint goes to the agent: it can now read the photo
  // (read_attachment → vision) and do what the user actually asked — check a
  // receipt, read the text, answer a question — instead of silently filing it.
  if (mime.startsWith('image/')) {
    const ask = caption?.trim() || M.imageToAgent
    const agentText = `${ask}\n\n[Вложение доступно: attachmentId="${att.id}", файл "${name}", тип ${mime}. Если нужно ответить по содержимому изображения (распознать чек, прочитать текст, посчитать суммы) — прочитай его через read_attachment с этим attachmentId.]`
    return { agentText }
  }
  return { reply: M.savedSource }
}

// Telegram media capture: pulls the file out of the update shape, downloads it,
// then hands the bytes to the channel-agnostic ingest above.
async function handleTelegramMedia(
  prisma: PrismaClient,
  botToken: string,
  workspaceId: string,
  message: Record<string, unknown>,
  projectId: string | undefined,
  lang: 'ru' | 'en' | 'be',
): Promise<{ reply?: string; agentText?: string; echo?: string } | null> {
  const M = MEDIA_TXT[lang]
  const voice = (message.voice ?? message.audio) as Record<string, unknown> | undefined
  const photoArr = message.photo as Array<Record<string, unknown>> | undefined
  const doc = message.document as Record<string, unknown> | undefined
  const caption = (message.caption as string | undefined)?.slice(0, 200)
  if (!voice && !photoArr?.length && !doc) return null

  const download = async (fileId: string): Promise<{ buf: Buffer; filePath: string } | null> => {
    try {
      const info = (await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json())) as { result?: { file_path?: string } }
      const fp = info?.result?.file_path
      if (!fp) return null
      const dl = await fetch(`https://api.telegram.org/file/bot${botToken}/${fp}`, { signal: AbortSignal.timeout(30_000) })
      if (!dl.ok) return null
      return { buf: Buffer.from(await dl.arrayBuffer()), filePath: fp }
    } catch { return null }
  }

  if (voice) {
    const f = await download(voice.file_id as string)
    if (!f) return { reply: M.dlVoiceFail }
    return ingestMedia(prisma, workspaceId, projectId, lang, { buf: f.buf, mime: 'audio/ogg', filename: 'voice.ogg' }, caption, 'telegram')
  }

  const fileId = doc ? (doc.file_id as string) : (photoArr![photoArr!.length - 1].file_id as string)
  const f = await download(fileId)
  if (!f) return { reply: M.dlFileFail }
  const mime = doc ? ((doc.mime_type as string) || 'application/octet-stream') : 'image/jpeg'
  const ext = (f.filePath.split('.').pop() || (doc?.file_name as string | undefined)?.split('.').pop() || 'bin').toLowerCase()
  const filename = doc ? ((doc.file_name as string) || `scan.${ext}`) : `telegram-${Date.now()}.${ext}`
  return ingestMedia(prisma, workspaceId, projectId, lang, { buf: f.buf, mime, filename }, caption, 'telegram')
}

// Viber media capture: media arrives as a URL with a one-hour TTL, so it must be
// fetched immediately. The message carries `type`, `media`, `file_name`, `size`.
async function handleViberMedia(
  prisma: PrismaClient,
  workspaceId: string,
  message: Record<string, unknown>,
  projectId: string | undefined,
  lang: 'ru' | 'en' | 'be',
): Promise<{ reply?: string; agentText?: string; echo?: string } | null> {
  const M = MEDIA_TXT[lang]
  const type = String(message.type ?? '')
  if (!['picture', 'file', 'video'].includes(type)) return null
  const url = message.media as string | undefined
  if (!url) return null

  const declared = (message.file_name as string | undefined) || ''
  const filename = declared || (type === 'picture' ? `viber-${Date.now()}.jpg` : `viber-${Date.now()}.bin`)
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const mime =
    type === 'picture' ? 'image/jpeg'
    : ext === 'pdf' ? 'application/pdf'
    : ext === 'mp3' || ext === 'm4a' || ext === 'ogg' || ext === 'wav' ? `audio/${ext}`
    : type === 'video' ? 'video/mp4'
    : 'application/octet-stream'

  let buf: Buffer
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return { reply: M.dlFileFail }
    buf = Buffer.from(await res.arrayBuffer())
  } catch { return { reply: M.dlFileFail } }

  const caption = (message.text as string | undefined)?.slice(0, 200)
  return ingestMedia(prisma, workspaceId, projectId, lang, { buf, mime, filename }, caption, 'viber')
}

const upsertSchema = z.object({
  workspaceId: z.string(),
  type: z.enum(['TELEGRAM', 'VIBER', 'SLACK', 'DISCORD', 'TWITTER', 'EMAIL', 'WEBHOOK']),
  config: z.record(z.unknown()),
})

export async function integrationRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const svc = new IntegrationService(prisma)

  // GET /integrations?workspaceId=xxx
  app.get('/integrations', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string }
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    return reply.send(await svc.list(workspaceId))
  })

  // POST /integrations — create or update
  app.post('/integrations', async (req, reply) => {
    const body = upsertSchema.parse(req.body)
    if (await denyIfNotMember(prisma, body.workspaceId, req.authUser!.id, reply)) return

    if (body.type === 'WEBHOOK') {
      const url = (body.config as Record<string, unknown>).url as string | undefined
      if (url && !isSafeWebhookUrl(url)) {
        return reply.status(400).send({ error: 'Webhook URL must be a public HTTPS/HTTP URL' })
      }
    }

    // Viber: same shape as Telegram — validate the token, then register the
    // public webhook. Viber verifies the URL synchronously with a test POST, so
    // a bad APP_URL fails here rather than silently later.
    if (body.type === 'VIBER') {
      if (!config.APP_URL) return reply.status(400).send({ error: 'APP_URL not configured on the server — cannot register the Viber webhook' })

      if (!config.APP_URL) return reply.status(400).send({ error: 'APP_URL not configured on the server — cannot register the Viber webhook' })

      const existing = await prisma.integration.findUnique({
        where: { workspaceId_type: { workspaceId: body.workspaceId, type: 'VIBER' } },
        select: { config: true },
      })
      const prevCfg = (existing?.config as Record<string, unknown> | null) ?? {}
      const token = ((body.config as Record<string, unknown>).token as string | undefined)?.trim()
        || (prevCfg.token as string | undefined)
      if (!token) return reply.status(400).send({ error: 'token required' })

      const acc = await getViberAccountInfo(token) as { status?: number; status_message?: string; name?: string } | null
      if (!acc || acc.status !== 0) {
        return reply.status(400).send({ error: `Viber не признал токен: ${acc?.status_message ?? 'нет ответа'}. Возьми токен в кабинете Public Account → Edit Info → Bot token.` })
      }

      const hookUrl = `${config.APP_URL}/api/v1/webhooks/viber/${body.workspaceId}`
      const hook = await setViberWebhook(token, hookUrl)
      if (!hook || hook.status !== 0) {
        return reply.status(400).send({ error: `Viber отклонил вебхук (${hookUrl}): ${hook?.status_message ?? 'unknown error'}. Проверь, что APP_URL публичный и по HTTPS.` })
      }

      // No secret token in Viber: inbound requests are verified by an HMAC over
      // the raw body, so the bot token IS the shared secret. Never echo it back.
      const merged = { ...prevCfg, ...body.config, token, senderName: acc.name ?? 'SinoutX' }
      const integration = await svc.upsert(body.workspaceId, 'VIBER', merged)
      return reply.status(201).send({ ...integration, config: { ...merged, token: undefined } })
    }

    // Telegram: register the webhook with Telegram automatically (no manual
    // setWebhook needed) and store a secret token for inbound verification.
    if (body.type === 'TELEGRAM') {
      if (!config.APP_URL) return reply.status(400).send({ error: 'APP_URL not configured on the server — cannot register the Telegram webhook' })

      // Reuse the stored bot token if the form left it blank (e.g. user only
      // changed the default project), so they don't have to re-enter it.
      const existing = await prisma.integration.findUnique({
        where: { workspaceId_type: { workspaceId: body.workspaceId, type: 'TELEGRAM' } },
        select: { config: true },
      })
      const prevCfg = (existing?.config as Record<string, unknown> | null) ?? {}
      const botToken = ((body.config as Record<string, unknown>).botToken as string | undefined)?.trim()
        || (prevCfg.botToken as string | undefined)
      if (!botToken) return reply.status(400).send({ error: 'botToken required' })

      // Validate the token first so a bad/typo'd token gives a clear message
      // instead of the confusing setWebhook "Not Found".
      const me = await tgApi(botToken, 'getMe', {}) as { ok?: boolean } | null
      if (!me?.ok) {
        return reply.status(400).send({ error: 'Неверный токен бота: Telegram не признал его (Not Found). Скопируй токен заново из @BotFather (формат 123456789:AA…, без пробелов) и вставь в поле «Токен бота».' })
      }

      const secret = randomBytes(16).toString('hex')
      const hookUrl = `${config.APP_URL}/api/v1/webhooks/telegram/${body.workspaceId}`
      let tg: { ok?: boolean; description?: string } | null = null
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: hookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
          signal: AbortSignal.timeout(15_000),
        })
        tg = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
      } catch {
        return reply.status(502).send({ error: 'Could not reach Telegram to register the webhook' })
      }
      if (!tg?.ok) return reply.status(400).send({ error: `Telegram rejected the bot token / webhook: ${tg?.description ?? 'unknown error'}` })

      // Register the "/" command menu (best-effort — don't fail the connect on it).
      void tgApi(botToken, 'setMyCommands', { commands: [
        { command: 'tasks',   description: '📋 Мои задачи' },
        { command: 'today',   description: '📅 Сегодня: задачи и события' },
        { command: 'balance', description: '💰 Баланс счетов' },
        { command: 'new',     description: '🆕 Новый диалог (сбросить контекст)' },
        { command: 'help',    description: 'ℹ️ Помощь' },
      ] }).catch(() => {})

      // Keep chatId across reconnects; effective token + new secret win.
      const merged = { ...prevCfg, ...body.config, botToken, secret }
      const integration = await svc.upsert(body.workspaceId, 'TELEGRAM', merged)
      return reply.status(201).send({ ...integration, config: { ...merged, secret: undefined, botToken: undefined } })
    }

    const integration = await svc.upsert(body.workspaceId, body.type, body.config)
    return reply.status(201).send(integration)
  })

  // Stop the messenger from posting to a webhook that no longer serves it.
  // Best-effort: the integration goes away either way, and a stale webhook only
  // costs the bot an HTTP 404 per event.
  async function unregisterWebhook(type: string, cfg: Record<string, unknown>) {
    try {
      if (type === 'TELEGRAM' && cfg.botToken) await tgApi(cfg.botToken as string, 'deleteWebhook', {})
      // Viber removes the webhook on an empty url — and only on `url` alone.
      if (type === 'VIBER' && cfg.token) await viberApi(cfg.token as string, 'set_webhook', { url: '' })
    } catch { /* ignore */ }
  }

  // PATCH /integrations/:id/disable
  app.patch('/integrations/:id/disable', async (req, reply) => {
    const { id } = req.params as { id: string }
    const integration = await prisma.integration.findUnique({ where: { id }, select: { workspaceId: true, type: true, config: true } })
    if (!integration) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, integration.workspaceId, req.authUser!.id, reply)) return
    await unregisterWebhook(integration.type, (integration.config ?? {}) as Record<string, unknown>)
    return reply.send(await svc.disable(id))
  })

  // DELETE /integrations/:id
  app.delete('/integrations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const integration = await prisma.integration.findUnique({ where: { id }, select: { workspaceId: true, type: true, config: true } })
    if (!integration) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, integration.workspaceId, req.authUser!.id, reply)) return
    await unregisterWebhook(integration.type, (integration.config ?? {}) as Record<string, unknown>)
    await svc.delete(id)
    return reply.status(204).send()
  })

  // ─── Telegram webhook ───────────────────────────────────────────────────────
  // POST /webhooks/telegram/:workspaceId — public (no auth, called by Telegram)
  app.post('/webhooks/telegram/:workspaceId', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string }

    const integration = await prisma.integration.findFirst({
      where: { workspaceId, type: 'TELEGRAM', status: 'ACTIVE' },
    })
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    const cfg = integration.config as Record<string, unknown>
    // Verify Telegram's secret token (set at registration) — the route is public.
    if (cfg.secret && req.headers['x-telegram-bot-api-secret-token'] !== cfg.secret) {
      return reply.status(401).send({ error: 'Invalid secret token' })
    }

    const update = req.body as Record<string, unknown>
    const tgBotToken = cfg.botToken as string | undefined

    // ── Inline-button callbacks (quick task actions: done / snooze / delete) ──
    const cb = update.callback_query as Record<string, unknown> | undefined
    if (cb) {
      const data = String(cb.data ?? '')
      const cbMsg = cb.message as Record<string, unknown> | undefined
      const cbChat = (cbMsg?.chat as Record<string, unknown> | undefined)?.id as number | undefined
      const cbMsgId = cbMsg?.message_id as number | undefined
      const m = data.match(/^t:([dsx]):(.+)$/)
      let toast = 'OK'
      if (m) {
        const [, act, tid] = m
        const task = await prisma.task.findFirst({ where: { id: tid, project: { workspaceId } }, select: { id: true, dueDate: true } })
        if (!task) toast = 'Задача не найдена'
        else if (act === 'd') { await prisma.task.update({ where: { id: tid }, data: { status: 'DONE' } }); toast = '✅ Закрыто' }
        else if (act === 'x') { await prisma.task.update({ where: { id: tid }, data: { isDeleted: true } }); toast = '🗑 Удалено' }
        else if (act === 's') { const base = task.dueDate ?? new Date(); await prisma.task.update({ where: { id: tid }, data: { dueDate: new Date(base.getTime() + 86_400_000) } }); toast = '🕑 Срок +1 день' }
        // Remove the buttons so the action isn't repeated.
        if (tgBotToken && cbChat !== undefined && cbMsgId !== undefined) {
          void tgApi(tgBotToken, 'editMessageReplyMarkup', { chat_id: cbChat, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } }).catch(() => {})
        }
      }
      if (tgBotToken) await tgApi(tgBotToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: toast })
      return reply.send({ ok: true })
    }

    // Auto-capture the chat id from the first message so outbound reminders
    // (cron) can reach the user without them hunting for their chat id.
    const chatId = ((update.message as Record<string, unknown> | undefined)?.chat as Record<string, unknown> | undefined)?.id
    if (chatId !== undefined && cfg.chatId !== chatId) {
      cfg.chatId = chatId
      await prisma.integration.update({
        where: { id: integration.id },
        data: { config: { ...cfg } as object },
      }).catch(() => null)
    }

    const message = update.message as Record<string, unknown> | undefined
    const botToken = cfg.botToken as string | undefined
    // The agent's home project: unspecified notes/tasks/events land here.
    const projectId = await ensureAgentProject(prisma, workspaceId, integration.id, cfg)
    const text = (message?.text as string | undefined)?.trim()
    const msgChatId = (message?.chat as Record<string, unknown> | undefined)?.id as number | undefined
    // Reply in the Telegram user's language (be/en, else default ru).
    const langCode = (message?.from as Record<string, unknown> | undefined)?.language_code as string | undefined
    const userLanguage: 'ru' | 'en' | 'be' = langCode?.startsWith('be') ? 'be' : langCode?.startsWith('en') ? 'en' : 'ru'

    // Quick-capture commands stay explicit; everything else (free text and voice
    // transcripts) goes to the AI agent. /new resets the conversation history.
    const isQuickCmd = !!text && /^\/(note|task|start|help|search)(\s|@|$)/i.test(text)

    // Fire the AI agent in the background so Telegram gets its 200 fast (the agent
    // can take 10-60s); the agent pushes its own reply via the Bot API.
    const fireAgent = async (bt: string, cid: number, agentText: string) => {
      const owner = await prisma.workspaceMember.findFirst({
        where: { workspaceId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      })
      void runTelegramAgent(prisma, bt, workspaceId, cid, owner?.userId, projectId, agentText, userLanguage)
        .catch((err) => app.log.error({ err }, 'telegram agent failed'))
    }

    let result: { reply?: string; agentText?: string; echo?: string } | null | undefined = null

    if (message && botToken && (message.voice || message.audio || message.photo || message.document)) {
      // Media: voice → transcript handed to the agent; photo/document → source.
      result = await handleTelegramMedia(prisma, botToken, workspaceId, message, projectId, userLanguage)
      if (result?.agentText && msgChatId !== undefined) {
        // Echo only the human-facing text (voice transcript); an image's agentText
        // carries an internal attachment hint that must not be shown.
        if (result.echo) await tgApi(botToken, 'sendMessage', { chat_id: msgChatId, text: result.echo.slice(0, 300) })
        await fireAgent(botToken, msgChatId, result.agentText)
        return reply.send({ ok: true })
      }
    } else if (text === '/new' || text === '/reset') {
      // Reset BOTH the short Redis window AND the durable-conversation pointer, so
      // the agent starts a genuinely fresh dialog (history is now loaded from the
      // AiConversation, so clearing only the window would leave the old context).
      if (msgChatId !== undefined) {
        await redis.del(agentHistKey('telegram', workspaceId, String(msgChatId))).catch(() => null)
        await redis.del(`telegram_conv:${workspaceId}:${String(msgChatId)}`).catch(() => null)
      }
      result = { reply: MEDIA_TXT[userLanguage].newDialog }
    } else if (isQuickCmd) {
      result = await svc.handleTelegramUpdate(workspaceId, update, projectId, userLanguage)
    } else if (text && botToken && msgChatId !== undefined) {
      const agentText = commandPrompt(text)
      // Instant acknowledgement reaction on the incoming message ("принял").
      const inMsgId = message?.message_id as number | undefined
      if (inMsgId !== undefined) void tgApi(botToken, 'setMessageReaction', { chat_id: msgChatId, message_id: inMsgId, reaction: [{ type: 'emoji', emoji: '👀' }] }).catch(() => {})
      await fireAgent(botToken, msgChatId, agentText)
      return reply.send({ ok: true })
    }

    if (result?.reply && botToken && msgChatId !== undefined) {
      await tgApi(botToken, 'sendMessage', { chat_id: msgChatId, text: result.reply })
    }

    return reply.send({ ok: true })
  })

  // ── Viber webhook ───────────────────────────────────────────────────────────
  // Viber signs the RAW body, and Fastify discards it after JSON parsing — so the
  // route lives in its own encapsulated plugin whose parser keeps the string.
  // Re-serialising req.body would not do: key order and unicode escaping are not
  // guaranteed to reproduce the bytes Viber hashed.
  app.register(async (viberScope) => {
    viberScope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, { raw: body as string, json: JSON.parse(body as string) }) }
      catch (err) { done(err as Error, undefined) }
    })

    viberScope.post('/webhooks/viber/:workspaceId', async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string }
      const { raw, json } = req.body as { raw: string; json: Record<string, unknown> }

      const integration = await prisma.integration.findFirst({
        where: { workspaceId, type: 'VIBER', status: 'ACTIVE' },
      })
      if (!integration) return reply.status(404).send({ error: 'Integration not found' })

      const cfg = integration.config as Record<string, unknown>
      const token = cfg.token as string | undefined
      if (!token) return reply.status(400).send({ error: 'Viber token missing' })

      const sig = req.headers['x-viber-content-signature'] as string | undefined
      if (!verifyViberSignature(token, raw, sig)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }

      const event = String(json.event ?? '')
      const senderName = (cfg.senderName as string | undefined) ?? 'SinoutX'
      const projectId = await ensureAgentProject(prisma, workspaceId, integration.id, cfg)

      // Viber probes the URL right after set_webhook; answer it and nothing else.
      if (event === 'webhook') return reply.send({ status: 0 })
      if (event === 'delivered' || event === 'seen' || event === 'failed') return reply.send({ status: 0 })

      // `conversation_started` expects the welcome message INSIDE the 200 body —
      // there is no user id to send to yet.
      if (event === 'conversation_started') {
        const lang = viberLang((json.user as Record<string, unknown> | undefined)?.language as string | undefined)
        return reply.send({
          sender: { name: senderName },
          type: 'text',
          text: MEDIA_TXT[lang].viberWelcome,
        })
      }

      if (event === 'unsubscribed') {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { config: { ...cfg, receiverId: undefined } as object },
        }).catch(() => null)
        return reply.send({ status: 0 })
      }

      const senderObj = (json.sender ?? (json.user as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined
      const senderId = senderObj?.id as string | undefined
      if (!senderId) return reply.send({ status: 0 })

      // Remember who to push proactive briefs to (cron), like Telegram's chatId.
      if (cfg.receiverId !== senderId) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { config: { ...cfg, receiverId: senderId } as object },
        }).catch(() => null)
      }

      const adapter = viberAdapter(token, senderId, senderName)
      const userLanguage = viberLang(senderObj?.language as string | undefined)

      if (event === 'subscribed') {
        void adapter.send(MEDIA_TXT[userLanguage].viberWelcome).catch(() => {})
        return reply.send({ status: 0 })
      }
      if (event !== 'message') return reply.send({ status: 0 })

      const message = json.message as Record<string, unknown> | undefined
      if (!message) return reply.send({ status: 0 })
      const text = (message.text as string | undefined)?.trim()

      // A tapped keyboard button arrives as a plain message whose text is the
      // ActionBody we set — the same payload Telegram sends as callback_data.
      const btn = text?.match(/^t:([dsx]):(.+)$/)
      if (btn) {
        const [, act, tid] = btn
        const task = await prisma.task.findFirst({ where: { id: tid, project: { workspaceId } }, select: { id: true, dueDate: true } })
        let toast = 'OK'
        if (!task) toast = 'Задача не найдена'
        else if (act === 'd') { await prisma.task.update({ where: { id: tid }, data: { status: 'DONE' } }); toast = '✅ Закрыто' }
        else if (act === 'x') { await prisma.task.update({ where: { id: tid }, data: { isDeleted: true } }); toast = '🗑 Удалено' }
        else if (act === 's') { const base = task.dueDate ?? new Date(); await prisma.task.update({ where: { id: tid }, data: { dueDate: new Date(base.getTime() + 86_400_000) } }); toast = '🕑 Срок +1 день' }
        // No keyboard removal in Viber — the next message simply carries none.
        void adapter.send(toast).catch(() => {})
        return reply.send({ status: 0 })
      }

      const owner = await prisma.workspaceMember.findFirst({
        where: { workspaceId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      })

      // Media first: a voice note becomes a transcript the agent then answers.
      if (['picture', 'file', 'video'].includes(String(message.type ?? ''))) {
        const result = await handleViberMedia(prisma, workspaceId, message, projectId, userLanguage)
        if (result?.agentText) {
          // Echo only the human-facing text (voice transcript), never the image's
          // internal attachment hint.
          if (result.echo) void adapter.send(result.echo.slice(0, 300)).catch(() => {})
          void runChannelAgent(prisma, adapter, workspaceId, senderId, owner?.userId, projectId, result.agentText, userLanguage)
            .catch((err) => app.log.error({ err }, 'viber agent failed'))
          return reply.send({ status: 0 })
        }
        if (result?.reply) void adapter.send(result.reply).catch(() => {})
        return reply.send({ status: 0 })
      }

      if (!text) return reply.send({ status: 0 })

      if (text === '/new' || text === '/reset') {
        await redis.del(agentHistKey('viber', workspaceId, senderId)).catch(() => null)
        void adapter.send(MEDIA_TXT[userLanguage].newDialog).catch(() => {})
        return reply.send({ status: 0 })
      }

      // Fire the agent in the background so Viber gets its 200 fast; the agent
      // pushes its own reply. Viber has no typing indicator, so the user sees
      // nothing until the answer lands — that is the trade-off of the channel.
      void runChannelAgent(prisma, adapter, workspaceId, senderId, owner?.userId, projectId, commandPrompt(text), userLanguage)
        .catch((err) => app.log.error({ err }, 'viber agent failed'))
      return reply.send({ status: 0 })
    })
  })

  // ─── Slack webhook ──────────────────────────────────────────────────────────
  app.post('/webhooks/slack/:workspaceId', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string }
    const body = req.body as Record<string, unknown>

    if (body.type === 'url_verification') {
      return reply.send({ challenge: body.challenge })
    }

    const integration = await prisma.integration.findFirst({
      where: { workspaceId, type: 'SLACK', status: 'ACTIVE' },
    })
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    const event = body.event as Record<string, unknown> | undefined
    if (event) {
      await svc.handleSlackEvent(workspaceId, event)
    }

    return reply.send({ ok: true })
  })

  // ─── Discord webhook ────────────────────────────────────────────────────────
  app.post('/webhooks/discord/:workspaceId', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string }
    const body = req.body as Record<string, unknown>

    if (body.type === 1) {
      return reply.send({ type: 1 })
    }

    const integration = await prisma.integration.findFirst({
      where: { workspaceId, type: 'DISCORD', status: 'ACTIVE' },
    })
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    if (body.type === 0) {
      const content = body.content as string | undefined
      if (content) {
        await prisma.note.create({
          data: {
            workspaceId,
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }],
            },
            tags: ['discord'],
          },
        })
      }
    }

    return reply.send({ ok: true })
  })
}

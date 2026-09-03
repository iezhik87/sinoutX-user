import type { PrismaClient } from '@prisma/client'
import { encryptIntegrationConfig, maskIntegrationConfig } from './secrets.js'
import { IntegrationType, IntegrationStatus } from '@prisma/client'
import { publish } from '../../lib/redis.js'

// Localized service replies the Telegram bot sends for quick-capture commands.
export type TgLang = 'ru' | 'en' | 'be'
export const TELEGRAM_TXT: Record<TgLang, {
  help: string; noteSaved: string; taskCreated: string; searchHint: string; savedAsNote: string
}> = {
  ru: {
    help:
      '👋 SinoutX подключён!\n\n' +
      '🤖 Просто напиши или наговори голосовое — AI-ассистент сам сделает:\n' +
      '«создай проект Ремонт с задачами», «что у меня на сегодня», «напомни за день до дня рождения 15 августа».\n' +
      'Можно удалять и восстанавливать: «удали задачу …», «что я удалил», «восстанови …» (корзина 30 дней).\n\n' +
      'Быстрый захват:\n' +
      '• /note <текст> — сохранить заметку\n' +
      '• /task <название> — создать задачу\n' +
      '• 🎙 голосовое — распознаю и передам ассистенту\n' +
      '• 📎 фото/файл — сохраню в источники проекта\n' +
      '• /new — начать новый диалог (очистить контекст)\n\n' +
      'Этот чат привязан — сюда будут приходить напоминания о задачах и событиях.',
    noteSaved: 'Заметка сохранена.',
    taskCreated: 'Задача создана',
    searchHint: 'Поиск удобнее в веб-приложении SinoutX.',
    savedAsNote: 'Сохранено как заметка. Используй /note <текст> или /task <название>.',
  },
  en: {
    help:
      '👋 SinoutX connected!\n\n' +
      '🤖 Just type or send a voice message — the AI assistant does it:\n' +
      '"create a Renovation project with tasks", "what\'s due today", "remind me a day before the birthday on Aug 15".\n' +
      'You can delete and restore: "delete task …", "what did I delete", "restore …" (30-day trash).\n\n' +
      'Quick capture:\n' +
      '• /note <text> — save a note\n' +
      '• /task <title> — create a task\n' +
      '• 🎙 voice — transcribed and handed to the assistant\n' +
      '• 📎 photo/file — saved to the project sources\n' +
      '• /new — start a new conversation (clear context)\n\n' +
      'This chat is linked — task and event reminders arrive here.',
    noteSaved: 'Note saved.',
    taskCreated: 'Task created',
    searchHint: 'Search is easier in the SinoutX web app.',
    savedAsNote: 'Saved as a note. Use /note <text> or /task <title>.',
  },
  be: {
    help:
      '👋 SinoutX падключаны!\n\n' +
      '🤖 Проста напішы або нагавары галасавое — AI-асістэнт усё зробіць:\n' +
      '«ствары праект Рамонт з задачамі», «што ў мяне сёння», «нагадай за дзень да дня нараджэння 15 жніўня».\n' +
      'Можна выдаляць і аднаўляць: «выдалі задачу …», «што я выдаліў», «аднаві …» (кошык 30 дзён).\n\n' +
      'Хуткі захоп:\n' +
      '• /note <тэкст> — захаваць нататку\n' +
      '• /task <назва> — стварыць задачу\n' +
      '• 🎙 галасавое — распазнаю і перадам асістэнту\n' +
      '• 📎 фота/файл — захаваю ў крыніцы праекта\n' +
      '• /new — пачаць новы дыялог (ачысціць кантэкст)\n\n' +
      'Гэты чат прывязаны — сюды будуць прыходзіць нагадванні пра задачы і падзеі.',
    noteSaved: 'Нататка захавана.',
    taskCreated: 'Задача створана',
    searchHint: 'Пошук зручнейшы ў вэб-дадатку SinoutX.',
    savedAsNote: 'Захавана як нататка. Выкарыстоўвай /note <тэкст> або /task <назва>.',
  },
}

export class IntegrationService {
  constructor(private prisma: PrismaClient) {}

  /** Список для интерфейса. Учётные данные маскируются: браузеру нужно знать,
   *  что токен задан, а не какой он. Раньше конфиг уходил в него целиком. */
  async list(workspaceId: string) {
    const rows = await this.prisma.integration.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({ ...r, config: maskIntegrationConfig(r.config) }))
  }

  /** Единственная точка записи конфига — поэтому шифрование стоит здесь, а не в
   *  каждом вызывающем месте. */
  async upsert(workspaceId: string, type: IntegrationType, config: Record<string, unknown>) {
    const enc = encryptIntegrationConfig(config) as object
    return this.prisma.integration.upsert({
      where: { workspaceId_type: { workspaceId, type } },
      create: { workspaceId, type, config: enc, status: IntegrationStatus.ACTIVE },
      update: { config: enc, status: IntegrationStatus.ACTIVE, updatedAt: new Date() },
    })
  }

  async disable(id: string) {
    return this.prisma.integration.update({
      where: { id },
      data: { status: IntegrationStatus.PAUSED },
    })
  }

  async delete(id: string) {
    return this.prisma.integration.delete({ where: { id } })
  }

  // ─── Telegram webhook handler ───────────────────────────────────────────────
  async handleTelegramUpdate(workspaceId: string, update: Record<string, unknown>, defaultProjectId?: string, lang: 'ru' | 'en' | 'be' = 'ru') {
    const T = TELEGRAM_TXT[lang]
    const message = update.message as Record<string, unknown> | undefined
    if (!message) return

    const text = message.text as string | undefined
    const chatId = (message.chat as Record<string, unknown>)?.id as number | undefined
    const from = (message.from as Record<string, unknown>)?.username as string | undefined

    if (!text || !chatId) return

    // Resolve the target project: the integration's configured default, else the
    // workspace's first project. Notes are optionally project-scoped; tasks need one.
    const configured = defaultProjectId
      ? await this.prisma.project.findFirst({ where: { id: defaultProjectId, workspaceId }, select: { id: true } })
      : null
    const fallback = configured ? null : await this.prisma.project.findFirst({
      where: { workspaceId },
      orderBy: { position: 'asc' },
      select: { id: true },
    })
    const project = configured ?? fallback

    if (text === '/start' || text === '/help' || text.startsWith('/start ') || text.startsWith('/help')) {
      return { reply: T.help }
    }

    if (text.startsWith('/note ') || text.startsWith('/note\n')) {
      // Create a note from Telegram message
      const content = text.replace(/^\/note\s*/, '').trim()
      const note = await this.prisma.note.create({
        data: {
          workspaceId,
          ...(configured ? { projectId: configured.id } : {}),
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }],
          },
          tags: ['telegram', from ?? 'bot'],
        },
      })

      await publish({ type: 'note.created', workspaceId, noteId: note.id })
      return { reply: T.noteSaved }
    }

    if (text.startsWith('/task ') && project) {
      const title = text.replace(/^\/task\s*/, '').trim()
      const task = await this.prisma.task.create({
        data: { projectId: project.id, title, status: 'TODO', priority: 'MEDIUM' },
      })

      await publish({ type: 'task.created', workspaceId, projectId: project.id, taskId: task.id })
      return { reply: `${T.taskCreated}: «${task.title}»` }
    }

    if (text.startsWith('/search ')) {
      return { reply: T.searchHint }
    }

    // Default: save as note
    const note = await this.prisma.note.create({
      data: {
        workspaceId,
        ...(configured ? { projectId: configured.id } : {}),
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
        tags: ['telegram'],
      },
    })
    await publish({ type: 'note.created', workspaceId, noteId: note.id })
    return { reply: T.savedAsNote }
  }

  // ─── Slack webhook handler ──────────────────────────────────────────────────
  async handleSlackEvent(workspaceId: string, event: Record<string, unknown>) {
    const type = event.type as string
    if (type !== 'message') return

    const text = event.text as string | undefined
    const user = event.user as string | undefined
    if (!text || !user) return

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    })
    if (!workspace) return

    await this.prisma.note.create({
      data: {
        workspaceId,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
        tags: ['slack'],
      },
    })
  }
}

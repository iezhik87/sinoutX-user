// ─── Выгрузка и восстановление одного рабочего пространства ───────────────────
//
// Здесь НЕ перечисляются поля. `findMany` отдаёт все колонки модели, `createMany`
// их принимает — значит новая колонка попадает в архив сама, без чьей-либо
// памяти. Перечислен только уровень МОДЕЛЕЙ: как от каждой добраться до
// воркспейса, потому что это смысловой вопрос, а не механический.
//
// Почему так. Прежняя выгрузка называла тринадцать сущностей руками, и список
// был верен в день, когда его написали. К моменту, когда это заметили, к
// воркспейсу было привязано двадцать семь моделей: в архив не попадали ни
// модули (медкарта, финансы, СЕЙФ С ПАРОЛЯМИ), ни привычки с целями и
// дневником, ни доска идей, ни память ассистента. Архив при этом выглядел
// настоящим — распаковывался и весил правдоподобно. Ровно та же ошибка была в
// админском бэкапе, и там её закрыл pg_dump; здесь pg_dump не подходит, потому
// что выгрузить надо ОДНО пространство, а не всю базу.
//
// Оставшийся риск — появление новой модели, которую забудут внести. Его ловит
// `unclassifiedModels`: всё, что не попало ни в SCOPED, ни в EXCLUDED, ломает
// бэкап с перечислением забытого. Лучше отказ, чем архив, о неполноте которого
// человек узнает в день восстановления.
import { Prisma, type PrismaClient } from '@prisma/client'

/** Как добраться от модели до воркспейса. */
interface Scoped {
  /** Имя модели в схеме (PascalCase). */
  model: string
  /** Условие выборки. `ownerId` нужен моделям, которые привязаны к человеку, а
   *  не к пространству — дневник среди них. */
  where: (workspaceId: string, ownerId: string | null) => Record<string, unknown>
  /** Ссылки на собственную таблицу: при вставке обнуляются и проставляются
   *  вторым проходом, иначе строка ссылается на ещё не вставленного родителя. */
  selfRefs?: string[]
  /** Ссылки на пользователя. При восстановлении на другом инстансе таких людей
   *  может не быть — строки отбрасываются, а не роняют всё восстановление. */
  userRefs?: string[]
}

/**
 * Порядок важен: он же порядок вставки при восстановлении. Ребёнок не может
 * быть вставлен раньше родителя.
 */
export const SCOPED: Scoped[] = [
  { model: 'Project',           where: (w) => ({ workspaceId: w }) },
  { model: 'Board',             where: (w) => ({ project: { workspaceId: w } }) },
  { model: 'Page',              where: (w) => ({ project: { workspaceId: w } }), selfRefs: ['parentPageId'] },
  { model: 'PageVersion',       where: (w) => ({ page: { project: { workspaceId: w } } }) },
  { model: 'Task',              where: (w) => ({ project: { workspaceId: w } }), selfRefs: ['parentTaskId'] },
  { model: 'Tag',               where: (w) => ({ workspaceId: w }) },
  { model: 'TaskTag',           where: (w) => ({ task: { project: { workspaceId: w } } }) },
  { model: 'TaskActivity',      where: (w) => ({ task: { project: { workspaceId: w } } }) },
  { model: 'TimeEntry',         where: (w) => ({ task: { project: { workspaceId: w } } }) },
  { model: 'Comment',           where: (w) => ({ OR: [{ task: { project: { workspaceId: w } } }, { page: { project: { workspaceId: w } } }] }), selfRefs: ['parentId'] },
  { model: 'CustomField',       where: (w) => ({ project: { workspaceId: w } }) },
  { model: 'CustomFieldValue',  where: (w) => ({ customField: { project: { workspaceId: w } } }) },
  { model: 'Note',              where: (w) => ({ workspaceId: w }) },
  { model: 'CalendarEvent',     where: (w) => ({ project: { workspaceId: w } }) },
  { model: 'BudgetEntry',       where: (w) => ({ project: { workspaceId: w } }) },
  { model: 'Attachment',        where: (w) => ({ workspaceId: w }) },
  { model: 'Link',              where: (w) => ({ workspaceId: w }) },
  { model: 'Integration',       where: (w) => ({ workspaceId: w }) },
  { model: 'Canvas',            where: (w) => ({ workspaceId: w }) },
  // Модули: реестры, их записи и представления. Именно этого в архиве и не было.
  { model: 'Collection',        where: (w) => ({ project: { workspaceId: w } }) },
  { model: 'CollectionRecord',  where: (w) => ({ collection: { project: { workspaceId: w } } }) },
  { model: 'CollectionView',    where: (w) => ({ collection: { project: { workspaceId: w } } }) },
  { model: 'AutomationRule',    where: (w) => ({ project: { workspaceId: w } }) },
  // Личный рост.
  { model: 'Habit',             where: (w) => ({ workspaceId: w }) },
  { model: 'HabitEntry',        where: (w) => ({ habit: { workspaceId: w } }) },
  { model: 'Objective',         where: (w) => ({ workspaceId: w }) },
  { model: 'KeyResult',         where: (w) => ({ objective: { workspaceId: w } }) },
  // Дневник привязан к человеку, а не к пространству. В однопространственной
  // модели это одно и то же лицо — владелец. Без владельца выборка пуста.
  { model: 'JournalEntry',      where: (_w, owner) => (owner ? { userId: owner } : { userId: { in: [] } }), userRefs: ['userId'] },
  { model: 'AiConversation',    where: (w) => ({ workspaceId: w }) },
  { model: 'AiMessage',         where: (w) => ({ conversation: { workspaceId: w } }) },
  { model: 'AiProjectTemplate', where: (w) => ({ workspaceId: w }) },
  // Кому открыт доступ к проектам. На чужом инстансе этих людей нет — такие
  // строки отбрасываются при восстановлении.
  { model: 'ProjectMember',     where: (w) => ({ project: { workspaceId: w } }), userRefs: ['userId'] },
]

/**
 * Модели, которые в архив НЕ идут, и почему. Список существует не ради
 * документации: без него проверка полноты не отличит «решили не брать» от
 * «забыли».
 */
export const EXCLUDED: Record<string, string> = {
  Workspace: 'сам воркспейс пишется отдельно, до всего остального',
  User: 'люди принадлежат инстансу, а не пространству',
  WorkspaceMember: 'доступ к инстансу; восстанавливающий подключается сам',
  Invite: 'приглашение — это живой доступ, а не данные',
  ApiKey: 'секретный материал; восстановление выдало бы работающие ключи',
  AuditLog: 'журнал безопасности инстанса; перенос подделал бы историю',
  AiUsage: 'счётчик расхода; перенос исказил бы деньги',
  WalletTransaction: 'деньги',
  Notification: 'временное, теряет смысл вне момента',
  RecordEmbedding: 'производное от записей, пересчитывается',
  Module: 'каталог модулей принадлежит инстансу',
  AppSettings: 'настройки инстанса',
  LicenseKey: 'лицензии инстанса',
}

/** Модели схемы, о которых никто не принял решения. Пустой список — норма. */
export function unclassifiedModels(): string[] {
  const known = new Set([...SCOPED.map((s) => s.model), ...Object.keys(EXCLUDED)])
  return Prisma.dmmf.datamodel.models.map((m) => m.name).filter((n) => !known.has(n))
}

/** Имя модели → свойство клиента Prisma: `CollectionRecord` → `collectionRecord`. */
const accessor = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = { findMany: (a: any) => Promise<any[]>; createMany: (a: any) => Promise<{ count: number }>; update: (a: any) => Promise<unknown> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (prisma: PrismaClient, model: string): AnyDelegate => (prisma as any)[accessor(model)]

export interface WorkspaceDump {
  /** Строки по моделям, в порядке вставки. */
  models: Record<string, Record<string, unknown>[]>
  counts: Record<string, number>
}

/** Всё содержимое пространства, модель за моделью. */
export async function exportWorkspace(
  prisma: PrismaClient, workspaceId: string, ownerId: string | null,
): Promise<WorkspaceDump> {
  const models: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}
  for (const s of SCOPED) {
    const rows = await delegate(prisma, s.model).findMany({ where: s.where(workspaceId, ownerId) })
    models[s.model] = rows
    if (rows.length) counts[s.model] = rows.length
  }
  return { models, counts }
}

export interface ImportReport {
  restored: Record<string, number>
  /** Строки, отброшенные из-за отсутствующего на этом инстансе пользователя. */
  droppedForMissingUser: Record<string, number>
}

/**
 * Вставка в том же порядке, в каком выгружали. `skipDuplicates` делает повторное
 * восстановление безвредным: существующие строки остаются как есть, а не
 * затираются — человек восстанавливает, чтобы вернуть потерянное, а не чтобы
 * откатить то, что успел написать после.
 */
export async function importWorkspace(
  prisma: PrismaClient, dump: WorkspaceDump, restoringUserId: string,
): Promise<ImportReport> {
  const restored: Record<string, number> = {}
  const droppedForMissingUser: Record<string, number> = {}

  // Кто из упомянутых в архиве людей на этом инстансе есть.
  const mentioned = new Set<string>()
  for (const s of SCOPED) {
    if (!s.userRefs) continue
    for (const row of dump.models[s.model] ?? []) {
      for (const f of s.userRefs) {
        const v = row[f]
        if (typeof v === 'string') mentioned.add(v)
      }
    }
  }
  const present = new Set(
    mentioned.size
      ? (await prisma.user.findMany({ where: { id: { in: [...mentioned] } }, select: { id: true } })).map((u) => u.id)
      : [],
  )
  present.add(restoringUserId)

  for (const s of SCOPED) {
    const rows = dump.models[s.model] ?? []
    if (!rows.length) continue

    let usable = rows
    if (s.userRefs) {
      const before = usable.length
      usable = usable.filter((r) => s.userRefs!.every((f) => {
        const v = r[f]
        return typeof v !== 'string' || present.has(v)
      }))
      const dropped = before - usable.length
      if (dropped) droppedForMissingUser[s.model] = dropped
    }
    if (!usable.length) continue

    // Ссылки на собственную таблицу гасим — проставим, когда все строки лягут.
    const pending: { id: unknown; patch: Record<string, unknown> }[] = []
    const data = usable.map((r) => {
      if (!s.selfRefs) return r
      const copy = { ...r }
      const patch: Record<string, unknown> = {}
      for (const f of s.selfRefs) {
        if (copy[f] != null) { patch[f] = copy[f]; copy[f] = null }
      }
      if (Object.keys(patch).length) pending.push({ id: copy.id, patch })
      return copy
    })

    const res = await delegate(prisma, s.model).createMany({ data, skipDuplicates: true })
    restored[s.model] = res.count

    for (const { id, patch } of pending) {
      // Родитель мог не восстановиться (его отбросили) — тогда строка просто
      // остаётся без родителя, а не роняет всё.
      await delegate(prisma, s.model).update({ where: { id }, data: patch }).catch(() => null)
    }
  }

  return { restored, droppedForMissingUser }
}

/**
 * Проходит по секретным значениям записей реестров (Сейф и любой другой реестр
 * с полями типа `secret`). Возврат `null` из `fn` означает «это значение
 * непригодно» — оно удаляется, а не остаётся мусором: строка `encp:v1:…` в базе
 * показалась бы человеку как его пароль.
 */
export function mapRecordSecrets(
  dump: WorkspaceDump, fn: (value: string) => string | null,
): { total: number; changed: number; failed: number } {
  let total = 0, changed = 0, failed = 0
  for (const row of dump.models.CollectionRecord ?? []) {
    const data = row.data as Record<string, unknown> | undefined
    const sec = data?._sec as Record<string, unknown> | undefined
    if (!sec || typeof sec !== 'object') continue
    for (const [k, v] of Object.entries(sec)) {
      if (typeof v !== 'string' || !v) continue
      total++
      const next = fn(v)
      if (next === null) { failed++; delete sec[k] } else { sec[k] = next; changed++ }
    }
    if (data && Object.keys(sec).length === 0) delete data._sec
  }
  return { total, changed, failed }
}

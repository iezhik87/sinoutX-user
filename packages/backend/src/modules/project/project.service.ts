import { PrismaClient } from '@prisma/client'
import { CreateProjectInput, UpdateProjectInput } from './project.schema.js'
import { meili, INDEX_PAGES, INDEX_TASKS, INDEX_NOTES } from '../../lib/meilisearch.js'
import { deleteFile } from '../../lib/storage.js'
import { publish } from '../../lib/redis.js'

export class ProjectService {
  constructor(private prisma: PrismaClient) {}

  async listByWorkspace(workspaceId: string) {
    return this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { position: 'asc' },
      include: {
        _count: {
          select: {
            pages: { where: { type: 'PAGE', isDeleted: false } },
            tasks: { where: { isDeleted: false } },
            boards: true,
          },
        },
      },
    })
  }

  async getById(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        pages: {
          where: { isDeleted: false, isMemory: false },
          orderBy: { position: 'asc' },
          select: { id: true, title: true, icon: true, position: true, type: true, parentPageId: true },
        },
        boards: { select: { id: true, name: true } },
        _count: {
          select: {
            pages: { where: { type: 'PAGE', isDeleted: false } },
            tasks: { where: { isDeleted: false } },
            calendarEvents: true,
            budgetEntries: true,
          },
        },
      },
    })
  }

  async create(data: CreateProjectInput) {
    // Позиция = конец списка
    const lastProject = await this.prisma.project.findFirst({
      where: { workspaceId: data.workspaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    return this.prisma.project.create({
      data: { ...data, icon: data.icon ?? 'lucide:FolderKanban', position: (lastProject?.position ?? -1) + 1 },
    })
  }

  async update(id: string, data: UpdateProjectInput) {
    return this.prisma.project.update({ where: { id }, data })
  }

  async delete(id: string) {
    // Collect everything tied to the project up front.
    // Pages/tasks (and boards/events/budget) are removed by the DB FK cascade,
    // but notes & attachments use ON DELETE SET NULL — so they'd be orphaned,
    // not deleted. We delete them explicitly here (and purge MinIO + Meili),
    // so removing a project removes ALL of its content.
    const project = await this.prisma.project.findUnique({ where: { id }, select: { workspaceId: true } })
    const [pages, tasks, notes, attachments] = await Promise.all([
      this.prisma.page.findMany({ where: { projectId: id }, select: { id: true } }),
      this.prisma.task.findMany({ where: { projectId: id }, select: { id: true } }),
      this.prisma.note.findMany({ where: { projectId: id }, select: { id: true } }),
      this.prisma.attachment.findMany({ where: { projectId: id }, select: { id: true, storagePath: true, thumbnailPath: true } }),
    ])

    // Delete the project's notes & attachments (FK is SET NULL, so do it by projectId BEFORE the project is gone).
    await this.prisma.note.deleteMany({ where: { projectId: id } })
    await this.prisma.attachment.deleteMany({ where: { projectId: id } })

    // Remove the project — cascades pages, tasks, boards, calendar events, budget.
    const result = await this.prisma.project.delete({ where: { id } })

    // Best-effort cleanup of external stores (never block deletion on these).
    for (const a of attachments) {
      if (a.storagePath) deleteFile(a.storagePath).catch(() => {})
      if (a.thumbnailPath) deleteFile(a.thumbnailPath).catch(() => {})
    }
    if (pages.length) meili.index(INDEX_PAGES).deleteDocuments(pages.map((p) => p.id)).catch(() => {})
    if (tasks.length) meili.index(INDEX_TASKS).deleteDocuments(tasks.map((t) => t.id)).catch(() => {})
    if (notes.length) meili.index(INDEX_NOTES).deleteDocuments(notes.map((n) => n.id)).catch(() => {})

    // Remove dangling idea-canvas nodes that referenced the deleted entities.
    // Canvases are workspace-scoped, so a deleted project's pages/tasks/notes/
    // files would otherwise leave nodes that point at nothing.
    if (project?.workspaceId) {
      const deletedIds = new Set<string>([
        ...pages.map((p) => p.id),
        ...tasks.map((t) => t.id),
        ...notes.map((n) => n.id),
        ...attachments.map((a) => a.id),
      ])
      const canvases = await this.prisma.canvas.findMany({ where: { workspaceId: project.workspaceId } })
      for (const c of canvases) {
        const nodes = Array.isArray(c.nodes) ? (c.nodes as Record<string, unknown>[]) : []
        const kept = nodes.filter((n) => {
          const data = (n.data ?? {}) as Record<string, unknown>
          const entityId = data.entityId as string | undefined
          return !(entityId && deletedIds.has(entityId))
        })
        if (kept.length !== nodes.length) {
          const keptIds = new Set(kept.map((n) => n.id as string))
          const edges = Array.isArray(c.edges) ? (c.edges as Record<string, unknown>[]) : []
          const keptEdges = edges.filter((e) => keptIds.has(e.source as string) && keptIds.has(e.target as string))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await this.prisma.canvas.update({ where: { id: c.id }, data: { nodes: kept as any, edges: keptEdges as any } })
          publish({ type: 'canvas.updated', workspaceId: project.workspaceId, canvasId: c.id }).catch(() => null)
        }
      }
    }

    return result
  }

  async reorder(workspaceId: string, ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.project.update({
          where: { id, workspaceId },
          data: { position },
        }),
      ),
    )
  }
}

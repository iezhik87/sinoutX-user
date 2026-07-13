import { PrismaClient, Prisma } from '@prisma/client'
import { CreatePageInput, UpdatePageInput } from './page.schema.js'

export type AttachmentLeaf = {
  id: string
  filename: string
  mimeType: string
  size: number
  description: string | null
  metadata: unknown
  createdAt: Date
  nodeType: 'attachment'
}

// Рекурсивный тип для дерева страниц
export type PageTreeNode = {
  id: string
  title: string
  icon: string | null
  position: number
  type: string
  children: PageTreeNode[]
  attachments: AttachmentLeaf[]
}

export class PageService {
  constructor(private prisma: PrismaClient) {}

  /** Плоский список страниц проекта */
  async listByProject(projectId: string) {
    return this.prisma.page.findMany({
      where: { projectId, isDeleted: false },
      orderBy: [{ parentPageId: 'asc' }, { position: 'asc' }],
      select: {
        id: true,
        title: true,
        icon: true,
        coverImage: true,
        type: true,
        position: true,
        parentPageId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  /** Дерево страниц (для NavigationTree) */
  async getTree(projectId: string): Promise<PageTreeNode[]> {
    const [pages, attachments] = await Promise.all([
      this.prisma.page.findMany({
        where: { projectId, isDeleted: false },
        orderBy: { position: 'asc' },
        select: { id: true, title: true, icon: true, position: true, type: true, parentPageId: true, isMemory: true },
      }),
      this.prisma.attachment.findMany({
        where: { projectId, pageId: { not: null } },
        select: { id: true, filename: true, mimeType: true, size: true, description: true, metadata: true, createdAt: true, pageId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    // Group attachments by pageId
    const attachByPage = new Map<string, AttachmentLeaf[]>()
    for (const a of attachments) {
      if (!a.pageId) continue
      if (!attachByPage.has(a.pageId)) attachByPage.set(a.pageId, [])
      attachByPage.get(a.pageId)!.push({ ...a, nodeType: 'attachment' as const })
    }

    const byParent = new Map<string | null, typeof pages>()
    for (const p of pages) {
      const key = p.parentPageId ?? null
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key)!.push(p)
    }

    const buildTree = (parentId: string | null): PageTreeNode[] =>
      (byParent.get(parentId) ?? [])
        .sort((a, b) => {
          const aIsFolder = (a.type as string) === 'FOLDER'
          const bIsFolder = (b.type as string) === 'FOLDER'
          if (aIsFolder && !bIsFolder) return -1
          if (!aIsFolder && bIsFolder) return 1
          return a.position - b.position
        })
        .map((p) => ({
          ...p,
          attachments: attachByPage.get(p.id) ?? [],
          children: buildTree(p.id),
        }))

    return buildTree(null)
  }

  /** Страница с контентом */
  async getById(id: string) {
    return this.prisma.page.findUnique({
      where: { id },
      include: {
        children: {
          where: { isDeleted: false },
          orderBy: { position: 'asc' },
          select: { id: true, title: true, icon: true, position: true },
        },
      },
    })
  }

  async create(data: CreatePageInput) {
    const lastPage = await this.prisma.page.findFirst({
      where: { projectId: data.projectId, parentPageId: data.parentPageId ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    return this.prisma.page.create({
      data: {
        projectId: data.projectId,
        parentPageId: data.parentPageId ?? null,
        title: data.title,
        icon: data.icon ?? (data.type === 'FOLDER' ? 'lucide:Folder' : 'lucide:FileText'),
        type: data.type,
        content: (data.content as Prisma.InputJsonValue) ?? { type: 'doc', content: [] },
        position: (lastPage?.position ?? -1) + 1,
      },
    })
  }

  async update(id: string, data: UpdatePageInput, savedBy?: string) {
    // Save a version snapshot before updating (only when content or title changes)
    if (data.title !== undefined || data.content !== undefined) {
      const current = await this.prisma.page.findUnique({ where: { id } })
      if (current) {
        // Fire and forget — don't block the update
        this._saveVersion(id, current.title, current.content, savedBy).catch(() => null)
      }
    }

    const updateData: Prisma.PageUpdateInput = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.icon !== undefined) updateData.icon = data.icon
    if (data.coverImage !== undefined) updateData.coverImage = data.coverImage
    if (data.content !== undefined) {
      updateData.content = data.content as Prisma.InputJsonValue
      // Pages are edited collaboratively (Yjs): the editor loads yjsState, not
      // content. A direct content write must drop yjsState so the next open
      // re-seeds from this fresh content (else the change is invisible in the
      // editor — though visible in DOCX export — and gets clobbered by the
      // stale Yjs state). The collab server itself writes both together.
      updateData.yjsState = null
    }
    if (data.parentPageId !== undefined) updateData.parentPage = data.parentPageId
      ? { connect: { id: data.parentPageId } }
      : { disconnect: true }
    if (data.position !== undefined) updateData.position = data.position

    return this.prisma.page.update({ where: { id }, data: updateData })
  }

  private async _saveVersion(pageId: string, title: string, content: unknown, savedBy?: string) {
    const latest = await this.prisma.pageVersion.findFirst({
      where: { pageId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const version = (latest?.version ?? 0) + 1
    await this.prisma.pageVersion.create({
      data: { pageId, title, content: content as object, version, savedBy },
    })
    // Keep last 50 versions
    const old = await this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { version: 'desc' },
      skip: 50,
      select: { id: true },
    })
    if (old.length > 0) {
      await this.prisma.pageVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } })
    }
  }

  /** Мягкое удаление */
  async delete(id: string) {
    // Помечаем страницу и всех потомков как удалённые
    await this.prisma.$executeRaw`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${id}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_page_id = d.id
      )
      UPDATE pages SET is_deleted = true WHERE id IN (SELECT id FROM descendants)
    `
  }

  async reorder(projectId: string, parentPageId: string | null, ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.page.update({
          where: { id, projectId },
          data: { position },
        }),
      ),
    )
  }
}

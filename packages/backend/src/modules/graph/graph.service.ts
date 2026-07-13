import { PrismaClient, Prisma } from '@prisma/client'

export interface GraphNode {
  id: string
  type: 'page' | 'task' | 'note' | 'attachment' | 'folder'
  label: string
  icon?: string | null
  projectId?: string
  data?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  sourceType: string
  targetType: string
  linkType: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function extractNoteTitle(content: unknown): string {
  try {
    function walk(node: Record<string, unknown>): string {
      if (node.type === 'text' && typeof node.text === 'string' && node.text.trim()) {
        return node.text.trim().slice(0, 60)
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content as Record<string, unknown>[]) {
          const t = walk(child)
          if (t) return t
        }
      }
      return ''
    }
    return walk(content as Record<string, unknown>)
  } catch { return '' }
}

export class GraphService {
  constructor(private prisma: PrismaClient) {}

  /** Граф для всего workspace или конкретного проекта */
  async getGraph(opts: { workspaceId: string; projectId?: string }): Promise<GraphData> {
    const { workspaceId, projectId } = opts

    // ── 1. Загружаем страницы ─────────────────────────────────────────────────
    const pages = await this.prisma.page.findMany({
      where: {
        isDeleted: false,
        isMemory: false,
        ...(projectId
          ? { projectId }
          : { project: { workspaceId } }),
      },
      select: {
        id: true, title: true, icon: true, type: true,
        projectId: true, parentPageId: true,
      },
    })

    const pageIdSet = new Set(pages.map((p) => p.id))

    // ── 2. Все задачи проекта / workspace ────────────────────────────────────
    const allTasks = await this.prisma.task.findMany({
      where: {
        isDeleted: false,
        ...(projectId ? { projectId } : { project: { workspaceId } }),
      },
      select: {
        id: true, title: true, projectId: true,
        pageId: true, status: true, priority: true,
      },
    })

    // ── 3. Заметки проекта / workspace напрямую через projectId ─────────────
    const notes = await this.prisma.note.findMany({
      where: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
      },
      select: { id: true, content: true, projectId: true, pinned: true },
    })

    // Также явные page-to-page ссылки из Link (DEPENDS_ON / BLOCKS / RELATED)
    const explicitLinks = await this.prisma.link.findMany({
      where: {
        workspaceId,
        sourceType: 'page',
        targetType: 'page',
        linkType: { in: ['DEPENDS_ON', 'BLOCKS', 'RELATED'] },
      },
    })
    // Оставляем только те, чьи ноды есть в графе
    const filteredExplicit = explicitLinks.filter(
      (l) => pageIdSet.has(l.sourceId) && pageIdSet.has(l.targetId),
    )

    // ── 4. Собираем ноды ──────────────────────────────────────────────────────
    const nodes: GraphNode[] = [
      ...pages.map((p) => ({
        id: p.id,
        type: (p.type === 'FOLDER' ? 'folder' : 'page') as GraphNode['type'],
        label: p.title,
        icon: p.icon,
        projectId: p.projectId,
        data: { pageType: p.type },
      })),
      ...allTasks.map((t) => ({
        id: t.id,
        type: 'task' as const,
        label: t.title,
        projectId: t.projectId,
        data: { status: t.status, priority: t.priority, pageId: t.pageId },
      })),
      ...notes.map((n) => ({
        id: n.id,
        type: 'note' as const,
        label: extractNoteTitle(n.content) || 'Заметка',
        projectId: n.projectId ?? undefined,
        data: { pinned: n.pinned },
      })),
    ]

    // ── 5. Собираем рёбра ─────────────────────────────────────────────────────
    const edges: GraphEdge[] = []

    // Иерархия: родитель→дочерняя страница (только если оба в графе)
    for (const page of pages) {
      if (page.parentPageId && pageIdSet.has(page.parentPageId)) {
        edges.push({
          id: `hierarchy-${page.id}`,
          source: page.parentPageId,
          target: page.id,
          sourceType: 'page',
          targetType: 'page',
          linkType: 'HIERARCHY',
        })
      }
    }

    // Страница→задача (только задачи с явным pageId)
    for (const task of allTasks) {
      if (task.pageId && pageIdSet.has(task.pageId)) {
        edges.push({
          id: `task-${task.id}`,
          source: task.pageId,
          target: task.id,
          sourceType: 'page',
          targetType: 'task',
          linkType: 'TASK',
        })
      }
    }

    // Явные page-to-page связи (DEPENDS_ON / BLOCKS / RELATED)
    for (const link of filteredExplicit) {
      edges.push({
        id: link.id,
        source: link.sourceId,
        target: link.targetId,
        sourceType: 'page',
        targetType: 'page',
        linkType: link.linkType,
      })
    }

    return { nodes, edges }
  }

  /** Определяет workspaceId по типу и id сущности */
  async resolveWorkspaceId(entityType: string, entityId: string): Promise<string | null> {
    if (entityType === 'page') {
      const page = await this.prisma.page.findUnique({ where: { id: entityId }, select: { projectId: true } })
      if (!page) return null
      const project = await this.prisma.project.findUnique({ where: { id: page.projectId }, select: { workspaceId: true } })
      return project?.workspaceId ?? null
    }
    if (entityType === 'task') {
      const task = await this.prisma.task.findUnique({ where: { id: entityId }, select: { projectId: true } })
      if (!task) return null
      const project = await this.prisma.project.findUnique({ where: { id: task.projectId }, select: { workspaceId: true } })
      return project?.workspaceId ?? null
    }
    if (entityType === 'note') {
      const note = await this.prisma.note.findUnique({ where: { id: entityId }, select: { workspaceId: true } })
      return note?.workspaceId ?? null
    }
    if (entityType === 'attachment') {
      const att = await this.prisma.attachment.findUnique({ where: { id: entityId }, select: { workspaceId: true } })
      return att?.workspaceId ?? null
    }
    if (entityType === 'record') {
      const rec = await this.prisma.collectionRecord.findUnique({ where: { id: entityId }, select: { collectionId: true } })
      if (!rec) return null
      const col = await this.prisma.collection.findUnique({ where: { id: rec.collectionId }, select: { projectId: true } })
      if (!col) return null
      const project = await this.prisma.project.findUnique({ where: { id: col.projectId }, select: { workspaceId: true } })
      return project?.workspaceId ?? null
    }
    if (entityType === 'collection') {
      const col = await this.prisma.collection.findUnique({ where: { id: entityId }, select: { projectId: true } })
      if (!col) return null
      const project = await this.prisma.project.findUnique({ where: { id: col.projectId }, select: { workspaceId: true } })
      return project?.workspaceId ?? null
    }
    return null
  }

  /** Создать связь между сущностями */
  async createLink(data: {
    workspaceId: string
    sourceType: string
    sourceId: string
    targetType: string
    targetId: string
    linkType: 'REFERENCE' | 'EMBED' | 'DEPENDS_ON' | 'BLOCKS' | 'RELATED'
    metadata?: Record<string, unknown>
  }) {
    return this.prisma.link.create({
      data: {
        workspaceId: data.workspaceId,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        linkType: data.linkType,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
  }

  async deleteLink(id: string) {
    return this.prisma.link.delete({ where: { id } })
  }

  /**
   * Сканирует TipTap-контент страницы на предмет entityRef-нод
   * и создаёт/удаляет соответствующие graph-связи (REFERENCE).
   */
  async syncContentLinks(pageId: string) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, projectId: true, content: true },
    })
    if (!page) return

    const project = await this.prisma.project.findUnique({
      where: { id: page.projectId },
      select: { workspaceId: true },
    })
    if (!project) return

    const refs: Array<{ entityType: string; entityId: string }> = []
    const PAGE_LINK_RE = /\/pages\/([a-z0-9]+)$/i
    function walk(node: Record<string, unknown>) {
      if (node.type === 'entityRef' && node.attrs) {
        const attrs = node.attrs as Record<string, unknown>
        if (attrs.entityId && attrs.entityType) {
          refs.push({ entityType: String(attrs.entityType), entityId: String(attrs.entityId) })
        }
      }
      if (Array.isArray(node.marks)) {
        for (const mark of node.marks as Record<string, unknown>[]) {
          if (mark.type === 'link') {
            const href = (mark.attrs as Record<string, unknown>)?.href as string | undefined
            if (href) {
              const m = PAGE_LINK_RE.exec(href)
              if (m) refs.push({ entityType: 'page', entityId: m[1] })
            }
          }
        }
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content as Record<string, unknown>[]) walk(child)
      }
    }
    walk(page.content as Record<string, unknown>)

    const existing = await this.prisma.link.findMany({
      where: { sourceType: 'page', sourceId: pageId, linkType: 'REFERENCE' },
    })

    const refSet = new Set(refs.map((r) => `${r.entityType}:${r.entityId}`))
    const existingSet = new Set(existing.map((l) => `${l.targetType}:${l.targetId}`))

    const toDelete = existing.filter((l) => !refSet.has(`${l.targetType}:${l.targetId}`))
    if (toDelete.length > 0) {
      await this.prisma.link.deleteMany({ where: { id: { in: toDelete.map((l) => l.id) } } })
    }

    const toCreate = refs.filter((r) => !existingSet.has(`${r.entityType}:${r.entityId}`))
    for (const ref of toCreate) {
      await this.prisma.link.create({
        data: {
          workspaceId: project.workspaceId,
          sourceType: 'page',
          sourceId: pageId,
          targetType: ref.entityType,
          targetId: ref.entityId,
          linkType: 'REFERENCE',
          metadata: {},
        },
      })
    }
  }

  /** Получить все связи конкретной ноды */
  async getNodeLinks(nodeType: string, nodeId: string) {
    return this.prisma.link.findMany({
      where: {
        OR: [
          { sourceType: nodeType, sourceId: nodeId },
          { targetType: nodeType, targetId: nodeId },
        ],
      },
    })
  }

  /** Все страницы, которые ссылаются на данную страницу */
  async getBacklinks(pageId: string) {
    const links = await this.prisma.link.findMany({
      where: { targetType: 'page', targetId: pageId, sourceType: 'page' },
      select: { sourceId: true },
    })
    const linkedPageIds = [...new Set(links.map((l) => l.sourceId))]

    const searched = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM pages
      WHERE is_deleted = false
        AND id != ${pageId}
        AND content::text ILIKE ${`%/pages/${pageId}%`}
    `
    const searchedIds = searched.map((r) => r.id)

    const allIds = [...new Set([...linkedPageIds, ...searchedIds])]
    if (allIds.length === 0) return []

    return this.prisma.page.findMany({
      where: { id: { in: allIds }, isDeleted: false },
      select: {
        id: true,
        title: true,
        projectId: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }
}

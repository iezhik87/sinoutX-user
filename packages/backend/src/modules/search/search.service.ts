import { PrismaClient } from '@prisma/client'
import {
  meili,
  INDEX_PAGES,
  INDEX_TASKS,
  INDEX_NOTES,
  extractText,
} from '../../lib/meilisearch.js'

export interface SearchResult {
  id: string
  type: 'page' | 'task' | 'note'
  title: string
  snippet?: string        // highlighted text excerpt
  projectId?: string
  workspaceId?: string
  icon?: string | null
  status?: string
  priority?: string
  updatedAt?: string
}

export interface SearchHits {
  results: SearchResult[]
  query: string
  totalHits: number
}

export class SearchService {
  constructor(private prisma: PrismaClient) {}

  /** Полнотекстовый поиск по всем индексам */
  async search(
    query: string,
    opts: {
      workspaceId?: string
      projectId?: string
      types?: ('page' | 'task' | 'note')[]
      limit?: number
    } = {},
  ): Promise<SearchHits> {
    const { workspaceId, projectId, types = ['page', 'task', 'note'], limit = 20 } = opts

    const perIndex = Math.ceil(limit / types.length)
    const results: SearchResult[] = []

    await Promise.all([
      types.includes('page') &&
        meili
          .index(INDEX_PAGES)
          .search(query, {
            limit: perIndex,
            filter: [
              'isDeleted = false',
              projectId ? `projectId = ${projectId}` : workspaceId ? `workspaceId = ${workspaceId}` : null,
            ].filter(Boolean) as string[],
            attributesToCrop: ['textContent'],
            cropLength: 30,
            attributesToHighlight: ['title', 'textContent'],
            highlightPreTag: '==',
            highlightPostTag: '==',
          })
          .then((res) => {
            for (const hit of res.hits) {
              const fmt = (hit as Record<string, unknown>)._formatted as Record<string, string> | undefined
              results.push({
                id: hit.id as string,
                type: 'page',
                title: (hit.title as string) ?? 'Без названия',
                snippet: fmt?.textContent?.trim() || undefined,
                projectId: hit.projectId as string,
                workspaceId: hit.workspaceId as string,
                icon: hit.icon as string | null,
                updatedAt: hit.updatedAt as string,
              })
            }
          })
          .catch(() => null),

      types.includes('task') &&
        meili
          .index(INDEX_TASKS)
          .search(query, {
            limit: perIndex,
            filter: [
              'isDeleted = false',
              projectId ? `projectId = ${projectId}` : null,
            ].filter(Boolean) as string[],
            attributesToHighlight: ['title'],
            highlightPreTag: '==',
            highlightPostTag: '==',
          })
          .then((res) => {
            for (const hit of res.hits) {
              results.push({
                id: hit.id as string,
                type: 'task',
                title: hit.title as string,
                projectId: hit.projectId as string,
                status: hit.status as string,
                priority: hit.priority as string,
                updatedAt: hit.updatedAt as string,
              })
            }
          })
          .catch(() => null),

      types.includes('note') &&
        meili
          .index(INDEX_NOTES)
          .search(query, {
            limit: perIndex,
            filter: [
              workspaceId ? `workspaceId = ${workspaceId}` : null,
              projectId ? `projectId = ${projectId}` : null,
            ].filter(Boolean) as string[],
            attributesToCrop: ['textContent'],
            cropLength: 30,
            attributesToHighlight: ['textContent'],
            highlightPreTag: '==',
            highlightPostTag: '==',
          })
          .then((res) => {
            for (const hit of res.hits) {
              const fmt = (hit as Record<string, unknown>)._formatted as Record<string, string> | undefined
              const snippet = fmt?.textContent?.trim() || ((hit.textContent as string) ?? '').slice(0, 80)
              results.push({
                id: hit.id as string,
                type: 'note',
                title: snippet.replace(/==/g, '').slice(0, 60) || 'Заметка',
                snippet,
                workspaceId: hit.workspaceId as string,
                updatedAt: hit.updatedAt as string,
              })
            }
          })
          .catch(() => null),
    ])

    return {
      results: results.slice(0, limit),
      query,
      totalHits: results.length,
    }
  }

  /** Индексировать страницу */
  async indexPage(pageId: string) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      include: { project: { select: { workspaceId: true } } },
    })
    if (!page) return

    await meili.index(INDEX_PAGES).addDocuments([
      {
        id: page.id,
        title: page.title,
        textContent: extractText(page.content as Record<string, unknown>),
        projectId: page.projectId,
        workspaceId: page.project.workspaceId,
        icon: page.icon,
        isDeleted: page.isDeleted,
        updatedAt: page.updatedAt.toISOString(),
      },
    ])
  }

  /** Индексировать задачу */
  async indexTask(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return

    await meili.index(INDEX_TASKS).addDocuments([
      {
        id: task.id,
        title: task.title,
        projectId: task.projectId,
        status: task.status,
        priority: task.priority,
        isDeleted: task.isDeleted,
        dueDate: task.dueDate?.toISOString() ?? null,
        updatedAt: task.updatedAt.toISOString(),
      },
    ])
  }

  /** Полная переиндексация всех данных */
  async reindexAll() {
    const [pages, tasks, notes] = await this.prisma.$transaction([
      this.prisma.page.findMany({
        where: { isDeleted: false },
        include: { project: { select: { workspaceId: true } } },
      }),
      this.prisma.task.findMany({
        where: { isDeleted: false },
      }),
      this.prisma.note.findMany(),
    ])

    if (pages.length) {
      await meili.index(INDEX_PAGES).addDocuments(
        pages.map((p) => ({
          id: p.id,
          title: p.title,
          textContent: extractText(p.content as Record<string, unknown>),
          projectId: p.projectId,
          workspaceId: p.project.workspaceId,
          icon: p.icon,
          isDeleted: p.isDeleted,
          updatedAt: p.updatedAt.toISOString(),
        })),
      )
    }

    if (tasks.length) {
      await meili.index(INDEX_TASKS).addDocuments(
        tasks.map((t) => ({
          id: t.id,
          title: t.title,
          projectId: t.projectId,
          status: t.status,
          priority: t.priority,
          isDeleted: t.isDeleted,
          dueDate: t.dueDate?.toISOString() ?? null,
          updatedAt: t.updatedAt.toISOString(),
        })),
      )
    }

    if (notes.length) {
      await meili.index(INDEX_NOTES).addDocuments(
        notes.map((n) => ({
          id: n.id,
          textContent: extractText(n.content as Record<string, unknown>),
          workspaceId: n.workspaceId,
          projectId: n.projectId ?? null,
          updatedAt: n.updatedAt.toISOString(),
        })),
      )
    }

    return { pages: pages.length, tasks: tasks.length, notes: notes.length }
  }
}

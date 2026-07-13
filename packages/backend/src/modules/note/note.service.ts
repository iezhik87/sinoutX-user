import { PrismaClient, Prisma } from '@prisma/client'
import { CreateNoteInput, UpdateNoteInput, ListNotesQuery } from './note.schema.js'
import { meili, INDEX_NOTES, extractText } from '../../lib/meilisearch.js'

export class NoteService {
  constructor(private prisma: PrismaClient) {}

  async list(query: ListNotesQuery) {
    const where: Prisma.NoteWhereInput = {}
    if (query.workspaceId) where.workspaceId = query.workspaceId
    if (query.projectId) {
      where.projectId = query.projectId
    } else if (query.workspaceId) {
      // Показываем только: workspace-заметки (projectId null) ИЛИ заметки
      // чей проект реально существует в этом workspace
      where.OR = [
        { projectId: null },
        { project: { workspaceId: query.workspaceId } },
      ]
    }
    if (query.pinned !== undefined) where.pinned = query.pinned
    if (query.tags?.length) where.tags = { hasSome: query.tags }

    return this.prisma.note.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    })
  }

  async getById(id: string) {
    return this.prisma.note.findUnique({ where: { id } })
  }

  async create(data: CreateNoteInput) {
    const note = await this.prisma.note.create({
      data: {
        workspaceId: data.workspaceId,
        projectId: data.projectId ?? null,
        content: data.content as Prisma.InputJsonValue,
        tags: data.tags,
        pinned: data.pinned,
        color: data.color ?? null,
      },
    })

    // Индексируем в Meilisearch
    meili.index(INDEX_NOTES).addDocuments([{
      id: note.id,
      textContent: extractText(note.content as Record<string, unknown>),
      workspaceId: note.workspaceId,
      projectId: note.projectId ?? null,
      updatedAt: note.updatedAt.toISOString(),
    }]).catch(() => null)

    return note
  }

  async update(id: string, data: UpdateNoteInput) {
    const note = await this.prisma.note.update({
      where: { id },
      data: {
        content: data.content as Prisma.InputJsonValue | undefined,
        tags: data.tags,
        pinned: data.pinned,
        color: data.color,
        projectId: data.projectId,
      },
    })

    // Переиндексируем
    meili.index(INDEX_NOTES).addDocuments([{
      id: note.id,
      textContent: extractText(note.content as Record<string, unknown>),
      workspaceId: note.workspaceId,
      projectId: note.projectId ?? null,
      updatedAt: note.updatedAt.toISOString(),
    }]).catch(() => null)

    return note
  }

  async delete(id: string) {
    await this.prisma.note.delete({ where: { id } })
    meili.index(INDEX_NOTES).deleteDocument(id).catch(() => null)
  }
}

import { PrismaClient, Prisma } from '@prisma/client'
import { CreateEventInput, UpdateEventInput, ListEventsQuery } from './calendar.schema.js'

export class CalendarService {
  constructor(private prisma: PrismaClient) {}

  async list(query: ListEventsQuery) {
    const where: Prisma.CalendarEventWhereInput = {}
    if (query.projectId) where.projectId = query.projectId
    if (query.from || query.to) {
      where.startAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }
    // Если workspaceId — ищем по всем проектам workspace
    if (query.workspaceId && !query.projectId) {
      where.project = { workspaceId: query.workspaceId }
    }
    return this.prisma.calendarEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: { project: { select: { id: true, name: true, color: true } } },
    })
  }

  async getById(id: string) {
    return this.prisma.calendarEvent.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true, color: true } } },
    })
  }

  async create(data: CreateEventInput) {
    return this.prisma.calendarEvent.create({
      data: {
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        startAt: new Date(data.startAt),
        endAt: data.endAt ? new Date(data.endAt) : null,
        allDay: data.allDay,
        isRecurring: data.isRecurring,
        recurrenceRule: data.recurrenceRule,
        reminderAt: data.reminderAt.map((d) => new Date(d)),
        linkedDocuments: data.linkedDocuments as Prisma.InputJsonValue,
        color: data.color,
        location: data.location,
      },
    })
  }

  async update(id: string, data: UpdateEventInput) {
    return this.prisma.calendarEvent.update({
      where: { id },
      data: {
        ...data,
        startAt: data.startAt ? new Date(data.startAt) : undefined,
        endAt: data.endAt !== undefined ? (data.endAt ? new Date(data.endAt) : null) : undefined,
        reminderAt: data.reminderAt?.map((d) => new Date(d)),
        linkedDocuments: data.linkedDocuments as Prisma.InputJsonValue | undefined,
      },
    })
  }

  async delete(id: string) {
    return this.prisma.calendarEvent.delete({ where: { id } })
  }

  /** Ближайшие события (для дашборда) */
  async getUpcoming(workspaceId: string, limit = 5) {
    return this.prisma.calendarEvent.findMany({
      where: {
        project: { workspaceId },
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: 'asc' },
      take: limit,
      include: { project: { select: { name: true, color: true } } },
    })
  }
}

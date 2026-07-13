import { PrismaClient, Prisma } from '@prisma/client'
import { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from './task.schema.js'
import { NotificationService } from '../notification/notification.service.js'

const taskInclude = {
  tags: { include: { tag: true } },
  subtasks: {
    where: { isDeleted: false },
    select: { id: true, title: true, status: true, priority: true },
    orderBy: { position: 'asc' as const },
  },
  _count: { select: { subtasks: true } },
}

export class TaskService {
  private notifService: NotificationService
  constructor(private prisma: PrismaClient) {
    this.notifService = new NotificationService(prisma)
  }

  async list(query: ListTasksQuery) {
    const where: Prisma.TaskWhereInput = { isDeleted: false }

    if (query.projectId) where.projectId = query.projectId
    if (query.workspaceId) where.project = { workspaceId: query.workspaceId }
    if (query.boardId) where.boardId = query.boardId
    if (query.boardColumnId !== undefined) where.boardColumnId = query.boardColumnId
    if (query.status) where.status = query.status
    if (query.priority) where.priority = query.priority
    if (query.assignee) where.assignee = query.assignee
    if (query.tagId) where.tags = { some: { tagId: query.tagId } }
    if (query.parentTaskId !== undefined) where.parentTaskId = query.parentTaskId
    if (query.hasDueDate) where.dueDate = { not: null }

    const skip = (query.page - 1) * query.limit
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        include: taskInclude,
        skip,
        take: query.limit,
      }),
      this.prisma.task.count({ where }),
    ])

    return { items, total, page: query.page, limit: query.limit }
  }

  async getById(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        parentTask: { select: { id: true, title: true } },
        page: { select: { id: true, title: true } },
        board: { select: { id: true, name: true } },
      },
    })
  }

  async create(data: CreateTaskInput) {
    const { tagIds, ...rest } = data

    const lastTask = await this.prisma.task.findFirst({
      where: {
        projectId: data.projectId,
        boardId: data.boardId ?? null,
        boardColumnId: data.boardColumnId ?? null,
      },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = await this.prisma.task.create({
      data: {
        ...rest,
        dueDate: rest.dueDate ? new Date(rest.dueDate) : null,
        startDate: rest.startDate ? new Date(rest.startDate) : null,
        reminderAt: rest.reminderAt.map((d) => new Date(d)),
        position: (lastTask?.position ?? -1) + 1,
        tags: tagIds.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      } as any, // eslint-disable-line
      include: taskInclude,
    })

    // Broadcast notification to workspace (fire-and-forget)
    this.prisma.project.findUnique({ where: { id: data.projectId }, select: { workspaceId: true } })
      .then((project) => {
        if (!project) return
        return this.notifService.create({
          workspaceId: project.workspaceId,
          type: 'task',
          title: `Новая задача: ${task.title}`,
          link: `/projects/${data.projectId}/tasks?taskId=${task.id}`,
        })
      })
      .catch(() => null)

    return task
  }

  async update(id: string, data: UpdateTaskInput) {
    const { tagIds, ...rest } = data

    return this.prisma.$transaction(async (tx) => {
      // Обновляем теги если переданы
      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: id } })
        if (tagIds.length) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId) => ({ taskId: id, tagId })),
          })
        }
      }

      return tx.task.update({
        where: { id },
        data: {
          ...rest,
          dueDate: rest.dueDate !== undefined ? (rest.dueDate ? new Date(rest.dueDate) : null) : undefined,
          startDate: rest.startDate !== undefined ? (rest.startDate ? new Date(rest.startDate) : null) : undefined,
          reminderAt: rest.reminderAt?.map((d) => new Date(d)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        include: taskInclude,
      })
    })
  }

  async delete(id: string) {
    return this.prisma.task.update({ where: { id }, data: { isDeleted: true } })
  }

  /** Перемещение задачи между колонками + reorder */
  async moveToColumn(
    id: string,
    boardId: string,
    boardColumnId: string,
    position: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Сдвигаем задач�� в целевой колонке
      await tx.task.updateMany({
        where: { boardId, boardColumnId, position: { gte: position }, isDeleted: false },
        data: { position: { increment: 1 } },
      })
      return tx.task.update({
        where: { id },
        data: { boardId, boardColumnId, position },
        include: taskInclude,
      })
    })
  }

  async getAnalytics(projectId: string) {
    const [byStatus, byPriority, overdue] = await this.prisma.$transaction([
      this.prisma.task.groupBy({
        by: ['status'],
        where: { projectId, isDeleted: false },
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.task.groupBy({
        by: ['priority'],
        where: { projectId, isDeleted: false },
        orderBy: { priority: 'asc' },
        _count: true,
      }),
      this.prisma.task.count({
        where: {
          projectId,
          isDeleted: false,
          dueDate: { lt: new Date() },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
      }),
    ])

    return { byStatus, byPriority, overdue }
  }
}

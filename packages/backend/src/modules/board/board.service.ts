import { PrismaClient, Prisma } from '@prisma/client'
import { CreateBoardInput, UpdateBoardInput } from './board.schema.js'

export class BoardService {
  constructor(private prisma: PrismaClient) {}

  async listByProject(projectId: string) {
    return this.prisma.board.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { tasks: { where: { isDeleted: false } } } },
      },
    })
  }

  async getById(id: string) {
    const board = await this.prisma.board.findUnique({ where: { id } })
    if (!board) return null

    // All project tasks — both assigned to this board and unassigned (no boardId)
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId: board.projectId,
        isDeleted: false,
        OR: [
          { boardId: id },
          { boardId: null },
        ],
      },
      orderBy: { position: 'asc' },
      include: {
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        _count: { select: { subtasks: { where: { isDeleted: false } } } },
      },
    })

    const cols = (board.columns as { id: string; name: string; color?: string; position: number; wipLimit?: number | null }[])
      .sort((a, b) => a.position - b.position)

    const columns = cols.map((col, idx) => ({
      ...col,
      tasks: tasks.filter((t) => {
        if (t.boardColumnId === col.id) return true
        // Unassigned tasks go into the first column
        if (idx === 0 && !t.boardColumnId) return true
        return false
      }),
    }))

    return { ...board, columns }
  }

  async create(data: CreateBoardInput) {
    return this.prisma.board.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        columns: data.columns as unknown as Prisma.InputJsonValue,
      },
    })
  }

  async update(id: string, data: UpdateBoardInput) {
    return this.prisma.board.update({
      where: { id },
      data: {
        name: data.name,
        columns: data.columns as unknown as Prisma.InputJsonValue | undefined,
      },
    })
  }

  async delete(id: string) {
    return this.prisma.board.delete({ where: { id } })
  }

  /** Reorder задач внутри колонки */
  async reorderColumn(boardId: string, columnId: string, taskIds: string[]) {
    await this.prisma.$transaction(
      taskIds.map((taskId, position) =>
        this.prisma.task.update({
          where: { id: taskId },
          data: { boardId, boardColumnId: columnId, position },
        }),
      ),
    )
  }
}

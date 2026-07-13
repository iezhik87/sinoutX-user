import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

export interface CreateNotificationInput {
  userId?: string        // null = broadcast to all workspace members
  workspaceId?: string
  type?: string          // info | task | page | system
  title: string
  body?: string
  link?: string
}

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        id: randomUUID(),
        userId: input.userId ?? null,
        workspaceId: input.workspaceId ?? null,
        type: input.type ?? 'info',
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    })
  }

  // Returns notifications for this user: personal + workspace broadcasts
  async list(userId: string, workspaceId?: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: {
        OR: [
          { userId },
          ...(workspaceId ? [{ userId: null, workspaceId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async unreadCount(userId: string, workspaceId?: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        isRead: false,
        OR: [
          { userId },
          ...(workspaceId ? [{ userId: null, workspaceId }] : []),
        ],
      },
    })
  }

  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })
  }

  async markAllRead(userId: string, workspaceId?: string) {
    await this.prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { userId },
          ...(workspaceId ? [{ userId: null, workspaceId }] : []),
        ],
      },
      data: { isRead: true },
    })
  }

  async delete(id: string) {
    await this.prisma.notification.delete({ where: { id } })
  }
}

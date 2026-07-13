import { PrismaClient } from '@prisma/client'
import { CreateWorkspaceInput, UpdateWorkspaceInput } from './workspace.schema.js'

const MASKED = '***'

function maskApiKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(maskApiKeys)
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = k === 'apiKey' ? MASKED : maskApiKeys(v)
  }
  return result
}

export class WorkspaceService {
  constructor(private prisma: PrismaClient) {}

  async list(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: { _count: { select: { projects: true, notes: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    return memberships.map((m) => ({
      ...m.workspace,
      settings: maskApiKeys(m.workspace.settings),
      memberRole: m.role,
    }))
  }

  async getById(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        projects: { where: { status: 'ACTIVE' }, orderBy: { position: 'asc' } },
        _count: { select: { projects: true, notes: true, attachments: true } },
      },
    })
    if (!workspace) return null
    return { ...workspace, settings: maskApiKeys(workspace.settings) }
  }

  async create(data: CreateWorkspaceInput, userId: string) {
    const workspace = await this.prisma.workspace.create({ data })
    await this.prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: 'OWNER' },
    })
    return workspace
  }

  async update(id: string, data: UpdateWorkspaceInput) {
    const workspace = await this.prisma.workspace.update({ where: { id }, data })
    return { ...workspace, settings: maskApiKeys(workspace.settings) }
  }

  async delete(id: string) {
    return this.prisma.workspace.delete({ where: { id } })
  }

  // ── Members ────────────────────────────────────────────────────────────────

  async listMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  async getMembership(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }

  async addMember(workspaceId: string, userId: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
    return this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role },
      update: { role },
    })
  }

  async updateMemberRole(workspaceId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
    return this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role },
    })
  }

  async removeMember(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }
}

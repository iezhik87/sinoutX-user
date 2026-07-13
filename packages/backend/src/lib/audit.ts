import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export type AuditAction =
  // Auth
  | 'user.login'
  | 'user.login_failed'
  | 'user.login_locked'
  | 'user.register'
  | 'user.password_changed'
  // Workspace
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'member.added'
  | 'member.removed'
  | 'member.role_changed'
  // Projects
  | 'project.created'
  | 'project.deleted'
  | 'project.shared'
  | 'project.updated'
  // AI / settings
  | 'ai_settings.updated'
  // AI agent (MCP / API key) data mutations
  | 'ai.write'
  // Backup
  | 'backup.created'
  | 'backup.restored'
  // Admin
  | 'admin.settings_changed'
  | 'admin.user_created'
  | 'admin.user_deleted'
  | 'admin.wallet_adjusted'
  | 'admin.managed_keys_updated'
  | 'admin.pricing_updated'
  // Monitoring
  | 'monitoring.alert'
  | 'monitoring.alert_cleared'

export interface AuditEntry {
  workspaceId?: string | null
  userId?: string | null
  userEmail?: string | null
  action: AuditAction
  resourceType?: string | null
  resourceId?: string | null
  resourceName?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}

export async function writeAuditLog(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        workspaceId: entry.workspaceId ?? null,
        userId: entry.userId ?? null,
        userEmail: entry.userEmail ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        resourceName: entry.resourceName ?? null,
        meta: (entry.meta ?? {}) as Record<string, never>,
        ip: entry.ip ?? null,
      },
    })
  } catch {
    // Audit failures must never break normal operations
  }
}

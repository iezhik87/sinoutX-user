import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { hashApiKey } from '../lib/auth.js'
import { markSeen } from '../lib/presence.js'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

declare module 'fastify' {
  interface FastifyRequest {
    // @fastify/jwt uses `user` but with a conflicting type, so we extend it
    authUser?: AuthUser
    // How the request was authenticated. 'apikey' means a programmatic
    // caller (MCP / Claude / integrations); used for AI-action audit.
    authVia?: 'jwt' | 'apikey'
    authApiKeyName?: string
    // For API-key auth: the workspaces this key may access. Empty/undefined = all
    // of the user's workspaces (JWT requests are always undefined = unrestricted).
    authWorkspaceScope?: string[]
  }
}

export function createAuthMiddleware(prisma: PrismaClient) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    const authorization = req.headers.authorization
    const apiKeyHeader = req.headers['x-api-key'] as string | undefined

    // ── API Key auth (for MCP / integrations) ──────────────────────────────
    if (apiKeyHeader) {
      const keyHash = hashApiKey(apiKeyHeader)
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: { user: true },
      })

      if (!apiKey || !apiKey.user.isActive) {
        return reply.status(401).send({ error: 'Invalid API key' })
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return reply.status(401).send({ error: 'API key expired' })
      }

      // Update last used (fire and forget)
      prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => null)

      req.authUser = {
        id: apiKey.user.id,
        email: apiKey.user.email,
        name: apiKey.user.name,
        role: apiKey.user.role,
      }
      req.authVia = 'apikey'
      req.authApiKeyName = apiKey.name ?? 'API key'
      req.authWorkspaceScope = apiKey.workspaceIds?.length ? apiKey.workspaceIds : undefined
      markSeen(req.authUser, 'apikey')
      return
    }

    // ── JWT Bearer auth (for frontend) ─────────────────────────────────────
    // Also accept the JWT from a ?token= query param: needed for resources
    // loaded by URL where headers can't be set (img/iframe src, downloads,
    // file viewer, opening in a new tab).
    const queryToken = (req.query as { token?: string } | undefined)?.token
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    const token = bearer ?? queryToken
    if (token) {
      try {
        const payload = await req.server.jwt.verify<AuthUser>(token)
        req.authUser = payload
        req.authVia = 'jwt'
        markSeen(payload, 'jwt')
        return
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired token' })
      }
    }

    return reply.status(401).send({ error: 'Authentication required' })
  }
}

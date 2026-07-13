import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { redisSub, channelFor } from '../../lib/redis.js'
import type { AuthUser } from '../../middleware/authenticate.js'

// Track active WebSocket connections per workspace
const connections = new Map<string, Set<WebSocket>>()

function addConnection(workspaceId: string, ws: WebSocket) {
  if (!connections.has(workspaceId)) {
    connections.set(workspaceId, new Set())
    // Subscribe to the Redis channel for this workspace
    redisSub.subscribe(channelFor(workspaceId), (err) => {
      if (err) console.error(`[WS] Redis subscribe error for ${workspaceId}:`, err)
    })
  }
  connections.get(workspaceId)!.add(ws)
}

function removeConnection(workspaceId: string, ws: WebSocket) {
  const set = connections.get(workspaceId)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) {
    connections.delete(workspaceId)
    redisSub.unsubscribe(channelFor(workspaceId))
  }
}

// Forward Redis messages to all WebSocket clients in the workspace
redisSub.on('message', (channel: string, message: string) => {
  // channel format: sinoutx:ws:{workspaceId}
  const workspaceId = channel.replace('sinoutx:ws:', '')
  const clients = connections.get(workspaceId)
  if (!clients) return
  for (const ws of clients) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((ws as any).readyState === 1) (ws as any).send(message)
    } catch {
      // ignore dead sockets
    }
  }
})

export async function realtimeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /ws?workspaceId=xxx&token=JWT
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const qs = req.query as Record<string, string>
    const workspaceId = qs.workspaceId
    const token = qs.token

    if (!workspaceId) {
      socket.close(1008, 'workspaceId required')
      return
    }

    // Verify JWT (passed as query param since WS headers aren't accessible in browser)
    let userId: string | null = null
    if (token) {
      try {
        const payload = await req.server.jwt.verify<AuthUser>(token)
        userId = payload.id
      } catch {
        socket.close(1008, 'Invalid token')
        return
      }
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      try {
        const payload = await req.server.jwt.verify<AuthUser>(req.headers.authorization.slice(7))
        userId = payload.id
      } catch {
        socket.close(1008, 'Invalid token')
        return
      }
    } else {
      socket.close(1008, 'Authentication required')
      return
    }

    // Check workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    if (!member) {
      socket.close(1008, 'Access denied')
      return
    }

    addConnection(workspaceId, socket as unknown as WebSocket)
    socket.send(JSON.stringify({ type: 'connected', workspaceId }))

    socket.on('close', () => {
      removeConnection(workspaceId, socket as unknown as WebSocket)
    })

    socket.on('error', () => {
      removeConnection(workspaceId, socket as unknown as WebSocket)
    })
  })
}

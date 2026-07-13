import Redis from 'ioredis'
import { config } from '../config/index.js'

// Primary client for commands
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

// Dedicated pub client
export const redisPub = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

// Dedicated sub client (cannot be reused for commands)
export const redisSub = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err) => console.error('[Redis] error:', err.message))
redisPub.on('error', (err) => console.error('[Redis pub] error:', err.message))
redisSub.on('error', (err) => console.error('[Redis sub] error:', err.message))

export async function connectRedis() {
  await Promise.all([redis.connect(), redisPub.connect(), redisSub.connect()])
}

// ─── Pub/Sub helpers ─────────────────────────────────────────────────────────

export type SinoutXEvent =
  | { type: 'page.updated'; workspaceId: string; projectId: string; pageId: string }
  | { type: 'page.created'; workspaceId: string; projectId: string; pageId: string }
  | { type: 'page.deleted'; workspaceId: string; projectId: string; pageId: string }
  | { type: 'task.updated'; workspaceId: string; projectId: string; taskId: string }
  | { type: 'task.created'; workspaceId: string; projectId: string; taskId: string }
  | { type: 'note.created'; workspaceId: string; noteId: string }
  | { type: 'note.updated'; workspaceId: string; noteId: string }
  | { type: 'canvas.updated'; workspaceId: string; canvasId: string }
  | { type: 'record.created'; workspaceId: string; projectId: string; collectionId: string; recordId: string }

export function channelFor(workspaceId: string): string {
  return `sinoutx:ws:${workspaceId}`
}

export async function publish(event: SinoutXEvent & { workspaceId: string }) {
  const channel = channelFor(event.workspaceId)
  await redisPub.publish(channel, JSON.stringify(event))
}

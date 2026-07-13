import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

type SinoutXEvent =
  | { type: 'connected'; workspaceId: string }
  | { type: 'page.updated' | 'page.created' | 'page.deleted'; workspaceId: string; projectId: string; pageId: string }
  | { type: 'task.updated' | 'task.created'; workspaceId: string; projectId: string; taskId: string }
  | { type: 'note.created' | 'note.updated'; workspaceId: string; noteId: string }
  | { type: 'canvas.updated'; workspaceId: string; canvasId: string }

// Derive the WS origin from the page in production (wss://<host>); fall back
// to env or localhost only for local dev.
const WS_BASE = import.meta.env.VITE_WS_URL
  ?? (typeof window !== 'undefined' && window.location.host && !window.location.host.startsWith('localhost')
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : 'ws://localhost:3010')

export function useRealtimeUpdates(workspaceId: string | null) {
  const qc = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    let destroyed = false

    function connect() {
      if (destroyed) return

      const auth = api.defaults.headers.common['Authorization']
      const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/, '') : ''
      const ws = new WebSocket(`${WS_BASE}/ws?workspaceId=${workspaceId}${token ? `&token=${encodeURIComponent(token)}` : ''}`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SinoutXEvent
          handleEvent(event)
        } catch {
          // ignore malformed
        }
      }

      ws.onclose = () => {
        if (destroyed) return
        // Reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    function handleEvent(event: SinoutXEvent) {
      switch (event.type) {
        case 'page.created':
        case 'page.updated':
        case 'page.deleted':
          qc.invalidateQueries({ queryKey: ['page', event.pageId] })
          qc.invalidateQueries({ queryKey: ['pages', 'tree', event.projectId] })
          qc.invalidateQueries({ queryKey: ['pages-list', event.projectId] })
          // AI memory page has its own query key (own nav item, not in the tree)
          qc.invalidateQueries({ queryKey: ['memory-page', event.projectId] })
          break
        case 'task.created':
        case 'task.updated':
          qc.invalidateQueries({ queryKey: ['tasks', event.projectId] })
          qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
          qc.invalidateQueries({ queryKey: ['dashboard-tasks'] })
          break
        case 'note.created':
        case 'note.updated':
          qc.invalidateQueries({ queryKey: ['notes', event.workspaceId] })
          break
        case 'canvas.updated':
          qc.invalidateQueries({ queryKey: ['canvas', event.canvasId] })
          break
      }
    }

    connect()

    return () => {
      destroyed = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [workspaceId, qc])
}

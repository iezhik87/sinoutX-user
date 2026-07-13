import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { taskApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const CHECK_INTERVAL_MS = 60_000 // check every minute
const SHOWN_KEY = 'sinoutx:shown_reminders'

function getShownReminders(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function markShown(key: string) {
  const shown = getShownReminders()
  shown.add(key)
  // Keep only last 500 entries to avoid unbounded growth
  const arr = Array.from(shown).slice(-500)
  localStorage.setItem(SHOWN_KEY, JSON.stringify(arr))
}

export function useTaskReminders() {
  const { currentProjectId } = useWorkspaceStore()
  const permissionRef = useRef<NotificationPermission>('default')

  // Request permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p
      })
    } else if ('Notification' in window) {
      permissionRef.current = Notification.permission
    }
  }, [])

  const { data } = useQuery({
    queryKey: ['tasks', 'reminders', currentProjectId],
    queryFn: () => currentProjectId
      ? taskApi.list({ projectId: currentProjectId, limit: 100 })
      : Promise.resolve(null),
    enabled: !!currentProjectId,
    refetchInterval: CHECK_INTERVAL_MS,
    staleTime: CHECK_INTERVAL_MS - 5000,
  })

  useEffect(() => {
    if (!data?.items || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const now = new Date()
    const shown = getShownReminders()

    data.items.forEach((task) => {
      if (!task.reminderAt || task.reminderAt.length === 0) return
      task.reminderAt.forEach((reminderStr: string) => {
        const reminderDate = new Date(reminderStr)
        const key = `${task.id}:${reminderStr}`
        if (shown.has(key)) return
        // Fire if reminder is within the last minute or up to 5 minutes in the past
        const diffMs = now.getTime() - reminderDate.getTime()
        if (diffMs >= 0 && diffMs <= CHECK_INTERVAL_MS * 5) {
          markShown(key)
          new Notification(`⏰ Напоминание: ${task.title}`, {
            body: task.dueDate ? `Срок: ${new Date(task.dueDate).toLocaleDateString('ru')}` : 'Задача ожидает выполнения',
            icon: '/icons/icon-192x192.png',
            tag: key,
          })
        }
      })
    })
  }, [data])
}

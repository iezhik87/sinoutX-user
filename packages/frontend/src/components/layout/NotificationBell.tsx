import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, Trash2, FileText, CheckSquare, Info } from 'lucide-react'
import { notificationApi, type Notification } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

const TYPE_ICON: Record<string, typeof Info> = {
  task: CheckSquare,
  page: FileText,
  system: Info,
  info: Info,
}

function timeAgo(dateStr: string, tn: { justNow: string; minsAgo: string; hrsAgo: string; daysAgo: string }): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return tn.justNow
  if (mins < 60) return `${mins} ${tn.minsAgo}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ${tn.hrsAgo}`
  const days = Math.floor(hrs / 24)
  return `${days} ${tn.daysAgo}`
}

export function NotificationBell() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { currentWorkspaceId } = useWorkspaceStore()

  const { data } = useQuery({
    queryKey: ['notifications', currentWorkspaceId],
    queryFn: () => notificationApi.list(currentWorkspaceId ?? undefined, 30),
    refetchInterval: 30_000,
    enabled: true,
  })

  const items = data?.items ?? []
  const unread = data?.unread ?? 0

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(currentWorkspaceId ?? undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => notificationApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleNotificationClick(n: Notification) {
    if (!n.isRead) markRead.mutate(n.id)
    if (n.link) {
      navigate(n.link)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative btn-ghost p-1.5 flex-shrink-0',
          open && 'bg-slate-800',
        )}
        title={t.notifications.title}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-primary-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-surface-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300">{t.notifications.title}</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-[10px] text-primary-400 hover:text-primary-300 transition-colors"
              >
                <CheckCheck size={11} />
                {t.notifications.markAllRead}
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">{t.notifications.empty}</p>
            ) : (
              items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Info
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-800/60 transition-colors group',
                      !n.isRead && 'bg-primary-600/5',
                    )}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <Icon size={13} className={cn(n.isRead ? 'text-slate-500' : 'text-primary-400')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs leading-snug truncate', n.isRead ? 'text-slate-400' : 'text-slate-200 font-medium')}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-[10px] text-slate-600 mt-0.5">{timeAgo(n.createdAt, t.notifications)}</p>
                    </div>
                    {!n.isRead && (
                      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); remove.mutate(n.id) }}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-600 hover:text-slate-400"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

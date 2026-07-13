import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timeApi, type TimeEntry } from '@/api/client'
import { useState, useEffect, useRef } from 'react'
import { Play, Square, Trash2, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatEntryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatEntryDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function LiveClock({ startedAt }: { startedAt: string }) {
  const [sec, setSec] = useState(() => Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    ref.current = setInterval(() => setSec((s) => s + 1), 1000)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [])
  return <span className="font-mono text-green-400 text-xs">{formatDuration(sec)}</span>
}

interface Props {
  taskId: string
}

export function TimeTrackerSection({ taskId }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [show, setShow] = useState(false)

  const { data } = useQuery({
    queryKey: ['time-entries', taskId],
    queryFn: () => timeApi.list(taskId),
    enabled: show,
    refetchInterval: show ? 30000 : false,
  })

  const startMutation = useMutation({
    mutationFn: () => timeApi.start(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-entries', taskId] }),
  })

  const stopMutation = useMutation({
    mutationFn: () => timeApi.stop(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-entries', taskId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => timeApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-entries', taskId] }),
  })

  const running = data?.running ?? null
  const totalSec = data?.totalSec ?? 0
  const entries = data?.entries ?? []

  return (
    <div className="border-t border-slate-800 pt-3">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-xs text-slate-500 mb-2 flex items-center gap-1 hover:text-slate-300 w-full transition-colors"
      >
        {show ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Clock size={11} />
        {t.timeTracking.title}
        {totalSec > 0 && (
          <span className="ml-1 text-slate-600">{formatDuration(totalSec)}</span>
        )}
        {running && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      </button>

      {show && (
        <div className="space-y-2">
          {/* Start / Stop button */}
          <div className="flex items-center gap-2">
            {running ? (
              <button
                type="button"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                  'bg-red-950/40 border border-red-900 text-red-400 hover:bg-red-900/40',
                )}
              >
                <Square size={10} fill="currentColor" />
                {t.timeTracking.stop}
                <LiveClock startedAt={running.startedAt} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                  'bg-green-950/40 border border-green-900 text-green-400 hover:bg-green-900/40',
                )}
              >
                <Play size={10} fill="currentColor" />
                {t.timeTracking.start}
              </button>
            )}
            {totalSec > 0 && (
              <span className="text-xs text-slate-500">
                {t.timeTracking.total}: <span className="text-slate-300">{formatDuration(totalSec)}</span>
              </span>
            )}
          </div>

          {/* Entry log */}
          {entries.length === 0 ? (
            <p className="text-xs text-slate-600">{t.timeTracking.noEntries}</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {entries.map((e: TimeEntry) => (
                <div key={e.id} className="flex items-center gap-2 group text-xs">
                  <span className="text-slate-600 w-14 flex-shrink-0">{formatEntryDate(e.startedAt)}</span>
                  <span className="text-slate-500 flex-shrink-0">
                    {formatEntryTime(e.startedAt)} – {e.stoppedAt ? formatEntryTime(e.stoppedAt) : '…'}
                  </span>
                  <span className="flex-1 text-slate-300 font-mono">
                    {e.durationSec != null ? formatDuration(e.durationSec) : '–'}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(e.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

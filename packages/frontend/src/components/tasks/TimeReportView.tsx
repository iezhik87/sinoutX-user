import { useQuery } from '@tanstack/react-query'
import { timeApi } from '@/api/client'
import { useT } from '@/i18n'
import { useState } from 'react'
import { Clock } from 'lucide-react'

function fmtHours(sec: number): string {
  const h = sec / 3600
  if (h >= 1) return `${h.toFixed(1)}h`
  return `${Math.round(sec / 60)}m`
}

interface Props {
  projectId: string
}

export function TimeReportView({ projectId }: Props) {
  const t = useT()
  const [weeks, setWeeks] = useState(4)

  const { data, isLoading } = useQuery({
    queryKey: ['time-report', projectId, weeks],
    queryFn: () => timeApi.report(projectId, weeks),
  })

  const days = data ? Object.entries(data.byDay).sort(([a], [b]) => a.localeCompare(b)) : []
  const maxSec = days.reduce((m, [, s]) => Math.max(m, s), 1)

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-primary-400" />
          <h2 className="text-base font-semibold text-slate-100">{t.timeTracking.title}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{t.timeTracking.report}:</span>
          {[1, 2, 4, 8].map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`px-2 py-0.5 rounded transition-colors ${
                weeks === w ? 'bg-primary-700 text-white' : 'bg-surface-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {w} {t.timeTracking.weeks}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading…</div>
      )}

      {data && (
        <>
          {/* Total */}
          <div className="bg-surface-800 rounded-xl p-4 flex items-center gap-4">
            <Clock size={24} className="text-primary-400 flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-slate-100">{fmtHours(data.totalSec)}</p>
              <p className="text-xs text-slate-500">{t.timeTracking.total}</p>
            </div>
          </div>

          {/* Daily chart */}
          {days.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-3">{t.timeTracking.log}</p>
              <div className="flex items-end gap-1 h-32">
                {days.map(([day, sec]) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1 group">
                    <div
                      className="w-full bg-primary-600/70 rounded-t hover:bg-primary-500 transition-colors cursor-default"
                      style={{ height: `${Math.round((sec / maxSec) * 100)}%`, minHeight: 4 }}
                      title={`${day}: ${fmtHours(sec)}`}
                    />
                    <span className="text-[8px] text-slate-600 rotate-45 origin-left whitespace-nowrap">
                      {day.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By task */}
          {data.byTask.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">{t.timeTracking.log}</p>
              <div className="space-y-2">
                {data.byTask.slice(0, 10).map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex-1 text-xs text-slate-300 truncate">{item.title}</span>
                    <div className="w-24 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full"
                        style={{ width: `${Math.round((item.totalSec / data.totalSec) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-12 text-right font-mono">
                      {fmtHours(item.totalSec)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.totalSec === 0 && (
            <p className="text-center text-slate-500 text-sm py-12">{t.timeTracking.noEntries}</p>
          )}
        </>
      )}
    </div>
  )
}

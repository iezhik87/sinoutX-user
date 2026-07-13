import { useQuery } from '@tanstack/react-query'
import { Loader2, TrendingDown } from 'lucide-react'
import { taskApi } from '@/api/client'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

interface Props {
  projectId: string
}

const CHART_W = 800
const CHART_H = 300
const PAD = { top: 20, right: 20, bottom: 40, left: 44 }

export function BurndownView({ projectId }: Props) {
  const t = useT()
  const intl = getIntlLocale(useLanguageStore().language)
  const { data, isLoading } = useQuery({
    queryKey: ['burndown', projectId],
    queryFn: () => taskApi.getBurndown(projectId),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (!data || data.days.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-500">
        <TrendingDown size={32} />
        <p className="text-sm">{t.burndown.noData}</p>
      </div>
    )
  }

  const { days, remaining, ideal } = data
  const n = days.length
  const maxY = Math.max(...remaining, ...ideal, 1)

  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom

  const xScale = (i: number) => PAD.left + (i / (n - 1)) * innerW
  const yScale = (v: number) => PAD.top + innerH - (v / maxY) * innerH

  const toPolyline = (vals: number[]) =>
    vals.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ')

  // X-axis labels: show ~6 evenly spaced dates
  const labelStep = Math.max(1, Math.floor(n / 6))
  const xLabels = days
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % labelStep === 0 || i === n - 1)

  // Y-axis labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxY))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-0.5 bg-primary-500" />
          {t.burndown.actual}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-0.5 bg-slate-600 border-dashed border-t border-slate-500" />
          {t.burndown.ideal}
        </span>
        <span className="ml-auto text-slate-500">
          {t.burndown.total}: {data.total}
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full"
          style={{ minWidth: 400, maxWidth: CHART_W }}
        >
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <line
              key={tick}
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke="#1e293b"
              strokeWidth={1}
            />
          ))}

          {/* Y-axis labels */}
          {yTicks.map((tick) => (
            <text
              key={tick}
              x={PAD.left - 6}
              y={yScale(tick) + 4}
              textAnchor="end"
              fontSize={10}
              fill="#64748b"
            >
              {tick}
            </text>
          ))}

          {/* X-axis labels */}
          {xLabels.map(({ d, i }) => (
            <text
              key={i}
              x={xScale(i)}
              y={CHART_H - PAD.bottom + 14}
              textAnchor="middle"
              fontSize={9}
              fill="#64748b"
            >
              {new Date(d).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
            </text>
          ))}

          {/* Ideal line (dashed) */}
          <polyline
            points={toPolyline(ideal)}
            fill="none"
            stroke="#475569"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />

          {/* Area fill under actual */}
          <polygon
            points={`${xScale(0)},${yScale(0)} ${toPolyline(remaining)} ${xScale(n - 1)},${yScale(0)}`}
            fill="rgba(99,102,241,0.08)"
          />

          {/* Actual line */}
          <polyline
            points={toPolyline(remaining)}
            fill="none"
            stroke="#6366f1"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Today dot */}
          {n > 0 && (
            <circle
              cx={xScale(n - 1)}
              cy={yScale(remaining[n - 1])}
              r={4}
              fill="#6366f1"
            />
          )}
        </svg>
      </div>
    </div>
  )
}

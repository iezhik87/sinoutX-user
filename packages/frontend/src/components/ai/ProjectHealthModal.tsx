import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, Loader2, TrendingUp, AlertTriangle, CheckCircle2, Lightbulb, Activity } from 'lucide-react'
import { Modal } from '@/components/common/Modal'
import { api } from '@/api/client'
import { useLanguageStore } from '@/stores/languageStore'
import { useT } from '@/i18n'

interface HealthResult {
  health: {
    score: number
    status: 'healthy' | 'at_risk' | 'critical'
    summary: string
    highlights: string[]
    risks: string[]
    recommendations: string[]
  }
  stats: {
    total: number
    done: number
    inProgress: number
    todo: number
    overdue: number
    highPriority: number
    completionRate: number
    pages: number
    recentDone: number
  }
}

interface Props {
  projectId: string
  workspaceId: string
  projectName: string
  onClose: () => void
}

export function ProjectHealthModal({ projectId, workspaceId, projectName, onClose }: Props) {
  const { language } = useLanguageStore()
  const t = useT()
  const [result, setResult] = useState<HealthResult | null>(null)

  const analyseMut = useMutation({
    mutationFn: async () => {
      const res = await api.post<HealthResult>('/ai/project-health', null, {
        params: { projectId, workspaceId, lang: language },
      })
      return res.data
    },
    onSuccess: (data) => setResult(data),
  })

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-400' : score >= 50 ? 'text-amber-400' : 'text-red-400'
  const scoreBg = (score: number) =>
    score >= 80 ? 'bg-green-500/10 border-green-500/30' : score >= 50 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30'
  const statusLabel = (status: string) =>
    status === 'healthy' ? t.projectHealth.statusHealthy : status === 'at_risk' ? t.projectHealth.statusAtRisk : t.projectHealth.statusCritical

  return (
    <Modal open onClose={onClose} title={`${t.projectHealth.title}: ${projectName}`} className="max-w-xl">
      <div className="space-y-4">
        {!result && (
          <div className="text-center py-6 space-y-4">
            <Activity size={36} className="mx-auto text-slate-500" />
            <p className="text-sm text-slate-400">
              {t.projectHealth.intro}
            </p>
            <button
              onClick={() => analyseMut.mutate()}
              disabled={analyseMut.isPending}
              className="btn-primary mx-auto justify-center"
            >
              {analyseMut.isPending
                ? <><Loader2 size={14} className="animate-spin" />{t.projectHealth.analysing}</>
                : <><Sparkles size={14} />{t.projectHealth.runAnalysis}</>}
            </button>
            {analyseMut.isError && (
              <p className="text-xs text-red-400">{(analyseMut.error as Error).message}</p>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Score */}
            <div className={`flex items-center gap-4 p-4 rounded-xl border ${scoreBg(result.health.score)}`}>
              <div className="text-center">
                <div className={`text-4xl font-bold ${scoreColor(result.health.score)}`}>{result.health.score}</div>
                <div className="text-xs text-slate-500 mt-0.5">{t.projectHealth.outOf100}</div>
              </div>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${scoreColor(result.health.score)}`}>
                  {statusLabel(result.health.status)}
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{result.health.summary}</p>
              </div>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: t.projectHealth.total, value: result.stats.total, color: 'text-slate-300' },
                { label: t.projectHealth.done, value: `${result.stats.completionRate}%`, color: 'text-green-400' },
                { label: t.projectHealth.overdue, value: result.stats.overdue, color: result.stats.overdue > 0 ? 'text-red-400' : 'text-slate-500' },
                { label: t.projectHealth.pages, value: result.stats.pages, color: 'text-slate-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-surface-950 rounded-lg p-2.5 border border-slate-800">
                  <div className={`text-lg font-semibold ${color}`}>{value}</div>
                  <div className="text-xs text-slate-600">{label}</div>
                </div>
              ))}
            </div>

            {/* Highlights */}
            {result.health.highlights.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <TrendingUp size={11} className="text-green-400" />{t.projectHealth.highlights}
                </p>
                <ul className="space-y-1">
                  {result.health.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <CheckCircle2 size={13} className="text-green-400 mt-0.5 flex-shrink-0" />{h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks */}
            {result.health.risks.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <AlertTriangle size={11} className="text-amber-400" />{t.projectHealth.risks}
                </p>
                <ul className="space-y-1">
                  {result.health.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-amber-400 mt-0.5 flex-shrink-0">•</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {result.health.recommendations.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Lightbulb size={11} className="text-primary-400" />{t.projectHealth.recommendations}
                </p>
                <ul className="space-y-1">
                  {result.health.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-primary-400 mt-0.5 flex-shrink-0">{i + 1}.</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => { setResult(null); analyseMut.reset() }}
                className="btn-ghost text-sm"
              >
                {t.projectHealth.rerun}
              </button>
              <button onClick={onClose} className="btn-ghost ml-auto">{t.common.close}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

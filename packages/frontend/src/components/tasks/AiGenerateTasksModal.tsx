import { useState } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2, CheckCircle2, Plus, AlertCircle } from 'lucide-react'
import { taskApi, aiApi } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { cn } from '@/lib/utils'

interface GeneratedTask {
  title: string
  priority: string
  dueDate?: string | null
  selected: boolean
}

interface Props {
  projectId: string
  onClose: () => void
}

export function AiGenerateTasksModal({ projectId, onClose }: Props) {
  const t = useT()
  const intl = getIntlLocale(useLanguageStore().language)
  const qc = useQueryClient()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [text, setText] = useState('')
  const [tasks, setTasks] = useState<GeneratedTask[]>([])
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)

  const generate = useMutation({
    mutationFn: () => aiApi.generateTasksFromText(text, workspaceId!),
    onSuccess: (data) => {
      setTasks(data.tasks.map((t) => ({ ...t, selected: true })))
      setError('')
    },
    onError: () => setError(t.aiGenerate.error),
  })

  const createTasks = useMutation({
    mutationFn: async () => {
      const selected = tasks.filter((t) => t.selected)
      for (const task of selected) {
        await taskApi.create({
          projectId,
          title: task.title,
          priority: task.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
          dueDate: task.dueDate ?? undefined,
        })
      }
      return selected.length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      setCreated(true)
      setTimeout(() => onClose(), 1500)
    },
  })

  const toggleTask = (i: number) => {
    setTasks((prev) => prev.map((t, idx) => idx === i ? { ...t, selected: !t.selected } : t))
  }

  const selectedCount = tasks.filter((t) => t.selected).length

  return (
    <Modal open={true} title={t.aiGenerate.title} onClose={onClose}>
      <div className="space-y-4">
        {/* Text input */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{t.aiGenerate.inputLabel}</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.aiGenerate.placeholder}
            rows={5}
            className="w-full bg-surface-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900 rounded-lg px-3 py-2">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button
          onClick={() => generate.mutate()}
          disabled={!text.trim() || !workspaceId || generate.isPending}
          className="btn-primary w-full"
        >
          {generate.isPending
            ? <><Loader2 size={14} className="animate-spin" /> {t.aiGenerate.generating}</>
            : <><Sparkles size={14} /> {t.aiGenerate.generate}</>}
        </button>

        {/* Generated tasks */}
        {tasks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">{t.aiGenerate.results}: {tasks.length}</p>
              <button
                onClick={() => setTasks((prev) => prev.map((t) => ({ ...t, selected: !prev.every((t) => t.selected) })))}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                {tasks.every((t) => t.selected) ? t.aiGenerate.deselectAll : t.aiGenerate.selectAll}
              </button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {tasks.map((task, i) => (
                <div
                  key={i}
                  onClick={() => toggleTask(i)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                    task.selected
                      ? 'border-primary-700 bg-primary-950/30'
                      : 'border-slate-800 bg-surface-900 opacity-60',
                  )}
                >
                  <div className={cn('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                    task.selected ? 'bg-primary-600 border-primary-600' : 'border-slate-600')}>
                    {task.selected && <CheckCircle2 size={10} className="text-white" />}
                  </div>
                  <span className="flex-1 text-sm text-slate-200">{stripLeadingEmoji(task.title)}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded', {
                    'bg-slate-800 text-slate-400': task.priority === 'LOW',
                    'bg-blue-950 text-blue-400': task.priority === 'MEDIUM',
                    'bg-amber-950 text-amber-400': task.priority === 'HIGH',
                    'bg-red-950 text-red-400': task.priority === 'URGENT',
                  })}>{task.priority}</span>
                  {task.dueDate && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
              <button
                onClick={() => createTasks.mutate()}
                disabled={selectedCount === 0 || createTasks.isPending || created}
                className="btn-primary"
              >
                {createTasks.isPending
                  ? <><Loader2 size={14} className="animate-spin" /></>
                  : created
                  ? <><CheckCircle2 size={14} /> {t.aiGenerate.created}</>
                  : <><Plus size={14} /> {t.aiGenerate.createSelected} ({selectedCount})</>}
              </button>
            </div>
          </div>
        )}

        {tasks.length === 0 && !generate.isPending && (
          <div className="flex justify-end">
            <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

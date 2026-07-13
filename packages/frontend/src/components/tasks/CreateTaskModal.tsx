import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Calendar, Bell, RefreshCw } from 'lucide-react'
import { taskApi, type TaskStatus, type TaskPriority } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { PRIORITY_CONFIG, STATUS_CONFIG } from './TaskCard'
import { TaskTagPicker } from './TaskTagPicker'
import { TaskDescriptionEditor } from './TaskDescriptionEditor'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface CreateTaskModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  boardId?: string | null
  boardColumnId?: string | null
  defaultStatus?: TaskStatus
}

export function CreateTaskModal({ open, onClose, projectId, boardId, boardColumnId, defaultStatus = 'TODO' }: CreateTaskModalProps) {
  const qc = useQueryClient()
  const t = useT()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reminderDate, setReminderDate] = useState('')
  const [reminderTime, setReminderTime] = useState('09:00')
  const [recurrenceRule, setRecurrenceRule] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])

  const RECURRENCE_OPTIONS = [
    { value: '', label: t.tasks.recurrenceOptions.none },
    { value: 'daily', label: t.tasks.recurrenceOptions.daily },
    { value: 'weekly', label: t.tasks.recurrenceOptions.weekly },
    { value: 'biweekly', label: t.tasks.recurrenceOptions.biweekly },
    { value: 'monthly', label: t.tasks.recurrenceOptions.monthly },
    { value: 'yearly', label: t.tasks.recurrenceOptions.yearly },
    { value: 'weekdays', label: t.tasks.recurrenceOptions.workdays },
  ]

  function reset() {
    setTitle(''); setDescription(null); setStartDate(''); setDueDate(''); setStatus(defaultStatus); setPriority('MEDIUM')
    setReminderDate(''); setReminderTime('09:00'); setRecurrenceRule(''); setTagIds([])
  }

  const create = useMutation({
    mutationFn: () => {
      const reminderAt: string[] = []
      if (reminderDate) reminderAt.push(new Date(`${reminderDate}T${reminderTime}:00`).toISOString())
      return taskApi.create({ projectId, title: title.trim(), status, priority,
        description,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        boardId: boardId ?? null, boardColumnId: boardColumnId ?? null,
        reminderAt, isRecurring: !!recurrenceRule, recurrenceRule: recurrenceRule || null,
        tagIds,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
      qc.invalidateQueries({ queryKey: ['board'] })
      reset(); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title={t.tasks.createTask} className="max-w-lg">
      <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate() }} className="space-y-4">
        <textarea autoFocus placeholder={t.tasks.namePlaceholder} value={title}
          onChange={(e) => setTitle(e.target.value)} rows={2}
          className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />

        <TaskDescriptionEditor
          content={description}
          onChange={setDescription}
          placeholder={t.tasks.descriptionPlaceholder}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t.common.status}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((key) => (
                <option key={key} value={key}>{t.tasks.statuses[key]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t.common.priority}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map((key) => (
                <option key={key} value={key}>{t.tasks.priorities[key]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Calendar size={11} /> {t.tasks.startDate}
            </label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Calendar size={11} /> {t.tasks.dueDate}
            </label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              min={startDate || undefined}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <Bell size={11} /> {t.tasks.reminder}
          </label>
          <div className="flex gap-2">
            <input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)}
              className="flex-1 bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)}
              disabled={!reminderDate}
              className={cn('w-28 bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500', !reminderDate && 'opacity-40 cursor-not-allowed')}
            />
          </div>
          {reminderDate && (
            <p className="text-[11px] text-slate-600 mt-1">
              {t.tasks.notification} {new Date(`${reminderDate}T${reminderTime}:00`).toLocaleString()}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <RefreshCw size={11} /> {t.tasks.recurrence}
          </label>
          <select value={recurrenceRule} onChange={(e) => setRecurrenceRule(e.target.value)}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
            {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {recurrenceRule && (
            <p className="text-[11px] text-primary-400 mt-1 flex items-center gap-1">
              <RefreshCw size={10} /> {t.tasks.recurrenceHint}
            </p>
          )}
        </div>

        <TaskTagPicker initialTags={[]} onChange={(ids) => setTagIds(ids)} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button type="submit" disabled={!title.trim() || create.isPending} className="btn-primary">
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.create}
          </button>
        </div>
      </form>
    </Modal>
  )
}

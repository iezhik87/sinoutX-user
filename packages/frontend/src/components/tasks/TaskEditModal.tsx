import { useState, KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Calendar, RefreshCw, Trash2, Bell, CheckSquare, Square, Plus, X, Sparkles, ChevronDown, ChevronRight, History } from 'lucide-react'
import { taskApi, commentApi, graphApi, aiApi, type Task, type TaskStatus, type TaskPriority } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { PRIORITY_CONFIG, STATUS_CONFIG } from './TaskCard'
import { TaskTagPicker } from './TaskTagPicker'
import { TaskDescriptionEditor } from './TaskDescriptionEditor'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { CustomFieldsSection } from './CustomFieldsSection'
import { TimeTrackerSection } from './TimeTrackerSection'

interface TaskEditModalProps {
  task: Task
  onClose: () => void
  onDeleted?: () => void
}

export function TaskEditModal({ task, onClose, onDeleted }: TaskEditModalProps) {
  const qc = useQueryClient()
  const t = useT()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState<Record<string, unknown> | null>(task.description)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [startDate, setStartDate] = useState(
    task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : '',
  )
  const [dueDate, setDueDate] = useState(
    task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
  )
  const [recurrenceRule, setRecurrenceRule] = useState(task.recurrenceRule ?? '')
  const existingReminder = task.reminderAt?.[0] ? new Date(task.reminderAt[0]) : null
  const [reminderDate, setReminderDate] = useState(
    existingReminder ? existingReminder.toISOString().slice(0, 10) : '',
  )
  const [reminderTime, setReminderTime] = useState(
    existingReminder
      ? `${String(existingReminder.getHours()).padStart(2, '0')}:${String(existingReminder.getMinutes()).padStart(2, '0')}`
      : '09:00',
  )

  type SubtaskItem = { id: string; title: string; status: TaskStatus; priority: TaskPriority }
  const [subtasks, setSubtasks] = useState<SubtaskItem[]>(() => (task.subtasks ?? []) as SubtaskItem[])
  const [newSubtask, setNewSubtask] = useState('')
  const [tagIds, setTagIds] = useState<string[]>(() => (task.tags ?? []).map((tt) => tt.tag.id))

  const RECURRENCE_OPTIONS = [
    { value: '', label: t.tasks.recurrenceOptions.none },
    { value: 'daily', label: t.tasks.recurrenceOptions.daily },
    { value: 'weekly', label: t.tasks.recurrenceOptions.weekly },
    { value: 'biweekly', label: t.tasks.recurrenceOptions.biweekly },
    { value: 'monthly', label: t.tasks.recurrenceOptions.monthly },
    { value: 'yearly', label: t.tasks.recurrenceOptions.yearly },
    { value: 'weekdays', label: t.tasks.recurrenceOptions.workdays },
  ]

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['tasks', task.projectId] })
    qc.invalidateQueries({ queryKey: ['tasks-analytics', task.projectId] })
    qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
    qc.invalidateQueries({ queryKey: ['board'] })
  }

  const save = useMutation({
    mutationFn: () =>
      taskApi.update(task.id, {
        title: title.trim() || task.title,
        description,
        status,
        priority,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        isRecurring: !!recurrenceRule,
        recurrenceRule: recurrenceRule || null,
        reminderAt: reminderDate
          ? [new Date(`${reminderDate}T${reminderTime}:00`).toISOString()]
          : [],
        tagIds,
      }),
    onSuccess: () => { invalidate(); onClose() },
  })

  const del = useMutation({
    mutationFn: () => taskApi.delete(task.id),
    onSuccess: () => { invalidate(); onDeleted?.(); onClose() },
  })

  const addSubtask = useMutation({
    mutationFn: (title: string) => taskApi.create({
      projectId: task.projectId, title, status: 'TODO', priority: 'MEDIUM',
      parentTaskId: task.id, boardId: null, boardColumnId: null, reminderAt: [],
    }),
    onSuccess: (created) => {
      setSubtasks((prev) => [...prev, { id: created.id, title: created.title, status: created.status, priority: created.priority }])
      setNewSubtask('')
      invalidate()
    },
  })

  const toggleSubtask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      taskApi.update(id, { status }),
    onSuccess: (_data, vars) => {
      setSubtasks((prev) => prev.map((s) => s.id === vars.id ? { ...s, status: vars.status } : s))
    },
  })

  const removeSubtask = useMutation({
    mutationFn: (id: string) => taskApi.delete(id),
    onSuccess: (_data, id) => {
      setSubtasks((prev) => prev.filter((s) => s.id !== id))
      invalidate()
    },
  })

  const aiBreakDown = useMutation({
    mutationFn: () => aiApi.breakDownTask(task.id, workspaceId!),
    onSuccess: async (result) => {
      for (const title of result.subtasks) {
        const created = await taskApi.create({
          projectId: task.projectId, title, status: 'TODO', priority: 'MEDIUM',
          parentTaskId: task.id, boardId: null, boardColumnId: null, reminderAt: [],
        })
        setSubtasks((prev) => [...prev, { id: created.id, title: created.title, status: created.status, priority: created.priority }])
      }
      invalidate()
    },
  })

  function handleAddSubtask(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && newSubtask.trim()) {
      e.preventDefault()
      addSubtask.mutate(newSubtask.trim())
    }
  }

  const [showDeps, setShowDeps] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [newComment, setNewComment] = useState('')

  const comments = useQuery({
    queryKey: ['comments', task.id],
    queryFn: () => commentApi.list(task.id),
  })

  const activity = useQuery({
    queryKey: ['task-activity', task.id],
    queryFn: () => taskApi.getActivity(task.id),
    enabled: showActivity,
  })

  const addComment = useMutation({
    mutationFn: () => commentApi.create(task.id, { text: newComment.trim() }),
    onSuccess: () => {
      setNewComment('')
      qc.invalidateQueries({ queryKey: ['comments', task.id] })
    },
  })

  const removeComment = useMutation({
    mutationFn: (id: string) => commentApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', task.id] }),
  })

  function handleAddComment(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) {
      e.preventDefault()
      addComment.mutate()
    }
  }

  const [linkType, setLinkType] = useState<'DEPENDS_ON' | 'BLOCKS'>('DEPENDS_ON')
  const [linkTargetId, setLinkTargetId] = useState('')

  const taskLinks = useQuery({
    queryKey: ['task-links', task.id],
    queryFn: () => graphApi.getNodeLinks('task', task.id) as Promise<Array<{
      id: string; sourceType: string; sourceId: string; targetType: string; targetId: string; linkType: string
    }>>,
  })

  const projectTasks = useQuery({
    queryKey: ['tasks', task.projectId, '', ''],
    queryFn: () => taskApi.list({ projectId: task.projectId, limit: 200 }),
  })

  const addLink = useMutation({
    mutationFn: () =>
      graphApi.createLink({
        workspaceId: workspaceId!,
        sourceType: 'task',
        sourceId: task.id,
        targetType: 'task',
        targetId: linkTargetId,
        linkType,
      }),
    onSuccess: () => {
      setLinkTargetId('')
      qc.invalidateQueries({ queryKey: ['task-links', task.id] })
    },
  })

  const removeLink = useMutation({
    mutationFn: (id: string) => graphApi.deleteLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-links', task.id] }),
  })

  const depLinks = (taskLinks.data ?? []).filter(
    (l) => l.linkType === 'DEPENDS_ON' || l.linkType === 'BLOCKS',
  )

  function linkedTaskTitle(l: { sourceId: string; targetId: string }) {
    const otherId = l.sourceId === task.id ? l.targetId : l.sourceId
    return projectTasks.data?.items.find((t) => t.id === otherId)?.title ?? otherId.slice(0, 8) + '...'
  }

  return (
    <Modal open onClose={onClose} title={t.tasks.editTask} className="max-w-lg">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <textarea
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          rows={2}
          className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm
                     text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2
                     focus:ring-primary-500 resize-none"
        />

        <TaskDescriptionEditor
          content={description}
          onChange={setDescription}
          placeholder={t.tasks.descriptionPlaceholder}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t.common.status}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm
                         text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((key) => (
                <option key={key} value={key}>{t.tasks.statuses[key]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t.common.priority}</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm
                         text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
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
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm
                         text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Calendar size={11} /> {t.tasks.dueDate}
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={startDate || undefined}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm
                         text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <Bell size={11} /> {t.tasks.reminder}
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              className="flex-1 bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm
                         text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              disabled={!reminderDate}
              className={cn(
                'w-28 bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500',
                !reminderDate && 'opacity-40 cursor-not-allowed',
              )}
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
          <select
            value={recurrenceRule}
            onChange={(e) => setRecurrenceRule(e.target.value)}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm
                       text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <TaskTagPicker
          initialTags={task.tags ?? []}
          onChange={(ids) => setTagIds(ids)}
        />

        <div>
          <label className="text-xs text-slate-500 mb-2 flex items-center gap-1">
            <CheckSquare size={11} /> {t.tasks.subtasks}
            {subtasks.length > 0 && (
              <span className="ml-1 text-slate-600">
                {subtasks.filter((s) => s.status === 'DONE').length}/{subtasks.length}
              </span>
            )}
            {workspaceId && (
              <button
                type="button"
                onClick={() => aiBreakDown.mutate()}
                disabled={aiBreakDown.isPending}
                title={t.tasks.aiBreakDown}
                className="ml-auto flex items-center gap-1 text-primary-500 hover:text-primary-400 disabled:opacity-40 transition-colors"
              >
                {aiBreakDown.isPending
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Sparkles size={11} />}
                <span className="text-[10px]">{t.tasks.aiBreakDown}</span>
              </button>
            )}
          </label>
          <div className="space-y-1">
            {subtasks.map((sub) => (
              <div key={sub.id} className="group flex items-center gap-2 py-0.5">
                <button
                  type="button"
                  onClick={() => toggleSubtask.mutate({ id: sub.id, status: sub.status === 'DONE' ? 'TODO' : 'DONE' })}
                  className="flex-shrink-0 text-slate-400 hover:text-primary-400 transition-colors"
                >
                  {sub.status === 'DONE' ? <CheckSquare size={14} className="text-green-400" /> : <Square size={14} />}
                </button>
                <span className={cn('flex-1 text-sm truncate', sub.status === 'DONE' && 'line-through text-slate-500')}>
                  {sub.title}
                </span>
                <button
                  type="button"
                  onClick={() => removeSubtask.mutate(sub.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1">
              <Plus size={12} className="flex-shrink-0 text-slate-600" />
              <input
                type="text"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={handleAddSubtask}
                placeholder={t.tasks.addSubtask}
                className="flex-1 bg-transparent text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
              />
              {addSubtask.isPending && <Loader2 size={12} className="animate-spin text-slate-500" />}
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowDeps((v) => !v)}
            className="text-xs text-slate-500 mb-2 flex items-center gap-1 hover:text-slate-300 w-full transition-colors"
          >
            {showDeps ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {t.tasks.dependencies}
            {depLinks.length > 0 && <span className="ml-1 text-slate-600">{depLinks.length}</span>}
          </button>
          {showDeps && <>
          <div className="space-y-1 mb-2">
            {depLinks.map((l) => {
              const isSource = l.sourceId === task.id
              const dir = l.linkType === 'DEPENDS_ON'
                ? (isSource ? t.tasks.dependsOn : t.tasks.blockedBy)
                : (isSource ? t.tasks.blocks : t.tasks.dependsOnReverse)
              return (
                <div key={l.id} className="group flex items-center gap-2 text-xs text-slate-400">
                  <span className="text-slate-600 flex-shrink-0">{dir}:</span>
                  <span className="flex-1 truncate">{linkedTaskTitle(l)}</span>
                  <button
                    type="button"
                    onClick={() => removeLink.mutate(l.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })}
          </div>
          {workspaceId && (
            <div className="flex gap-2">
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as 'DEPENDS_ON' | 'BLOCKS')}
                className="bg-surface-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="DEPENDS_ON">{t.tasks.dependsOn}</option>
                <option value="BLOCKS">{t.tasks.blocks}</option>
              </select>
              <select
                value={linkTargetId}
                onChange={(e) => setLinkTargetId(e.target.value)}
                className="flex-1 bg-surface-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">{t.tasks.selectTask}</option>
                {(projectTasks.data?.items ?? [])
                  .filter((pt) => pt.id !== task.id)
                  .map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.title}</option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => linkTargetId && addLink.mutate()}
                disabled={!linkTargetId || addLink.isPending}
                className="btn-ghost text-xs px-2 disabled:opacity-30"
              >
                {addLink.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              </button>
            </div>
          )}
          </>}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="text-xs text-slate-500 mb-2 flex items-center gap-1 hover:text-slate-300 w-full transition-colors"
          >
            {showComments ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {t.tasks.comments}
            {(comments.data?.length ?? 0) > 0 && <span className="ml-1 text-slate-600">{comments.data!.length}</span>}
          </button>
          {showComments && <>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {comments.data?.map((c) => (
              <div key={c.id} className="group flex gap-2 bg-surface-900 rounded-md px-3 py-2">
                <div className="flex-1 min-w-0">
                  {c.author && (
                    <span className="text-[11px] text-slate-500 font-medium">{c.author} · </span>
                  )}
                  <span className="text-[11px] text-slate-600">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                  <p className="text-sm text-slate-300 mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeComment.mutate(c.id)}
                  className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-slate-600 hover:text-red-400 transition-all mt-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {comments.isLoading && (
              <div className="flex justify-center py-2">
                <Loader2 size={14} className="animate-spin text-slate-600" />
              </div>
            )}
          </div>
          <div className="mt-2 relative">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleAddComment}
              placeholder={t.tasks.addComment}
              rows={2}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 pr-10 text-sm
                         text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-2
                         focus:ring-primary-500 resize-none"
            />
            <button
              type="button"
              onClick={() => newComment.trim() && addComment.mutate()}
              disabled={!newComment.trim() || addComment.isPending}
              className="absolute right-2 bottom-2 text-slate-500 hover:text-primary-400 disabled:opacity-30 transition-colors"
            >
              {addComment.isPending
                ? <Loader2 size={14} className="animate-spin" />
                : <Plus size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-slate-600 mt-1">{t.tasks.commentHint}</p>
          </>}
        </div>

        {/* ── Time tracking ────────────────────────────────── */}
        <TimeTrackerSection taskId={task.id} />

        {/* ── Custom fields ────────────────────────────────── */}
        <CustomFieldsSection projectId={task.projectId} taskId={task.id} />

        {/* ── Activity log ─────────────────────────────────── */}
        <div className="border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setShowActivity((v) => !v)}
            className="text-xs text-slate-500 mb-2 flex items-center gap-1 hover:text-slate-300 w-full transition-colors"
          >
            {showActivity ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <History size={11} />
            {t.tasks.activityLog}
          </button>
          {showActivity && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {activity.isLoading && (
                <div className="flex justify-center py-2">
                  <Loader2 size={14} className="animate-spin text-slate-600" />
                </div>
              )}
              {activity.data?.length === 0 && (
                <p className="text-[11px] text-slate-600 text-center py-2">{t.tasks.noActivity}</p>
              )}
              {activity.data?.map((a) => (
                <div key={a.id} className="flex gap-2 text-[11px] text-slate-500">
                  <span className="text-slate-600 flex-shrink-0">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                  <span>
                    <span className="text-slate-400">{t.tasks.activityActions[a.action] ?? a.action}</span>
                    {a.oldValue && a.newValue && (
                      <span> <span className="line-through text-slate-600">{a.oldValue}</span> → <span className="text-slate-300">{a.newValue}</span></span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800">
          <button
            type="button"
            onClick={() => { if (confirm(t.tasks.deleteConfirm)) del.mutate() }}
            disabled={del.isPending}
            className="btn-danger text-xs"
          >
            <Trash2 size={13} /> {t.common.delete}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
            <button type="submit" disabled={save.isPending} className="btn-primary">
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.save}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

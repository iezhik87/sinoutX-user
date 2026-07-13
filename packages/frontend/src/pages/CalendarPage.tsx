import { useState, useRef, useCallback } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction'
import type { EventClickArg, EventDropArg } from '@fullcalendar/core'
import { Plus, Loader2, MapPin, Calendar as CalIcon, CheckSquare, StickyNote, CalendarDays, ChevronDown } from 'lucide-react'
import { calendarApi, taskApi, noteApi, projectApi, type CalendarEvent, type Project, type Task } from '@/api/client'
import { TaskEditModal } from '@/components/tasks/TaskEditModal'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { getDateLocale } from '@/i18n/dateLocale'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { FolderKanban } from 'lucide-react'

type QuickType = 'task' | 'note' | 'event'

function nextOccurrence(date: Date, rule: string): Date {
  const d = new Date(date)
  switch (rule) {
    case 'daily':    d.setDate(d.getDate() + 1); break
    case 'weekly':   d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly':  d.setMonth(d.getMonth() + 1); break
    case 'yearly':   d.setFullYear(d.getFullYear() + 1); break
    case 'weekdays': {
      d.setDate(d.getDate() + 1)
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
      break
    }
    default: d.setDate(d.getDate() + 7)
  }
  return d
}

function expandRecurringDates(startIso: string, rule: string, viewStart: Date, viewEnd: Date): Date[] {
  const result: Date[] = []
  let cur = new Date(startIso)
  // rewind to view range if original start is before it
  let safetyLimit = 0
  while (cur < viewStart && safetyLimit++ < 3000) {
    cur = nextOccurrence(cur, rule)
  }
  safetyLimit = 0
  while (cur <= viewEnd && safetyLimit++ < 500) {
    if (cur >= viewStart) result.push(new Date(cur))
    cur = nextOccurrence(cur, rule)
  }
  return result
}

function toLocalDatetime(dateStr: string, allDay: boolean): string {
  if (allDay) return `${dateStr.slice(0, 10)}T09:00`
  return dateStr.slice(0, 16)
}

export function CalendarPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { currentWorkspaceId } = useWorkspaceStore()
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)
  const t = useT()
  const { language } = useLanguageStore()

  // Project-level event creation modal
  const [createModal, setCreateModal] = useState<{ open: boolean; start?: string; end?: string }>({ open: false })
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null)
  const [form, setForm] = useState({ title: '', start: '', end: '', allDay: false, color: '#6366f1', location: '' })

  // Global quick-create modal (task / note / event)
  const [quickModal, setQuickModal] = useState<{ open: boolean; date: string; allDay: boolean } | null>(null)

  // Task detail
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)

  // Current visible date range (for recurring expansion)
  const now = new Date()
  const [viewRange, setViewRange] = useState<{ start: Date; end: Date }>({
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 2, 0),
  })
  const handleDatesSet = useCallback((info: { start: Date; end: Date }) => {
    setViewRange({ start: info.start, end: info.end })
  }, [])

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', projectId, currentWorkspaceId],
    queryFn: () => calendarApi.list({ projectId, workspaceId: currentWorkspaceId ?? undefined }),
    enabled: !!(projectId || currentWorkspaceId),
  })

  const { data: tasksData } = useQuery({
    queryKey: ['tasks-calendar', projectId, currentWorkspaceId],
    queryFn: () => taskApi.list({
      ...(projectId ? { projectId } : { workspaceId: currentWorkspaceId ?? undefined }),
      limit: 200,
    }),
    enabled: !!(projectId || currentWorkspaceId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })

  const PRIORITY_COLORS: Record<string, string> = {
    URGENT: '#ef4444', HIGH: '#f97316', MEDIUM: '#6366f1', LOW: '#64748b',
  }

  const taskEvents = (tasksData?.items ?? [])
    .filter((task) => !!(task.startDate || task.dueDate))
    .flatMap((task) => {
      const startIso = task.startDate ?? task.dueDate!
      const bg = PRIORITY_COLORS[task.priority] ?? '#6366f1'
      const baseColor = task.status === 'DONE' ? '#334155' : bg

      function makeEvent(startStr: string, idx?: number) {
        let end: string | undefined
        if (task.startDate && task.dueDate && task.startDate !== task.dueDate && idx === undefined) {
          const d = new Date(task.dueDate)
          d.setDate(d.getDate() + 1)
          end = d.toISOString()
        }
        return {
          id: idx !== undefined ? `task-${task.id}-r${idx}` : `task-${task.id}`,
          title: `☑ ${stripLeadingEmoji(task.title)}`,
          start: startStr,
          end,
          allDay: true,
          backgroundColor: baseColor,
          borderColor: 'transparent',
          textColor: '#ffffff',
          extendedProps: { isTask: true, taskId: task.id, status: task.status, priority: task.priority },
        }
      }

      if (task.isRecurring && task.recurrenceRule) {
        return expandRecurringDates(startIso, task.recurrenceRule, viewRange.start, viewRange.end)
          .map((d, i) => makeEvent(d.toISOString(), i))
      }
      return [makeEvent(startIso)]
    })

  const createEvent = useMutation({
    mutationFn: () =>
      calendarApi.create({
        projectId: projectId!,
        title: form.title,
        startAt: new Date(form.start).toISOString(),
        endAt: form.end ? new Date(form.end).toISOString() : undefined,
        allDay: form.allDay,
        color: form.color,
        location: form.location || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      setCreateModal({ open: false })
      setForm({ title: '', start: '', end: '', allDay: false, color: '#6366f1', location: '' })
    },
  })

  const deleteEvent = useMutation({
    mutationFn: (id: string) => calendarApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      setDetailEvent(null)
    },
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, startAt, endAt }: { id: string; startAt: string; endAt?: string }) =>
      calendarApi.update(id, { startAt, endAt: endAt ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  const calEvents = events.flatMap((e) => {
    function makeCalEvent(startStr: string, endStr?: string, idx?: number) {
      return {
        id: idx !== undefined ? `${e.id}-r${idx}` : e.id,
        title: e.title,
        start: startStr,
        end: endStr,
        allDay: e.allDay,
        backgroundColor: e.color ?? '#6366f1',
        borderColor: e.color ?? '#6366f1',
        extendedProps: { projectName: e.project?.name, location: e.location, eventId: e.id },
      }
    }
    if (e.isRecurring && e.recurrenceRule) {
      return expandRecurringDates(e.startAt, e.recurrenceRule, viewRange.start, viewRange.end)
        .map((d, i) => {
          const duration = e.endAt ? new Date(e.endAt).getTime() - new Date(e.startAt).getTime() : 0
          const end = duration > 0 ? new Date(d.getTime() + duration).toISOString() : undefined
          return makeCalEvent(d.toISOString(), end, i)
        })
    }
    return [makeCalEvent(e.startAt, e.endAt ?? undefined)]
  })

  const fcEvents = [...calEvents, ...taskEvents]

  const handleDateClick = (arg: DateClickArg) => {
    if (projectId) {
      setForm((f) => ({ ...f, start: arg.dateStr, end: '' }))
      setCreateModal({ open: true, start: arg.dateStr })
    } else {
      setQuickModal({ open: true, date: arg.dateStr, allDay: arg.allDay })
    }
  }

  const handleEventClick = async (arg: EventClickArg) => {
    const id = arg.event.id
    if (id.startsWith('task-')) {
      const taskId = (arg.event.extendedProps.taskId as string) ?? id.replace('task-', '').replace(/-r\d+$/, '')
      setTaskLoading(true)
      try {
        const task = await taskApi.getById(taskId)
        setSelectedTask(task)
      } finally {
        setTaskLoading(false)
      }
      return
    }
    const eventId = (arg.event.extendedProps.eventId as string) ?? id.replace(/-r\d+$/, '')
    const ev = events.find((e) => e.id === eventId)
    if (ev) setDetailEvent(ev)
  }

  const handleEventDrop = (arg: EventDropArg) => {
    updateEvent.mutate({
      id: arg.event.id,
      startAt: arg.event.startStr,
      endAt: arg.event.endStr || undefined,
    })
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.calendar.title}
        actions={
          projectId ? (
            <button onClick={() => setCreateModal({ open: true })} className="btn-primary">
              <Plus size={14} /> {t.calendar.newEvent}
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-primary-500" />
          </div>
        ) : (
          <div className="calendar-wrapper h-full">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              locale={language}
              firstDay={1}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              buttonText={{
                today: t.calendar.today,
                month: t.calendar.month,
                week: t.calendar.week,
                day: t.calendar.day,
              }}
              events={fcEvents}
              editable={!!projectId}
              selectable
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventDrop={handleEventDrop}
              datesSet={handleDatesSet}
              height="100%"
              eventDisplay="block"
              dayMaxEvents={3}
            />
          </div>
        )}
      </div>

      {/* Project-level create event modal */}
      <Modal open={createModal.open} onClose={() => setCreateModal({ open: false })} title={t.calendar.newEventTitle}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.title.trim() && form.start) createEvent.mutate() }}
          className="space-y-3"
        >
          <input
            autoFocus
            placeholder={t.calendar.eventTitleLabel}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.calendar.startDate}</label>
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.calendar.endDate}</label>
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))} className="accent-primary-500" />
              {t.calendar.allDay}
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">{t.calendar.color}</label>
              <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
            </div>
          </div>
          <input
            placeholder={t.calendar.location}
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setCreateModal({ open: false })} className="btn-ghost">{t.common.cancel}</button>
            <button type="submit" disabled={!form.title.trim() || !form.start || createEvent.isPending} className="btn-primary">
              {createEvent.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.create}
            </button>
          </div>
        </form>
      </Modal>

      {/* Event detail modal */}
      {detailEvent && (
        <Modal open={!!detailEvent} onClose={() => setDetailEvent(null)} title={detailEvent.title}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <CalIcon size={14} />
              <span>
                {format(new Date(detailEvent.startAt), 'd MMMM yyyy, HH:mm', { locale: getDateLocale(language) })}
                {detailEvent.endAt && ` — ${format(new Date(detailEvent.endAt), 'HH:mm')}`}
              </span>
            </div>
            {detailEvent.location && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <MapPin size={14} />
                <span>{detailEvent.location}</span>
              </div>
            )}
            {detailEvent.description && (
              <p className="text-sm text-slate-300">{detailEvent.description}</p>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => { if (confirm(t.calendar.deleteConfirm)) deleteEvent.mutate(detailEvent.id) }}
                disabled={deleteEvent.isPending}
                className="btn-danger"
              >
                {deleteEvent.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.delete}
              </button>
              <button onClick={() => setDetailEvent(null)} className="btn-ghost">{t.common.close}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Task loading overlay */}
      {taskLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Loader2 size={28} className="animate-spin text-primary-400" />
        </div>
      )}

      {/* Task detail modal */}
      {selectedTask && (
        <TaskEditModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => {
            setSelectedTask(null)
            qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
          }}
        />
      )}

      {/* Global quick-create modal */}
      {quickModal && (
        <QuickCreateModal
          date={quickModal.date}
          allDay={quickModal.allDay}
          workspaceId={currentWorkspaceId ?? ''}
          onClose={() => setQuickModal(null)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
            qc.invalidateQueries({ queryKey: ['events'] })
            setQuickModal(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Quick Create Modal ───────────────────────────────────────────────────────

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

function QuickCreateModal({
  date,
  allDay,
  workspaceId,
  onClose,
  onCreated,
}: {
  date: string
  allDay: boolean
  workspaceId: string
  onClose: () => void
  onCreated: () => void
}) {
  const t = useT()
  const [type, setType] = useState<QuickType>('task')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [datetime, setDatetime] = useState(toLocalDatetime(date, allDay))
  const [saving, setSaving] = useState(false)

  // Task fields
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPriority, setTaskPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM')

  // Note fields
  const [noteText, setNoteText] = useState('')

  // Event fields
  const [eventTitle, setEventTitle] = useState('')
  const [eventEnd, setEventEnd] = useState('')
  const [eventColor, setEventColor] = useState('#6366f1')
  const [eventLocation, setEventLocation] = useState('')

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-quick', workspaceId],
    queryFn: () => projectApi.listByWorkspace(workspaceId),
    enabled: !!workspaceId,
  })

  // Auto-select first project
  const effectiveProject = selectedProjectId || projects[0]?.id || ''

  const TYPES: { key: QuickType; icon: React.ReactNode; label: string }[] = [
    { key: 'task',  icon: <CheckSquare size={14} />,  label: t.entityCreate.newTask },
    { key: 'note',  icon: <StickyNote size={14} />,   label: t.entityCreate.newNote },
    { key: 'event', icon: <CalendarDays size={14} />, label: t.calendar.newEvent },
  ]

  const canSubmit = effectiveProject && (
    type === 'task'  ? taskTitle.trim().length > 0 :
    type === 'note'  ? true :
    /* event */        eventTitle.trim().length > 0
  )

  async function handleCreate() {
    if (!effectiveProject) return
    setSaving(true)
    try {
      if (type === 'task') {
        await taskApi.create({
          projectId: effectiveProject,
          title: taskTitle.trim(),
          priority: taskPriority,
          dueDate: new Date(datetime).toISOString(),
        })
      } else if (type === 'note') {
        await noteApi.create({
          workspaceId,
          projectId: effectiveProject,
          content: noteText.trim()
            ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: noteText.trim() }] }] }
            : EMPTY_DOC,
          pinned: false,
        })
      } else {
        await calendarApi.create({
          projectId: effectiveProject,
          title: eventTitle.trim(),
          startAt: new Date(datetime).toISOString(),
          endAt: eventEnd ? new Date(eventEnd).toISOString() : undefined,
          allDay,
          color: eventColor,
          location: eventLocation || undefined,
        })
      }
      onCreated()
    } finally {
      setSaving(false)
    }
  }


  return (
    <Modal open onClose={onClose} title={
      <span className="flex items-center gap-2 text-sm">
        {TYPES.find((tp) => tp.key === type)?.icon}
        {TYPES.find((tp) => tp.key === type)?.label}
      </span>
    }>
      <div className="space-y-3">
        {/* Type selector */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-800/60">
          {TYPES.map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setType(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                type === key ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Project selector */}
        <div className="relative">
          <div className="flex items-center gap-2 w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2">
            <span className="flex-shrink-0">
              <FolderKanban size={14} className="text-slate-400" />
            </span>
            <select
              value={effectiveProject}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="flex-1 bg-transparent text-sm text-slate-200 focus:outline-none appearance-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown size={13} className="text-slate-500 flex-shrink-0 pointer-events-none" />
          </div>
        </div>

        {/* Date/time */}
        <div>
          <label className="text-xs text-slate-500 mb-1 block">
            {type === 'task' ? t.calendar.startDate : t.calendar.startDate}
          </label>
          <input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Task fields */}
        {type === 'task' && (
          <>
            <input
              autoFocus
              placeholder={t.entityCreate.taskNamePlaceholder}
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleCreate()}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="flex gap-2">
              {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setTaskPriority(p)}
                  className={cn(
                    'flex-1 py-1 rounded-md text-xs font-medium transition-colors',
                    taskPriority === p ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
                  )}
                >
                  {t.entityCreate.priorities[p]}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Note fields */}
        {type === 'note' && (
          <textarea
            autoFocus
            placeholder={t.entityCreate.noteTextPlaceholder}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        )}

        {/* Event fields */}
        {type === 'event' && (
          <>
            <input
              autoFocus
              placeholder={t.calendar.eventTitleLabel}
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleCreate()}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.calendar.endDate}</label>
              <input
                type="datetime-local"
                value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                placeholder={t.calendar.location}
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                className="flex-1 bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">{t.calendar.color}</label>
                <input
                  type="color"
                  value={eventColor}
                  onChange={(e) => setEventColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                />
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button onClick={handleCreate} disabled={!canSubmit || saving} className="btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : t.common.create}
          </button>
        </div>
      </div>
    </Modal>
  )
}

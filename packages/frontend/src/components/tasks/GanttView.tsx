import { useState, useRef, useEffect } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type Task, type TaskStatus } from '@/api/client'
import { STATUS_CONFIG, PRIORITY_CONFIG } from './TaskCard'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

const DAY_WIDTH = 28  // px per day
const ROW_HEIGHT = 36 // px per task row
const LABEL_WIDTH = 200 // px for task name column

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  TODO:        'bg-slate-600',
  IN_PROGRESS: 'bg-primary-600',
  REVIEW:      'bg-amber-500',
  DONE:        'bg-green-600',
  CANCELLED:   'bg-slate-700 opacity-50',
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function diffDays(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

interface Props {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

export function GanttView({ tasks, onTaskClick }: Props) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Window: 60-day range, navigable
  const [rangeStart, setRangeStart] = useState(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - 7) // start 1 week before today
    return d
  })
  const DAYS = 60
  const rangeEnd = addDays(rangeStart, DAYS)
  const today = startOfDay(new Date())

  // Scroll today into view on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const todayOffset = diffDays(rangeStart, today)
    if (todayOffset >= 0 && todayOffset < DAYS) {
      scrollRef.current.scrollLeft = Math.max(0, todayOffset * DAY_WIDTH - 150)
    }
  }, []) // eslint-disable-line

  const intl = getIntlLocale(useLanguageStore().language)

  // Filter tasks that have at least a dueDate
  const ganttTasks = tasks.filter((t) => t.dueDate && t.status !== 'CANCELLED')

  // Build day headers
  const days: Date[] = []
  for (let i = 0; i < DAYS; i++) days.push(addDays(rangeStart, i))

  // Month groups for header
  const monthGroups: { label: string; start: number; count: number }[] = []
  days.forEach((d, i) => {
    const label = d.toLocaleDateString(intl, { month: 'short', year: 'numeric' })
    const last = monthGroups[monthGroups.length - 1]
    if (last && last.label === label) last.count++
    else monthGroups.push({ label, start: i, count: 1 })
  })

  function getBar(task: Task): { left: number; width: number } | null {
    if (!task.dueDate) return null
    const due = startOfDay(new Date(task.dueDate))
    const start = task.startDate ? startOfDay(new Date(task.startDate)) : addDays(due, -1)
    const barStart = diffDays(rangeStart, start)
    const barEnd   = diffDays(rangeStart, addDays(due, 1))
    const clampedStart = Math.max(0, barStart)
    const clampedEnd   = Math.min(DAYS, barEnd)
    if (clampedEnd <= clampedStart) return null
    return {
      left:  clampedStart * DAY_WIDTH,
      width: Math.max(DAY_WIDTH, (clampedEnd - clampedStart) * DAY_WIDTH),
    }
  }

  const totalWidth = DAYS * DAY_WIDTH

  return (
    <div className="flex flex-col h-full select-none">
      {/* Navigation */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setRangeStart((d) => addDays(d, -14))}
          className="btn-ghost p-1"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-xs text-slate-400">
          {rangeStart.toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
          {' — '}
          {rangeEnd.toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <button
          onClick={() => setRangeStart((d) => addDays(d, 14))}
          className="btn-ghost p-1"
        >
          <ChevronRight size={15} />
        </button>
        <button
          onClick={() => setRangeStart(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 7); return d })}
          className="btn-ghost text-xs ml-1"
        >
          {t.gantt.today}
        </button>
        {ganttTasks.length === 0 && (
          <span className="ml-2 text-xs text-slate-600">{t.gantt.noTasks}</span>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-y-auto border border-slate-800 rounded-xl">
        {/* Fixed label column */}
        <div className="flex-shrink-0 border-r border-slate-800" style={{ width: LABEL_WIDTH }}>
          {/* Header spacer */}
          <div className="border-b border-slate-800 bg-surface-900" style={{ height: 40 }}>
            <div className="px-3 py-1 text-xs text-slate-600 font-medium flex items-end h-full pb-1">
              {t.gantt.task}
            </div>
          </div>
          {/* Task labels */}
          {ganttTasks.map((task) => {
            const cfg = STATUS_CONFIG[task.status]
            const Icon = cfg.icon
            return (
              <div
                key={task.id}
                onClick={() => onTaskClick(task)}
                style={{ height: ROW_HEIGHT }}
                className="flex items-center gap-2 px-3 border-b border-slate-800/50 hover:bg-surface-800 cursor-pointer transition-colors group"
              >
                <Icon size={11} className={cn('flex-shrink-0', cfg.color)} />
                <span className={cn(
                  'text-xs truncate flex-1',
                  task.status === 'DONE' ? 'line-through text-slate-500' : 'text-slate-300 group-hover:text-slate-100',
                )}>
                  {stripLeadingEmoji(task.title)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Scrollable chart area */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: totalWidth, minWidth: totalWidth }}>
            {/* Month header */}
            <div className="flex border-b border-slate-700/50 bg-surface-900" style={{ height: 20 }}>
              {monthGroups.map((mg) => (
                <div
                  key={mg.label + mg.start}
                  className="text-[10px] text-slate-500 border-r border-slate-800 px-1 flex items-center overflow-hidden"
                  style={{ width: mg.count * DAY_WIDTH }}
                >
                  {mg.label}
                </div>
              ))}
            </div>

            {/* Day header */}
            <div className="flex border-b border-slate-800 bg-surface-900" style={{ height: 20 }}>
              {days.map((d, i) => {
                const isToday = diffDays(today, d) === 0
                const isWeekend = d.getDay() === 0 || d.getDay() === 6
                return (
                  <div
                    key={i}
                    className={cn(
                      'text-[10px] border-r border-slate-800/40 flex items-center justify-center flex-shrink-0',
                      isToday ? 'text-primary-400 font-bold' : isWeekend ? 'text-slate-600' : 'text-slate-500',
                    )}
                    style={{ width: DAY_WIDTH }}
                  >
                    {d.getDate()}
                  </div>
                )
              })}
            </div>

            {/* Rows */}
            <div className="relative">
              {/* Today line */}
              {diffDays(rangeStart, today) >= 0 && diffDays(rangeStart, today) < DAYS && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary-500/60 z-10 pointer-events-none"
                  style={{ left: diffDays(rangeStart, today) * DAY_WIDTH + DAY_WIDTH / 2 }}
                />
              )}

              {ganttTasks.map((task) => {
                const bar = getBar(task)
                const priority = PRIORITY_CONFIG[task.priority]
                return (
                  <div
                    key={task.id}
                    className="relative flex items-center border-b border-slate-800/50"
                    style={{ height: ROW_HEIGHT, minWidth: totalWidth }}
                  >
                    {/* Weekend shading */}
                    {days.map((d, i) => (
                      d.getDay() === 0 || d.getDay() === 6 ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-slate-800/20"
                          style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                        />
                      ) : null
                    ))}

                    {/* Bar */}
                    {bar && (
                      <div
                        onClick={() => onTaskClick(task)}
                        title={`${task.title}${task.dueDate ? ' — ' + new Date(task.dueDate).toLocaleDateString() : ''}`}
                        className={cn(
                          'absolute h-5 rounded-md cursor-pointer flex items-center px-2 overflow-hidden',
                          'hover:brightness-125 transition-all z-20',
                          STATUS_BAR_COLOR[task.status],
                        )}
                        style={{ left: bar.left + 1, width: bar.width - 2, top: (ROW_HEIGHT - 20) / 2 }}
                      >
                        <span className={cn('text-[10px] font-medium truncate text-white/90', priority.color === 'text-red-400' && 'text-red-200')}>
                          {stripLeadingEmoji(task.title)}
                        </span>
                      </div>
                    )}

                    {/* No bar but has dueDate — show diamond marker */}
                    {!bar && task.dueDate && (() => {
                      const due = startOfDay(new Date(task.dueDate))
                      const pos = diffDays(rangeStart, due)
                      if (pos < 0 || pos >= DAYS) return null
                      return (
                        <div
                          onClick={() => onTaskClick(task)}
                          className="absolute w-3 h-3 rotate-45 bg-amber-500 cursor-pointer hover:scale-125 transition-transform z-20"
                          style={{ left: pos * DAY_WIDTH + DAY_WIDTH / 2 - 6, top: (ROW_HEIGHT - 12) / 2 }}
                          title={task.title}
                        />
                      )
                    })()}
                  </div>
                )
              })}

              {ganttTasks.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-slate-600">
                  {t.gantt.noTasksWithDates}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

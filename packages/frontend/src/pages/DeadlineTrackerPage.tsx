import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock, Calendar, CheckCircle2, Loader2 } from 'lucide-react'
import { taskApi, type Task } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { PRIORITY_CONFIG } from '@/components/tasks/TaskCard'
import { TaskEditModal } from '@/components/tasks/TaskEditModal'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

type TrackedTask = Task & { project: { id: string; name: string; color: string | null } }

interface SectionProps {
  title: string
  tasks: TrackedTask[]
  icon: React.ReactNode
  accent: string
  onTaskClick?: (t: TrackedTask) => void
}

function Section({ title, tasks, icon, accent, onTaskClick }: SectionProps) {
  const intl = getIntlLocale(useLanguageStore().language)
  if (tasks.length === 0) return null
  return (
    <div>
      <div className={cn('flex items-center gap-2 mb-3', accent)}>
        {icon}
        <span className="text-sm font-semibold uppercase tracking-wider">{title}</span>
        <span className="ml-1 text-xs bg-surface-900 border border-slate-800 px-1.5 py-0.5 rounded-full text-slate-400">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {tasks.map((task) => {
          const priority = PRIORITY_CONFIG[task.priority]
          return (
            <div
              key={task.id}
              onClick={() => onTaskClick?.(task)}
              className="group flex items-center gap-3 px-4 py-2.5 bg-surface-900 border border-slate-800 rounded-lg hover:border-slate-600 transition-colors cursor-pointer"
            >
              <div
                className="flex-shrink-0 w-2 h-2 rounded-full"
                style={{ backgroundColor: task.project.color ?? '#6366f1' }}
              />
              <span className="flex-1 text-sm text-slate-200 truncate">{task.title}</span>
              <span className="text-xs text-slate-500 hidden group-hover:block">{task.project.name}</span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded-md', priority.bg, priority.color)}>
                {task.priority}
              </span>
              {task.dueDate && (
                <span className={cn('text-xs flex-shrink-0', accent)}>
                  {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Inner content (no page chrome) so it can be embedded as a tab in the
// combined Activity/Deadlines page.
export function DeadlineTrackerContent() {
  const t = useT()
  const qc = useQueryClient()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['deadline-tracker', workspaceId],
    queryFn: () => taskApi.getDeadlineTracker(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  })

  const total = (data?.overdue.length ?? 0) + (data?.today.length ?? 0) + (data?.week.length ?? 0) + (data?.later.length ?? 0)

  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : total === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 size={40} className="mx-auto text-green-600 mb-3" />
          <p className="text-slate-400 text-sm">{t.deadlineTracker.allClear}</p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section title={t.deadlineTracker.overdue} tasks={data?.overdue ?? []} icon={<AlertTriangle size={15} />} accent="text-red-400" onTaskClick={setSelectedTask} />
          <Section title={t.deadlineTracker.today} tasks={data?.today ?? []} icon={<Clock size={15} />} accent="text-amber-400" onTaskClick={setSelectedTask} />
          <Section title={t.deadlineTracker.thisWeek} tasks={data?.week ?? []} icon={<Calendar size={15} />} accent="text-primary-400" onTaskClick={setSelectedTask} />
          <Section title={t.deadlineTracker.later} tasks={data?.later ?? []} icon={<Calendar size={15} />} accent="text-slate-400" onTaskClick={setSelectedTask} />
        </div>
      )}

      {selectedTask && (
        <TaskEditModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => {
            setSelectedTask(null)
            qc.invalidateQueries({ queryKey: ['deadline-tracker', workspaceId] })
          }}
        />
      )}
    </>
  )
}

export function DeadlineTrackerPage() {
  const t = useT()
  return (
    <div className="flex flex-col h-full">
      <Header title={t.deadlineTracker.title} />
      <div className="flex-1 overflow-y-auto p-5"><div className="max-w-2xl"><DeadlineTrackerContent /></div></div>
    </div>
  )
}

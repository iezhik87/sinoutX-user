import { type Task, type TaskStatus, type TaskPriority } from '@/api/client'
import { Calendar, CheckSquare, AlertCircle, Circle, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { stripLeadingEmoji } from '@/lib/displayText'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useT } from '@/i18n'

function extractFirstLine(doc: Record<string, unknown>): string {
  function getText(node: Record<string, unknown>): string {
    if (typeof node.text === 'string') return node.text
    if (Array.isArray(node.content))
      return (node.content as Record<string, unknown>[]).map(getText).join('')
    return ''
  }
  const blocks = (doc.content as Record<string, unknown>[] | undefined) ?? []
  for (const block of blocks) {
    const text = getText(block).trim()
    if (text) return text
  }
  return ''
}

export const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Circle; color: string }> = {
  TODO:        { icon: Circle,       color: 'text-slate-400' },
  IN_PROGRESS: { icon: Clock,        color: 'text-blue-400' },
  REVIEW:      { icon: AlertCircle,  color: 'text-yellow-400' },
  DONE:        { icon: CheckCircle2, color: 'text-green-400' },
  CANCELLED:   { icon: XCircle,      color: 'text-slate-600' },
}

export const PRIORITY_CONFIG: Record<TaskPriority, { color: string; bg: string }> = {
  LOW:    { color: 'text-slate-400',  bg: 'bg-slate-800' },
  MEDIUM: { color: 'text-blue-400',   bg: 'bg-blue-950' },
  HIGH:   { color: 'text-orange-400', bg: 'bg-orange-950' },
  URGENT: { color: 'text-red-400',    bg: 'bg-red-950' },
}

interface TaskCardProps {
  task: Task
  onClick?: () => void
  compact?: boolean
}

export function TaskCard({ task, onClick, compact = false }: TaskCardProps) {
  const t = useT()
  const status = STATUS_CONFIG[task.status]
  const priority = PRIORITY_CONFIG[task.priority]
  const StatusIcon = status.icon

  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    !['DONE', 'CANCELLED'].includes(task.status)

  return (
    <div
      onClick={onClick}
      className={cn(
        'group bg-surface-900 border border-slate-800 rounded-lg cursor-pointer',
        'hover:border-slate-600 transition-colors duration-150',
        compact ? 'p-2' : 'p-3',
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIcon size={14} className={cn('mt-0.5 flex-shrink-0', status.color)} />

        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm leading-snug',
            task.status === 'DONE' ? 'line-through text-slate-500' : 'text-slate-200',
            task.status === 'CANCELLED' && 'text-slate-600',
          )}>
            {stripLeadingEmoji(task.title)}
          </p>

          {!compact && task.description && (
            <p className="text-xs text-slate-500 mt-1 truncate leading-snug">
              {extractFirstLine(task.description)}
            </p>
          )}

          {!compact && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium', priority.bg, priority.color)}>
                {t.tasks.priorities[task.priority]}
              </span>

              {task.dueDate && (
                <span className={cn('flex items-center gap-1 text-xs', isOverdue ? 'text-red-400' : 'text-slate-500')}>
                  <Calendar size={11} />
                  {format(new Date(task.dueDate), 'd MMM', { locale: ru })}
                </span>
              )}

              {(task._count?.subtasks ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <CheckSquare size={11} />
                  {task._count!.subtasks}
                </span>
              )}

              {task.tags.slice(0, 2).map(({ tag }) => (
                <span key={tag.id} className="text-xs px-1.5 py-0.5 rounded-full text-slate-300"
                  style={{ backgroundColor: tag.color + '33', color: tag.color }}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useParams } from 'react-router-dom'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Loader2, CheckCircle2, Trash2, List, Columns2, Download, Search, GanttChartSquare, TrendingDown, Upload, Sparkles, Clock, Zap } from 'lucide-react'
import { taskApi, tagApi, type TaskStatus, type TaskPriority, type Task } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/components/tasks/TaskCard'
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal'
import { TaskEditModal } from '@/components/tasks/TaskEditModal'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useT } from '@/i18n'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { GanttView } from '@/components/tasks/GanttView'
import { BurndownView } from '@/components/tasks/BurndownView'
import { ImportTasksModal } from '@/components/tasks/ImportTasksModal'
import { AiGenerateTasksModal } from '@/components/tasks/AiGenerateTasksModal'
import { TimeReportView } from '@/components/tasks/TimeReportView'
import { AutomationsModal } from '@/components/tasks/AutomationsModal'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

function exportTasksCSV(tasks: Task[], filename = 'tasks.csv') {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  function tipTapToText(doc: Record<string, unknown> | null): string {
    if (!doc) return ''
    function extract(node: Record<string, unknown>): string {
      if (typeof node.text === 'string') return node.text
      if (Array.isArray(node.content)) return (node.content as Record<string, unknown>[]).map(extract).join('')
      return ''
    }
    return ((doc.content as Record<string, unknown>[] | undefined) ?? []).map(extract).join(' ').trim()
  }
  const header = ['Title', 'Status', 'Priority', 'Start Date', 'Due Date', 'Assignee', 'Tags', 'Description']
  const rows = tasks.map((t) => [
    esc(t.title),
    esc(t.status),
    esc(t.priority),
    esc(t.startDate ? new Date(t.startDate).toLocaleDateString() : ''),
    esc(t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ''),
    esc(t.assignee ?? ''),
    esc((t.tags ?? []).map((tt) => tt.tag.name).join(', ')),
    esc(tipTapToText(t.description)),
  ])
  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const ALL_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']
const ALL_PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
const BOARD_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']

type ViewMode = 'list' | 'board' | 'gantt' | 'burndown' | 'timereport'

export function TasksPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const qc = useQueryClient()
  const t = useT()

  const [searchParams, setSearchParams] = useSearchParams()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [filterStatus, setFilterStatus] = useState<TaskStatus | ''>('')
  const [filterPriority, setFilterPriority] = useState<TaskPriority | ''>('')
  const [filterTagId, setFilterTagId] = useState('')
  const [searchText, setSearchText] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showAiGenerate, setShowAiGenerate] = useState(false)
  const [showAutomations, setShowAutomations] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('tasks-view-mode') as ViewMode) ?? 'list',
  )

  const switchView = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem('tasks-view-mode', mode)
    if (mode === 'board' || mode === 'gantt' || mode === 'burndown') { setFilterStatus(''); setFilterTagId('') }
  }

  // Open task from URL param (e.g. from entity ref chip click)
  const { data: allTasks } = useQuery({
    queryKey: ['tasks', projectId, '', ''],
    queryFn: () => taskApi.list({ projectId, limit: 200 }),
    enabled: !!searchParams.get('taskId'),
  })
  useEffect(() => {
    const taskId = searchParams.get('taskId')
    if (!taskId || !allTasks) return
    const found = allTasks.items.find((task) => task.id === taskId)
    if (found) { setSelectedTask(found); setSearchParams({}, { replace: true }) }
  }, [searchParams, allTasks, setSearchParams])

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', projectId, viewMode === 'board' ? '' : filterStatus, filterPriority, filterTagId],
    queryFn: () =>
      taskApi.list({
        projectId,
        status: viewMode === 'board' ? undefined : (filterStatus || undefined),
        priority: filterPriority || undefined,
        tagId: filterTagId || undefined,
        limit: 500,
      }),
    enabled: !!projectId,
  })

  const { data: analytics } = useQuery({
    queryKey: ['tasks-analytics', projectId],
    queryFn: () => taskApi.getAnalytics(projectId!),
    enabled: !!projectId,
  })

  const { data: tags = [] } = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => tagApi.list(workspaceId!),
    enabled: !!workspaceId,
  })

  const invalidateTaskRelated = () => {
    qc.invalidateQueries({ queryKey: ['tasks', projectId] })
    qc.invalidateQueries({ queryKey: ['tasks-analytics', projectId] })
    qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
    // Keep the dashboard (today/overdue/active tasks + counts) in sync.
    qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
    qc.invalidateQueries({ queryKey: ['dashboard-tasks'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      taskApi.update(id, { status }),
    onSuccess: invalidateTaskRelated,
  })

  const deleteTask = useMutation({
    mutationFn: (id: string) => taskApi.delete(id),
    onSuccess: () => { invalidateTaskRelated(); setSelectedTask(null) },
  })

  const allLoadedTasks = data?.items ?? []
  const tasks = searchText.trim()
    ? allLoadedTasks.filter((t) => t.title.toLowerCase().includes(searchText.toLowerCase()))
    : allLoadedTasks

  const grouped = ALL_STATUSES.reduce<Record<TaskStatus, Task[]>>(
    (acc, s) => ({ ...acc, [s]: tasks.filter((task) => task.status === s) }),
    {} as Record<TaskStatus, Task[]>,
  )

  const handleDragEnd = (result: DropResult) => {
    const { draggableId, source, destination } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId) return
    updateStatus.mutate({ id: draggableId, status: destination.droppableId as TaskStatus })
  }

  const viewToggle = (
    <div className="flex items-center gap-1 bg-surface-900 border border-slate-800 rounded-lg p-1">
      <button
        onClick={() => switchView('list')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
          viewMode === 'list'
            ? 'bg-primary-600 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-300',
        )}
      >
        <List size={13} /> {t.tasks.listView}
      </button>
      <button
        onClick={() => switchView('board')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
          viewMode === 'board'
            ? 'bg-primary-600 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-300',
        )}
      >
        <Columns2 size={13} /> {t.tasks.boardView}
      </button>
      <button
        onClick={() => switchView('gantt')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
          viewMode === 'gantt'
            ? 'bg-primary-600 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-300',
        )}
      >
        <GanttChartSquare size={13} /> {t.tasks.ganttView}
      </button>
      <button
        onClick={() => switchView('burndown')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
          viewMode === 'burndown'
            ? 'bg-primary-600 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-300',
        )}
      >
        <TrendingDown size={13} /> {t.burndown.view}
      </button>
      <button
        onClick={() => switchView('timereport')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
          viewMode === 'timereport'
            ? 'bg-primary-600 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-300',
        )}
      >
        <Clock size={13} /> {t.timeTracking.title}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.tasks.title}
        actions={
          <div className="flex items-center gap-3">
            {viewToggle}
            {tasks.length > 0 && (
              <button
                onClick={() => exportTasksCSV(tasks, `tasks-${projectId}.csv`)}
                className="btn-ghost text-xs"
                title={t.tasks.exportCsv}
              >
                <Download size={13} />
              </button>
            )}
            <button onClick={() => setShowImport(true)} className="btn-ghost p-1.5" title={t.import.import}>
              <Upload size={13} />
            </button>
            <button onClick={() => setShowAiGenerate(true)} className="btn-ghost text-xs" title="AI">
              <Sparkles size={13} /> AI
            </button>
            <button onClick={() => setShowAutomations(true)} className="btn-ghost p-1.5" title={t.automation.title}>
              <Zap size={13} />
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={14} /> {t.tasks.newTask}
            </button>
          </div>
        }
      />

      <div className={cn('flex-1 min-h-0', viewMode === 'board' ? 'overflow-auto' : 'overflow-y-auto')} style={viewMode === 'gantt' ? { overflow: 'hidden' } : {}}>
        <div className={cn(viewMode === 'gantt' ? 'p-5 h-full flex flex-col' : 'p-5')}>

          {/* Analytics strip — list mode only */}
          {viewMode === 'list' && analytics && (
            <div className="flex gap-4 mb-5 flex-wrap">
              {analytics.byStatus.map(({ status, _count }) => {
                const cfg = STATUS_CONFIG[status as TaskStatus]
                const Icon = cfg.icon
                return (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(filterStatus === status ? '' : (status as TaskStatus))}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                      filterStatus === status
                        ? 'border-primary-500 bg-primary-600/10 text-primary-400'
                        : 'border-slate-800 bg-surface-900 text-slate-400 hover:border-slate-600',
                    )}
                  >
                    <Icon size={13} className={cfg.color} />
                    <span>{t.tasks.statuses[status as TaskStatus]}</span>
                    <span className="font-semibold text-slate-300">{_count}</span>
                  </button>
                )
              })}
              {(analytics.overdue ?? 0) > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-red-900 bg-red-950/30 text-red-400">
                  ⚠ {t.tasks.overdue} {analytics.overdue}
                </span>
              )}
              {filterStatus && (
                <button
                  onClick={() => setFilterStatus('')}
                  className="px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-300 border border-dashed border-slate-700"
                >
                  ✕ {t.tasks.resetFilters}
                </button>
              )}
            </div>
          )}

          {/* Filters — list mode only */}
          {/* Filters — list & board */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t.common.search}
                className="bg-surface-900 border border-slate-700 rounded-md pl-7 pr-3 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-primary-500 w-48"
              />
            </div>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as TaskPriority | '')}
              className="bg-surface-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value="">{t.tasks.allPriorities}</option>
              {ALL_PRIORITIES.map((p) => (
                <option key={p} value={p}>{t.tasks.priorities[p]}</option>
              ))}
            </select>

            {tags.length > 0 && (
              <select
                value={filterTagId}
                onChange={(e) => setFilterTagId(e.target.value)}
                className="bg-surface-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none"
              >
                <option value="">{t.tasks.tags}: {t.common.all}</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            )}

            {(filterStatus || filterPriority || filterTagId || searchText) && (
              <button
                onClick={() => { setFilterStatus(''); setFilterPriority(''); setFilterTagId(''); setSearchText('') }}
                className="btn-ghost text-xs text-red-400 hover:text-red-300"
              >
                {t.tasks.resetFilters}
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-primary-500" />
            </div>
          ) : viewMode === 'timereport' ? (
            /* ── TIME REPORT VIEW ────────────────────────────────── */
            <TimeReportView projectId={projectId!} />
          ) : viewMode === 'burndown' ? (
            /* ── BURNDOWN VIEW ───────────────────────────────────── */
            <BurndownView projectId={projectId!} />
          ) : viewMode === 'gantt' ? (
            /* ── GANTT VIEW ──────────────────────────────────────── */
            <GanttView tasks={allLoadedTasks} onTaskClick={setSelectedTask} />
          ) : viewMode === 'board' ? (
            /* ── BOARD VIEW ──────────────────────────────────────── */
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-3" style={{ minWidth: `${BOARD_STATUSES.length * 150 + (BOARD_STATUSES.length - 1) * 12}px` }}>
                {BOARD_STATUSES.map((status) => {
                  const cfg = STATUS_CONFIG[status]
                  const Icon = cfg.icon
                  const columnTasks = grouped[status]
                  return (
                    <div key={status} className="flex-1 min-w-[150px]">
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Icon size={13} className={cfg.color} />
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          {t.tasks.statuses[status]}
                        </span>
                        <span className="ml-auto text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                          {columnTasks.length}
                        </span>
                      </div>

                      <Droppable droppableId={status}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'min-h-20 rounded-xl p-2 transition-colors border',
                              snapshot.isDraggingOver ? 'bg-primary-600/10 border-primary-600/30' : '',
                            )}
                            style={snapshot.isDraggingOver ? undefined : { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                          >
                            {columnTasks.map((task, index) => (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(dragProvided, dragSnapshot) => (
                                  <KanbanCard
                                    task={task}
                                    provided={dragProvided}
                                    isDragging={dragSnapshot.isDragging}
                                    onClick={() => setSelectedTask(task)}
                                    onDelete={() => deleteTask.mutate(task.id)}
                                  />
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            <button
                              onClick={() => setShowCreate(true)}
                              className="w-full mt-1 py-1.5 text-xs hover:bg-black/5 rounded-lg transition-colors flex items-center justify-center gap-1"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              <Plus size={11} /> {t.tasks.newTask}
                            </button>
                          </div>
                        )}
                      </Droppable>
                    </div>
                  )
                })}
              </div>
            </DragDropContext>
          ) : tasks.length === 0 ? (
            /* ── EMPTY STATE ─────────────────────────────────────── */
            <div className="text-center py-20">
              <CheckCircle2 size={40} className="mx-auto text-slate-700 mb-3" />
              <p className="text-slate-500">{t.tasks.noTasks}</p>
              <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 mx-auto">
                <Plus size={14} /> {t.tasks.createTask}
              </button>
            </div>
          ) : filterStatus ? (
            /* ── LIST: single status ─────────────────────────────── */
            <div className="space-y-2 max-w-2xl">
              {tasks.map((task) => (
                <TaskCardRow
                  key={task.id}
                  task={task}
                  onStatusChange={(status) => updateStatus.mutate({ id: task.id, status })}
                  onDelete={() => deleteTask.mutate(task.id)}
                  onClick={() => setSelectedTask(task)}
                />
              ))}
            </div>
          ) : (
            /* ── LIST: grouped by status ─────────────────────────── */
            <div className="space-y-6 max-w-2xl">
              {ALL_STATUSES.filter((s) => grouped[s].length > 0).map((status) => {
                const cfg = STATUS_CONFIG[status]
                const Icon = cfg.icon
                return (
                  <section key={status}>
                    <div className="flex items-center gap-2 mb-2">
                      <Icon size={13} className={cfg.color} />
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        {t.tasks.statuses[status]}
                      </span>
                      <span className="text-xs text-slate-600">{grouped[status].length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {grouped[status].map((task) => (
                        <TaskCardRow
                          key={task.id}
                          task={task}
                          onStatusChange={(s) => updateStatus.mutate({ id: task.id, status: s })}
                          onDelete={() => deleteTask.mutate(task.id)}
                          onClick={() => setSelectedTask(task)}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projectId={projectId!}
      />

      {selectedTask && (
        <TaskEditModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => setSelectedTask(null)}
        />
      )}

      {showImport && (
        <ImportTasksModal
          projectId={projectId!}
          onClose={() => setShowImport(false)}
        />
      )}

      {showAiGenerate && (
        <AiGenerateTasksModal
          projectId={projectId!}
          onClose={() => setShowAiGenerate(false)}
        />
      )}

      {showAutomations && (
        <AutomationsModal
          projectId={projectId!}
          onClose={() => setShowAutomations(false)}
        />
      )}
    </div>
  )
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function KanbanCard({
  task,
  provided,
  isDragging,
  onClick,
  onDelete,
}: {
  task: Task
  provided: import('@hello-pangea/dnd').DraggableProvided
  isDragging: boolean
  onClick: () => void
  onDelete: () => void
}) {
  const intl = getIntlLocale(useLanguageStore().language)
  const t = useT()
  const priority = PRIORITY_CONFIG[task.priority]

  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={onClick}
      className={cn(
        'group mb-2 p-3 bg-surface-900 border rounded-lg cursor-grab active:cursor-grabbing select-none transition-shadow',
        isDragging
          ? 'border-primary-500 shadow-xl ring-1 ring-primary-500/30'
          : 'border-slate-800 hover:border-slate-700',
      )}
    >
      <div className="text-sm text-slate-200 leading-snug mb-2">{stripLeadingEmoji(task.title)}</div>
      <div className="flex items-center gap-2">
        <span className={cn('text-xs px-1.5 py-0.5 rounded-md', priority.bg, priority.color)}>
          {t.tasks.priorities[task.priority]}
        </span>
        {task.dueDate && (
          <span
            className={cn(
              'ml-auto text-xs',
              new Date(task.dueDate) < new Date() && task.status !== 'DONE'
                ? 'text-red-400'
                : 'text-slate-500',
            )}
          >
            {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── List row ──────────────────────────────────────────────────────────────────

function TaskCardRow({
  task,
  onStatusChange,
  onDelete,
  onClick,
}: {
  task: Task
  onStatusChange: (status: TaskStatus) => void
  onDelete: () => void
  onClick?: () => void
}) {
  const intl = getIntlLocale(useLanguageStore().language)
  const t = useT()
  const priority = PRIORITY_CONFIG[task.priority]
  const status = STATUS_CONFIG[task.status]
  const StatusIcon = status.icon

  return (
    <div onClick={onClick} className="group flex items-center gap-3 px-3 py-2.5 bg-surface-900 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors cursor-pointer">
      <button
        onClick={(e) => {
          e.stopPropagation()
          const next: TaskStatus =
            task.status === 'TODO' ? 'IN_PROGRESS'
            : task.status === 'IN_PROGRESS' ? 'REVIEW'
            : task.status === 'REVIEW' ? 'DONE'
            : 'TODO'
          onStatusChange(next)
        }}
        title={`${t.common.status}: ${t.tasks.statuses[task.status]}`}
        className="flex-shrink-0"
      >
        <StatusIcon size={15} className={status.color} />
      </button>

      <span className={cn('flex-1 text-sm truncate', task.status === 'DONE' ? 'line-through text-slate-500' : 'text-slate-200')}>
        {stripLeadingEmoji(task.title)}
      </span>

      <span className={cn('text-xs px-1.5 py-0.5 rounded-md hidden group-hover:inline-flex', priority.bg, priority.color)}>
        {t.tasks.priorities[task.priority]}
      </span>

      {task.dueDate && (
        <span className={cn('text-xs flex-shrink-0', new Date(task.dueDate) < new Date() && task.status !== 'DONE' ? 'text-red-400' : 'text-slate-500')}>
          {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
        </span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

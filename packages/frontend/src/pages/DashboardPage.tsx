import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FolderKanban, FileText, CheckSquare, Plus, Loader2, Clock, Calendar, CheckCircle2, AlertTriangle, Star, Sparkles, Flame, Check } from 'lucide-react'
import { workspaceApi, projectApi, pageApi, taskApi, calendarApi, habitApi, aiApi, type TaskStatus, type TaskPriority } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { formatDate } from '@/lib/utils'
import { renderIcon } from '@/components/common/EmojiPicker'
import { stripLeadingEmoji } from '@/lib/displayText'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/components/tasks/TaskCard'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale, getIntlLocale } from '@/i18n/dateLocale'
import { useLanguageStore } from '@/stores/languageStore'

export function DashboardPage() {
  const { currentWorkspaceId } = useWorkspaceStore()
  const { language } = useLanguageStore()
  const t = useT()
  const qc = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)

  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: workspaceApi.list,
  })

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', currentWorkspaceId],
    queryFn: () => projectApi.listByWorkspace(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })
  // The project LIST shows real projects only — modules and the system Inbox
  // live in their own sidebar sections. Page/task TOTALS, however, must still
  // count what sits in Inbox, otherwise the tiles read 0 while the lists below
  // clearly show pages and tasks.
  const projects = allProjects.filter((p) => !p.isModule && !p.isSystem)
  const countedProjects = allProjects.filter((p) => !p.isModule)

  const { data: recentPages = [] } = useQuery({
    queryKey: ['recent-pages', currentWorkspaceId],
    queryFn: () => pageApi.getRecent(currentWorkspaceId!, 8),
    enabled: !!currentWorkspaceId,
  })

  const { data: activeTasks } = useQuery({
    queryKey: ['dashboard-tasks', currentWorkspaceId],
    queryFn: () => taskApi.list({ workspaceId: currentWorkspaceId!, limit: 10 }),
    enabled: !!currentWorkspaceId,
    select: (d) => d.items.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS').slice(0, 6),
  })

  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['upcoming-events', currentWorkspaceId],
    queryFn: () => calendarApi.getUpcoming(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard-stats', currentWorkspaceId],
    queryFn: () => projectApi.getDashboard(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })

  const { data: habits = [] } = useQuery({
    queryKey: ['habits', currentWorkspaceId],
    queryFn: () => habitApi.list(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })

  const today = new Date().toISOString().slice(0, 10)
  const toggleHabit = useMutation({
    mutationFn: (id: string) => habitApi.toggle(id, today),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits', currentWorkspaceId] }),
  })

  const locale = getDateLocale(language)
  const intl = getIntlLocale(language)
  const timeAgo = (date: string) => formatDistanceToNow(new Date(date), { addSuffix: true, locale })

  const statsMap = new Map(dashboard?.projectStats.map((s) => [s.id, s]))

  const totalPages = countedProjects.reduce((sum, p) => sum + (p._count?.pages ?? 0), 0)
  const totalTasks = countedProjects.reduce((sum, p) => sum + (p._count?.tasks ?? 0), 0)
  const overdueCount = dashboard?.overdueTasks.length ?? 0
  const todayCount  = dashboard?.todayTasks.length ?? 0

  const [weeklyReport, setWeeklyReport] = useState<string | null>(null)
  const [showReport, setShowReport] = useState(false)

  const generateReport = useMutation({
    mutationFn: async () => {
      const projectSummary = projects.map((p) => {
        const stats = statsMap.get(p.id)
        const pct = stats && stats.totalTasks > 0 ? Math.round((stats.doneTasks / stats.totalTasks) * 100) : 0
        return `- ${p.name}: ${stats?.totalTasks ?? 0} tasks, ${pct}% done`
      }).join('\n')
      const overdueList = (dashboard?.overdueTasks ?? []).map((t) => `- ${t.title}`).join('\n')
      const upcomingList = upcomingEvents.slice(0, 5).map((e) => `- ${e.title} (${new Date(e.startAt).toLocaleDateString()})`).join('\n')

      const prompt = `You are a project management assistant. Generate a concise weekly status report in the user's language.

Projects:
${projectSummary || 'No projects'}

Overdue tasks:
${overdueList || 'None'}

Upcoming events:
${upcomingList || 'None'}

Write a short executive summary (3-5 sentences), highlight risks, and give 2-3 recommendations. Use markdown formatting.`

      const result: { report?: string } = {}
      await aiApi.streamChat(
        [{ role: 'user', content: prompt }],
        { workspaceId: currentWorkspaceId ?? undefined },
        (event) => {
          if (event.type === 'text' && event.text) {
            result.report = (result.report ?? '') + event.text
          }
        },
      )
      return result.report ?? 'No response from AI'
    },
    onSuccess: (report) => {
      setWeeklyReport(report)
      setShowReport(true)
    },
  })

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FolderKanban size={40} className="text-slate-600" />
        <h2 className="text-xl font-semibold text-slate-200">{t.dashboard.welcome}</h2>
        <p className="text-slate-500 text-sm">{t.dashboard.welcomeHint}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.dashboard.title}
        actions={
          currentWorkspaceId ? (
            <button
              onClick={() => generateReport.mutate()}
              disabled={generateReport.isPending}
              className="btn-ghost text-xs"
            >
              {generateReport.isPending
                ? <Loader2 size={13} className="animate-spin" />
                : <Sparkles size={13} />}
              {t.dashboard.weeklyReport}
            </button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-5 space-y-6">

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<FolderKanban size={16} />} label={t.dashboard.projects} value={projects.length} />
            <StatCard icon={<FileText size={16} />} label={t.dashboard.pages} value={totalPages} />
            <StatCard icon={<CheckSquare size={16} />} label={t.dashboard.tasks} value={totalTasks} />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label={t.dashboard.overdueTasks}
              value={overdueCount}
              urgent={overdueCount > 0}
            />
          </div>

          {/* Today + Overdue row */}
          {((dashboard?.todayTasks.length ?? 0) > 0 || (dashboard?.overdueTasks.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Today */}
              <section className="bg-surface-900 border border-slate-800 rounded-xl p-4">
                <SectionTitle icon={<Star size={13} className="text-yellow-400" />} label={t.dashboard.todayTasks} count={todayCount} />
                {dashboard!.todayTasks.length === 0 ? (
                  <EmptyState label={t.dashboard.noTodayTasks} />
                ) : (
                  <div className="space-y-1 mt-2">
                    {dashboard!.todayTasks.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </section>

              {/* Overdue */}
              <section className="bg-surface-900 border border-red-900/40 rounded-xl p-4">
                <SectionTitle icon={<AlertTriangle size={13} className="text-red-400" />} label={t.dashboard.overdueTasks} count={overdueCount} urgent />
                {dashboard!.overdueTasks.length === 0 ? (
                  <EmptyState label={t.dashboard.noOverdueTasks} />
                ) : (
                  <div className="space-y-1 mt-2">
                    {dashboard!.overdueTasks.map((task) => (
                      <TaskRow key={task.id} task={task} overdue />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Recent pages — compact horizontal strip */}
          <section>
            <SectionTitle icon={<Clock size={13} />} label={t.dashboard.recentPages} />
            {recentPages.length === 0 ? (
              <EmptyState label={t.dashboard.noRecentPages} />
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {recentPages.slice(0, 8).map((page) => (
                  <Link
                    key={page.id}
                    to={`/pages/${page.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-900 border border-slate-800 rounded-lg hover:border-slate-600 hover:text-slate-100 transition-colors group max-w-[260px]"
                  >
                    <span className="flex-shrink-0 text-slate-500">
                      {renderIcon(page.icon ?? 'lucide:FileText', 12, undefined, 'FileText')}
                    </span>
                    <span className="text-xs text-slate-300 truncate group-hover:text-slate-100">
                      {stripLeadingEmoji(page.title) || t.pages.untitled}
                    </span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0 ml-1">{timeAgo(page.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Main two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Left — Projects */}
            <section>
              <SectionTitle icon={<FolderKanban size={13} />} label={t.dashboard.projectsSection} />
              <div className="space-y-1.5">
                {projects.map((p) => {
                  const stats = statsMap.get(p.id)
                  const total = stats?.totalTasks ?? 0
                  const done  = stats?.doneTasks ?? 0
                  const pct   = total > 0 ? Math.round((done / total) * 100) : null
                  return (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="flex items-start gap-3 px-3 py-2.5 bg-surface-900 border border-slate-800 rounded-xl hover:border-slate-600 transition-colors group"
                    >
                      <span className="flex-shrink-0 mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg
                                       bg-gradient-to-br from-primary-500/15 to-primary-500/5
                                       border border-primary-500/20 text-primary-300 shadow-inner">
                        {renderIcon(p.icon ?? 'lucide:FolderKanban', 16, 'text-primary-300', 'FolderKanban')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate group-hover:text-white">{stripLeadingEmoji(p.name)}</p>
                        {pct !== null && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#22c55e' : '#6366f1' }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-600 flex-shrink-0">{done}/{total}</span>
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-slate-700 flex-shrink-0 mt-0.5">{formatDate(p.updatedAt)}</span>
                    </Link>
                  )
                })}
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-3 py-2 w-full rounded-xl text-slate-600 hover:text-slate-400 hover:bg-surface-800 transition-colors text-sm"
                >
                  <Plus size={13} /> {t.dashboard.newProject}
                </button>
              </div>
            </section>

            {/* Right — Tasks + Events */}
            <div className="space-y-6">
              <section>
                <SectionTitle icon={<CheckCircle2 size={13} />} label={t.dashboard.recentTasks} />
                {!activeTasks || activeTasks.length === 0 ? (
                  <EmptyState label={t.dashboard.noRecentTasks} />
                ) : (
                  <div className="space-y-0.5">
                    {activeTasks.map((task) => {
                      const cfg = STATUS_CONFIG[task.status as TaskStatus]
                      const Icon = cfg.icon
                      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()
                      return (
                        <Link
                          key={task.id}
                          to={`/projects/${task.projectId}/tasks?taskId=${task.id}`}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-800 transition-colors group"
                        >
                          <Icon size={13} className={cn('flex-shrink-0', cfg.color)} />
                          <span className="flex-1 text-sm text-slate-300 truncate group-hover:text-slate-100">
                            {stripLeadingEmoji(task.title)}
                          </span>
                          {task.dueDate && (
                            <span className={cn('text-xs flex-shrink-0', isOverdue ? 'text-red-400' : 'text-slate-600')}>
                              {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="border-t border-slate-800 pt-4">
                <SectionTitle icon={<Calendar size={13} />} label={t.dashboard.upcomingEvents} />
                {upcomingEvents.length === 0 ? (
                  <EmptyState label={t.dashboard.noEvents} />
                ) : (
                  <div className="space-y-0.5">
                    {upcomingEvents.slice(0, 6).map((event) => (
                      <div key={event.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: event.color ?? '#6366f1' }} />
                        <span className="flex-1 text-sm text-slate-300 truncate">{stripLeadingEmoji(event.title)}</span>
                        <span className="text-xs text-slate-600 flex-shrink-0">
                          {new Date(event.startAt).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Habits — today */}
              {habits.length > 0 && (
                <section className="border-t border-slate-800 pt-4">
                  <SectionTitle icon={<Flame size={13} className="text-orange-400" />} label={t.growth.habitsTab} />
                  <div className="space-y-0.5">
                    {habits.slice(0, 6).map((h) => {
                      const done = h.entries?.some((e) => e.date === today)
                      return (
                        <button
                          key={h.id}
                          onClick={() => toggleHabit.mutate(h.id)}
                          className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg hover:bg-surface-800 transition-colors group text-left"
                        >
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors"
                            style={done
                              ? { background: '#22c55e', borderColor: '#22c55e' }
                              : { borderColor: 'var(--border-strong)' }}
                          >
                            {done && <Check size={11} className="text-white" />}
                          </span>
                          <span className={cn('flex-1 text-sm truncate', done ? 'text-slate-500 line-through' : 'text-slate-300 group-hover:text-slate-100')}>
                            {stripLeadingEmoji(h.name)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      {showReport && weeklyReport && (
        <Modal open onClose={() => setShowReport(false)} title={t.dashboard.weeklyReport} className="max-w-2xl">
          <div className="max-h-[70vh] overflow-y-auto">
            <ReportMarkdown text={weeklyReport} />
          </div>
          <div className="flex justify-end pt-3 border-t border-slate-800 mt-3">
            <button onClick={() => setShowReport(false)} className="btn-ghost">{t.common.close}</button>
          </div>
        </Modal>
      )}

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}

function SectionTitle({ icon, label, count, urgent }: { icon: React.ReactNode; label: string; count?: number; urgent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className="text-slate-500">{icon}</span>
      <span className={cn('text-xs font-semibold uppercase tracking-wider', urgent ? 'text-red-400' : 'text-slate-400')}>
        {label}
      </span>
      {count !== undefined && count > 0 && (
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-bold', urgent ? 'bg-red-900/50 text-red-400' : 'bg-slate-800 text-slate-400')}>
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-xs text-slate-600 px-3 py-2">{label}</p>
}

function ReportMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="prose prose-invert prose-sm max-w-none space-y-2 text-slate-300">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h2 key={i} className="text-base font-semibold text-slate-100 mt-4">{line.slice(3)}</h2>
        if (line.startsWith('# ')) return <h1 key={i} className="text-lg font-bold text-slate-100 mt-4">{line.slice(2)}</h1>
        if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-semibold text-slate-200 mt-3">{line.slice(4)}</h3>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{line.slice(2)}</li>
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold text-slate-100 text-sm">{line.slice(2, -2)}</p>
        if (!line.trim()) return <div key={i} className="h-2" />
        return <p key={i} className="text-sm">{line}</p>
      })}
    </div>
  )
}

function StatCard({ icon, label, value, urgent, to }: { icon: React.ReactNode; label: string; value: number; urgent?: boolean; to?: string }) {
  const cls = cn('flex items-center gap-3 p-4 bg-surface-900 border rounded-xl transition-colors', urgent && value > 0 ? 'border-red-900/60' : 'border-slate-800', to && 'hover:border-slate-600')
  const inner = (
    <>
      <div className={cn(urgent && value > 0 ? 'text-red-400' : 'text-primary-500')}>{icon}</div>
      <div>
        <p className={cn('text-xl font-bold', urgent && value > 0 ? 'text-red-400' : 'text-slate-100')}>{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </>
  )
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}

function TaskRow({ task, overdue }: { task: { id: string; title: string; dueDate: string; priority: string; status: string; projectId: string }; overdue?: boolean }) {
  const { language } = useLanguageStore()
  const intl = getIntlLocale(language)
  const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority]
  return (
    <Link
      to={`/projects/${task.projectId}/tasks?taskId=${task.id}`}
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-surface-800 transition-colors group"
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', overdue ? 'bg-red-400' : priorityCfg?.bg ?? 'bg-slate-600')}
        style={!overdue ? { backgroundColor: undefined } : undefined}
      />
      <span className="flex-1 text-sm text-slate-300 truncate group-hover:text-slate-100">{stripLeadingEmoji(task.title)}</span>
      {task.dueDate && (
        <span className={cn('text-xs flex-shrink-0', overdue ? 'text-red-400' : 'text-slate-600')}>
          {new Date(task.dueDate).toLocaleDateString(intl, { day: 'numeric', month: 'short' })}
        </span>
      )}
    </Link>
  )
}


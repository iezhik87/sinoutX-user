import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Flame, Archive, Pencil, Trash2, Check, X, MoreHorizontal, RotateCcw } from 'lucide-react'
import { habitApi, type Habit } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'

const COLORS = ['#7c6af7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4']
const DEFAULT_ICONS = ['🔥', '💧', '🏃', '📚', '🧘', '💪', '🥗', '😴', '✍️', '🎯']

function getLast7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })
}

function calcStreak(entries: { date: string }[]): number {
  const dateSet = new Set(entries.map((e) => e.date))
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (dateSet.has(d.toISOString().slice(0, 10))) streak++
    else if (i > 0) break
  }
  return streak
}

function calcPeriodProgress(habit: Habit): { pct: number; done: number; total: number; endDate: string } | null {
  if (habit.period === 'forever') return null
  const days = { week: 7, month: 30, year: 365 }[habit.period]!
  const start = habit.startDate ?? habit.createdAt.slice(0, 10)
  const startMs = new Date(start).getTime()
  const endMs = startMs + days * 86400_000
  const endDate = new Date(endMs).toISOString().slice(0, 10)
  // Count entries within the period
  const done = habit.entries.filter((e) => e.date >= start && e.date <= endDate).length
  const pct = Math.min(100, Math.round((done / days) * 100))
  return { pct, done, total: days, endDate }
}

interface HabitFormProps {
  initial?: Partial<Habit>
  onSave: (data: { name: string; icon: string; color: string; period: Habit['period']; startDate: string }) => void
  onCancel: () => void
}

function HabitForm({ initial, onSave, onCancel }: HabitFormProps) {
  const t = useT()
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '🔥')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  const [period, setPeriod] = useState<Habit['period']>(initial?.period ?? 'forever')
  const [startDate, setStartDate] = useState(initial?.startDate ?? new Date().toISOString().slice(0, 10))
  const periods: Habit['period'][] = ['forever', 'week', 'month', 'year']

  return (
    <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <div className="relative">
          <select
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="appearance-none w-12 h-10 bg-surface-700 border border-slate-600 rounded-lg text-center text-lg cursor-pointer focus:outline-none"
          >
            {DEFAULT_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
          </select>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.habits.namePlaceholder}
          className="flex-1 bg-surface-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          autoFocus
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">{t.habits.color}:</span>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn('w-5 h-5 rounded-full transition-transform', color === c && 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-surface-800')}
            style={{ background: c }}
          />
        ))}
      </div>
      {/* Period selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500">{t.habits.period}:</span>
        <div className="flex rounded-lg overflow-hidden border border-slate-600">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                'px-2.5 py-1 text-xs transition-colors',
                period === p ? 'bg-primary-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-200',
              )}
            >
              {t.habits.periodLabels[p]}
            </button>
          ))}
        </div>
        {period !== 'forever' && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs text-slate-500">с</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-surface-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none"
            />
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-ghost text-sm">{t.common.cancel}</button>
        <button
          onClick={() => name.trim() && onSave({ name: name.trim(), icon, color, period, startDate })}
          disabled={!name.trim()}
          className="btn-primary text-sm"
        >
          {t.common.save}
        </button>
      </div>
    </div>
  )
}

interface HabitCardProps {
  habit: Habit
  days: string[]
  today: string
  onToggle: (date: string) => void
  onEdit: () => void
  onDelete: () => void
  onArchive: () => void
}

function HabitCard({ habit, days, today, onToggle, onEdit, onDelete, onArchive }: HabitCardProps) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const checkedSet = new Set(habit.entries.map((e) => e.date))
  const streak = calcStreak(habit.entries)
  const periodProgress = calcPeriodProgress(habit)
  const rate30 = Math.round(
    (Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - i)
      return d.toISOString().slice(0, 10)
    }).filter((d) => checkedSet.has(d)).length / 30) * 100,
  )

  const progressColor = (pct: number) => pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: `${habit.color ?? COLORS[0]}22`, border: `1.5px solid ${habit.color ?? COLORS[0]}44` }}
        >
          {habit.icon ?? '🔥'}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{habit.name}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {habit.period === 'forever' ? (
              <>
                {streak > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Flame size={11} /> {streak} {t.habits.streak}
                  </span>
                )}
                <span className="text-xs text-slate-500">{rate30}% {t.habits.rate}</span>
              </>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: `${habit.color ?? COLORS[0]}22`, color: habit.color ?? COLORS[0] }}>
                {t.habits.periodLabels[habit.period]}
              </span>
            )}
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-slate-600 hover:text-slate-400 transition-colors"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-10 rounded-lg shadow-xl py-1 w-36 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
              <button onClick={() => { onEdit(); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
                <Pencil size={11} /> {t.habits.editHabit}
              </button>
              <button onClick={() => { onArchive(); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
                <Archive size={11} /> {t.habits.archive}
              </button>
              <button onClick={() => { onDelete(); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs text-red-500 flex items-center gap-2 hover:bg-black/5">
                <Trash2 size={11} /> {t.habits.deleteHabit}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Period progress bar */}
      {periodProgress && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">{periodProgress.done}/{periodProgress.total} {t.habits.periodProgress}</span>
            <span className="text-xs font-bold" style={{ color: progressColor(periodProgress.pct) }}>{periodProgress.pct}%</span>
          </div>
          <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${periodProgress.pct}%`, background: habit.color ?? COLORS[0] }}
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">{t.habits.periodEnd}: {periodProgress.endDate}</p>
        </div>
      )}

      {/* 7-day grid */}
      <div className="flex gap-1.5">
        {days.map((day, i) => {
          const isToday = day === today
          const checked = checkedSet.has(day)
          const isFuture = day > today
          return (
            <button
              key={day}
              disabled={isFuture}
              onClick={() => !isFuture && onToggle(day)}
              className={cn(
                'flex-1 rounded-lg flex flex-col items-center gap-0.5 py-1.5 transition-all',
                isFuture ? 'opacity-30 cursor-default' : 'hover:scale-105 cursor-pointer',
                checked
                  ? 'text-white'
                  : isToday
                  ? 'bg-surface-700 border border-slate-600 text-slate-400'
                  : 'bg-surface-900 text-slate-600',
              )}
              style={checked ? { background: habit.color ?? COLORS[0] } : undefined}
            >
              <span className="text-[9px] leading-none">{t.habits.weekDays[i === 6 ? 6 : i]}</span>
              {checked
                ? <Check size={10} />
                : <span className="w-2 h-2 rounded-full bg-current opacity-30" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function HabitsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT()
  const qc = useQueryClient()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const days = getLast7Days()

  const { data: habits = [] } = useQuery({
    queryKey: ['habits', workspaceId, showArchived],
    queryFn: () => habitApi.list(workspaceId!, showArchived),
    enabled: !!workspaceId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['habits', workspaceId] })
    qc.invalidateQueries({ queryKey: ['habits', workspaceId, true] })
    qc.invalidateQueries({ queryKey: ['habits', workspaceId, false] })
  }

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof habitApi.create>[1]) => habitApi.create(workspaceId!, data),
    onSuccess: () => { invalidate(); setShowAdd(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof habitApi.update>[1] }) => habitApi.update(id, data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => habitApi.delete(id),
    onSuccess: invalidate,
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => habitApi.toggle(id, date),
    onSuccess: invalidate,
  })

  const activeHabits = habits.filter((h) => !h.archived)
  const archivedHabits = habits.filter((h) => h.archived)

  const actions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setShowArchived((v) => !v)}
        className={cn('btn-ghost text-xs flex items-center gap-1.5', showArchived && 'text-primary-400')}
      >
        {showArchived ? <RotateCcw size={12} /> : <Archive size={12} />}
        {showArchived ? t.habits.hideArchived : t.habits.showArchived}
      </button>
      <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 text-sm">
        <Plus size={14} /> {t.habits.addHabit}
      </button>
    </div>
  )

  const content = (
    <div className={cn('flex-1 overflow-y-auto p-4', embedded && 'md:p-4', !embedded && 'md:p-6')}>
      <div className="max-w-2xl mx-auto space-y-4">
        {embedded && (
          <div className="flex items-center justify-between mb-2">
            {actions}
          </div>
        )}
        {showAdd && (
          <HabitForm
            onSave={(data) => createMut.mutate(data)}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {activeHabits.length === 0 && !showAdd && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-3">🔥</span>
            <p className="text-slate-400 text-sm">{t.habits.noHabits}</p>
            {!embedded && (
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4 flex items-center gap-1.5">
                <Plus size={14} /> {t.habits.addHabit}
              </button>
            )}
          </div>
        )}

        {activeHabits.map((habit) =>
          editingId === habit.id ? (
            <HabitForm
              key={habit.id}
              initial={habit}
              onSave={(data) => updateMut.mutate({ id: habit.id, data })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <HabitCard
              key={habit.id}
              habit={habit}
              days={days}
              today={today}
              onToggle={(date) => toggleMut.mutate({ id: habit.id, date })}
              onEdit={() => setEditingId(habit.id)}
              onDelete={() => deleteMut.mutate(habit.id)}
              onArchive={() => updateMut.mutate({ id: habit.id, data: { archived: true } })}
            />
          ),
        )}

        {showArchived && archivedHabits.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
              <Archive size={11} /> {t.habits.archived}
            </p>
            <div className="space-y-3 opacity-60">
              {archivedHabits.map((habit) => (
                <div key={habit.id} className="bg-surface-800 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                  <span className="text-xl">{habit.icon ?? '🔥'}</span>
                  <span className="flex-1 text-sm text-slate-400">{habit.name}</span>
                  <button
                    onClick={() => updateMut.mutate({ id: habit.id, data: { archived: false } })}
                    className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
                  >
                    <RotateCcw size={11} /> Restore
                  </button>
                  <button
                    onClick={() => deleteMut.mutate(habit.id)}
                    className="text-slate-600 hover:text-red-400"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (embedded) {
    return <div className="flex flex-col h-full">{content}</div>
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={t.habits.title} actions={actions} />
      {content}
    </div>
  )
}

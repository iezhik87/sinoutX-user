import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Check, Target, X, MoreHorizontal, Calendar } from 'lucide-react'
import { okrApi, type Objective, type KeyResult } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'
import { Header } from '@/components/layout/Header'
import { cn } from '@/lib/utils'

function progressColor(pct: number): string {
  if (pct >= 70) return '#10b981'
  if (pct >= 40) return '#f59e0b'
  return '#ef4444'
}

function ProgressRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const color = progressColor(pct)
  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  )
}

function calcObjProgress(obj: Objective): number {
  const { progressMode, manualProgress, deadline, keyResults } = obj

  if (progressMode === 'manual') return Math.round(manualProgress)

  if (progressMode === 'time') {
    if (!deadline) return 0
    const now = Date.now()
    const start = new Date(obj.createdAt).getTime()
    const end = new Date(deadline).getTime()
    if (end <= start) return 100
    return Math.min(100, Math.round(((now - start) / (end - start)) * 100))
  }

  // 'kr' mode
  if (!keyResults.length) return 0
  const sum = keyResults.reduce((s, kr) => {
    const pct = kr.target > 0 ? Math.min(100, (kr.current / kr.target) * 100) : 0
    return s + pct
  }, 0)
  return Math.round(sum / keyResults.length)
}

function getDaysInfo(deadline: string | null, tk: { today: string; daysShort: string }): { label: string; color: string } | null {
  if (!deadline) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const end = new Date(deadline)
  end.setHours(0, 0, 0, 0)
  const diff = Math.round((end.getTime() - now.getTime()) / 86400_000)
  if (diff > 0) return { label: `${diff} ${tk.daysShort}`, color: diff < 7 ? '#f59e0b' : '#64748b' }
  if (diff === 0) return { label: tk.today, color: '#f59e0b' }
  return { label: `+${Math.abs(diff)} ${tk.daysShort}`, color: '#ef4444' }
}

interface KRRowProps {
  kr: KeyResult
  onUpdate: (data: Partial<KeyResult>) => void
  onDelete: () => void
}

function KRRow({ kr, onUpdate, onDelete }: KRRowProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(kr.current))
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(kr.title)
  const isPct = kr.unit === '%' || (kr.target === 100 && !kr.unit)
  const pct = kr.target > 0 ? Math.min(100, (kr.current / kr.target) * 100) : 0

  const commit = () => {
    const n = parseFloat(val)
    if (!isNaN(n)) onUpdate({ current: Math.min(isPct ? 100 : Infinity, Math.max(0, n)) })
    setEditing(false)
  }

  const commitTitle = () => {
    if (titleVal.trim() && titleVal.trim() !== kr.title) onUpdate({ title: titleVal.trim() })
    setEditingTitle(false)
  }

  return (
    <div className="flex items-center gap-3 py-2 group">
      <button
        onClick={() => onUpdate({ status: kr.status === 'completed' ? 'active' : 'completed' })}
        className={cn(
          'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
          kr.status === 'completed' ? 'bg-green-600 border-green-600' : 'border-slate-600 hover:border-green-500',
        )}
      >
        {kr.status === 'completed' && <Check size={9} className="text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        {editingTitle ? (
          <input
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleVal(kr.title); setEditingTitle(false) } }}
            className="w-full bg-surface-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            autoFocus
          />
        ) : (
          <p
            onDoubleClick={() => { setTitleVal(kr.title); setEditingTitle(true) }}
            title={t.okr.dblClickEdit}
            className={cn('text-xs text-slate-300 truncate cursor-text', kr.status === 'completed' && 'line-through text-slate-500')}
          >
            {kr.title}
          </p>
        )}

        {isPct ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              type="range" min="0" max="100" step="1"
              value={kr.current}
              onChange={(e) => onUpdate({ current: parseFloat(e.target.value) })}
              className="flex-1 max-w-[140px] h-1 accent-primary-500 cursor-pointer"
            />
            <span className="text-[11px] font-medium tabular-nums w-7" style={{ color: progressColor(pct) }}>
              {Math.round(kr.current)}%
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1 bg-surface-700 rounded-full overflow-hidden max-w-[110px]">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: progressColor(pct) }} />
            </div>
            {editing ? (
              <input
                type="number" min="0"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                className="w-16 bg-surface-700 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-slate-200 focus:outline-none"
                autoFocus
              />
            ) : (
              <button onClick={() => { setEditing(true); setVal(String(kr.current)) }} className="text-[11px] text-slate-400 hover:text-slate-200">
                {kr.current}{kr.unit ? ` ${kr.unit}` : ''} / {kr.target}{kr.unit ? ` ${kr.unit}` : ''}
              </button>
            )}
            <span className="text-[10px] font-medium" style={{ color: progressColor(pct) }}>{Math.round(pct)}%</span>
          </div>
        )}
      </div>

      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 flex-shrink-0">
        <X size={11} />
      </button>
    </div>
  )
}

interface AddKRFormProps {
  onAdd: (data: { title: string; target: number; unit?: string }) => void
  onCancel: () => void
}

function AddKRForm({ onAdd, onCancel }: AddKRFormProps) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [isPct, setIsPct] = useState(true)
  const [target, setTarget] = useState('10')
  const [unit, setUnit] = useState('')

  function handleAdd() {
    if (!title.trim()) return
    if (isPct) {
      onAdd({ title: title.trim(), target: 100, unit: '%' })
    } else {
      onAdd({ title: title.trim(), target: parseFloat(target) || 10, unit: unit.trim() || undefined })
    }
  }

  return (
    <div className="mt-2 pl-7 space-y-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        placeholder={t.okr.krPlaceholder}
        className="w-full bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        autoFocus
      />
      <div className="flex items-center gap-1.5">
        <div className="flex rounded overflow-hidden border border-slate-600 text-[11px]">
          <button
            onClick={() => setIsPct(true)}
            className={cn('px-2 py-1 transition-colors', isPct ? 'bg-primary-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-200')}
          >%</button>
          <button
            onClick={() => setIsPct(false)}
            className={cn('px-2 py-1 transition-colors', !isPct ? 'bg-primary-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-200')}
          >123</button>
        </div>
        {isPct ? (
          <span className="text-[11px] text-slate-500">0–100%</span>
        ) : (
          <>
            <input value={target} onChange={(e) => setTarget(e.target.value)} type="number"
              placeholder={t.okr.target}
              className="w-16 bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none" />
            <input value={unit} onChange={(e) => setUnit(e.target.value)}
              placeholder={t.okr.unitPlaceholder}
              className="w-16 bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none" />
          </>
        )}
        <button onClick={handleAdd} disabled={!title.trim()} className="btn-primary text-xs py-1 px-2">{t.common.add}</button>
        <button onClick={onCancel} className="btn-ghost text-xs py-1 px-2">{t.common.cancel}</button>
      </div>
    </div>
  )
}

interface ObjectiveCardProps {
  obj: Objective
  onUpdate: (data: Partial<Objective>) => void
  onDelete: () => void
  onAddKR: (data: { title: string; target: number; unit?: string }) => void
  onUpdateKR: (id: string, data: Partial<KeyResult>) => void
  onDeleteKR: (id: string) => void
}

function ObjectiveCard({ obj, onUpdate, onDelete, onAddKR, onUpdateKR, onDeleteKR }: ObjectiveCardProps) {
  const t = useT()
  const pct = calcObjProgress(obj)
  const [showAddKR, setShowAddKR] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(obj.title)
  const [showDeadline, setShowDeadline] = useState(false)
  const daysInfo = getDaysInfo(obj.deadline, t.okr)
  const modes: Objective['progressMode'][] = ['kr', 'time', 'manual']

  return (
    <div className={cn(
      'bg-surface-800 border rounded-2xl p-5 transition-colors',
      obj.status === 'completed' ? 'border-green-800/50' : obj.status === 'cancelled' ? 'border-slate-800 opacity-60' : 'border-slate-700',
    )}>
      <div className="flex items-start gap-4">
        {/* Progress ring */}
        <div className="relative flex-shrink-0">
          <ProgressRing pct={pct} size={52} />
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold" style={{ color: progressColor(pct) }}>
            {pct}%
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onBlur={() => { if (titleVal.trim()) onUpdate({ title: titleVal.trim() }); setEditingTitle(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { if (titleVal.trim()) onUpdate({ title: titleVal.trim() }); setEditingTitle(false) } if (e.key === 'Escape') setEditingTitle(false) }}
              className="w-full bg-surface-700 border border-slate-600 rounded px-2 py-1 text-sm font-semibold text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
              autoFocus
            />
          ) : (
            <p
              onClick={() => setEditingTitle(true)}
              className={cn('text-sm font-semibold text-slate-100 cursor-text hover:text-white', obj.status === 'completed' && 'line-through text-slate-400')}
            >
              {obj.title}
            </p>
          )}
          {obj.description && <p className="text-xs text-slate-500 mt-0.5">{obj.description}</p>}

          {/* Meta row: mode + deadline */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Progress mode toggle */}
            <div className="flex rounded overflow-hidden border border-slate-700 text-[10px]">
              {modes.map((m) => (
                <button
                  key={m}
                  onClick={() => onUpdate({ progressMode: m })}
                  className={cn(
                    'px-1.5 py-0.5 transition-colors',
                    obj.progressMode === m ? 'bg-primary-700 text-white' : 'bg-surface-700 text-slate-500 hover:text-slate-300',
                  )}
                >
                  {t.okr.progressModes[m]}
                </button>
              ))}
            </div>

            {/* Deadline */}
            <button
              onClick={() => setShowDeadline((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Calendar size={10} />
              {obj.deadline
                ? <span style={{ color: daysInfo?.color }}>{new Date(obj.deadline).toLocaleDateString()} · {daysInfo?.label}</span>
                : <span>{t.okr.noDeadline}</span>}
            </button>
          </div>

          {/* Deadline picker */}
          {showDeadline && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="date"
                defaultValue={obj.deadline ? obj.deadline.slice(0, 10) : ''}
                onChange={(e) => { onUpdate({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null }); setShowDeadline(false) }}
                className="bg-surface-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none"
                autoFocus
              />
              {obj.deadline && (
                <button onClick={() => { onUpdate({ deadline: null }); setShowDeadline(false) }} className="text-xs text-red-400 hover:text-red-300">
                  <X size={11} />
                </button>
              )}
            </div>
          )}

          {/* Manual progress slider */}
          {obj.progressMode === 'manual' && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="range" min="0" max="100" step="1"
                value={obj.manualProgress}
                onChange={(e) => onUpdate({ manualProgress: parseFloat(e.target.value) })}
                className="flex-1 max-w-[160px] h-1 accent-primary-500 cursor-pointer"
              />
              <span className="text-xs font-medium w-9" style={{ color: progressColor(pct) }}>
                {Math.round(obj.manualProgress)}%
              </span>
            </div>
          )}

          {/* Time progress info */}
          {obj.progressMode === 'time' && obj.deadline && (
            <p className="text-[10px] text-slate-500 mt-1">{t.okr.timeProgress}: {pct}%</p>
          )}

          {/* Status badge */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', {
              'bg-green-950 text-green-400': obj.status === 'completed',
              'bg-amber-950 text-amber-400': obj.status === 'active' && pct < 40,
              'bg-blue-950 text-blue-400': obj.status === 'active' && pct >= 40,
              'bg-slate-800 text-slate-500': obj.status === 'cancelled',
            })}>
              {obj.status === 'completed' ? t.okr.completed : pct >= 40 ? t.okr.onTrack : t.okr.atRisk}
            </span>
            {obj.progressMode === 'kr' && (
              <span className="text-[10px] text-slate-600">{obj.keyResults.length} {t.okr.keyResult.toLowerCase()}</span>
            )}
          </div>
        </div>

        {/* Menu */}
        <div className="relative flex-shrink-0">
          <button onClick={() => setMenuOpen((v) => !v)} className="p-1 text-slate-600 hover:text-slate-400">
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-10 bg-surface-700 border border-slate-600 rounded-lg shadow-xl py-1 w-44">
              <button onClick={() => { onUpdate({ status: obj.status === 'completed' ? 'active' : 'completed' }); setMenuOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-600 flex items-center gap-2">
                <Check size={11} /> {obj.status === 'completed' ? 'Открыть' : t.okr.statuses.completed}
              </button>
              <button onClick={() => { onUpdate({ status: 'cancelled' }); setMenuOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-600 flex items-center gap-2">
                <X size={11} /> {t.okr.statuses.cancelled}
              </button>
              <button onClick={() => { onDelete(); setMenuOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-surface-600 flex items-center gap-2">
                <Trash2 size={11} /> {t.common.delete}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Key Results (only in kr mode) */}
      {obj.progressMode === 'kr' && obj.keyResults.length > 0 && (
        <div className="mt-4 pl-2 border-l border-slate-700 space-y-0.5">
          {obj.keyResults.map((kr) => (
            <KRRow
              key={kr.id}
              kr={kr}
              onUpdate={(data) => onUpdateKR(kr.id, data)}
              onDelete={() => onDeleteKR(kr.id)}
            />
          ))}
        </div>
      )}

      {obj.progressMode === 'kr' && (showAddKR ? (
        <AddKRForm onAdd={(data) => { onAddKR(data); setShowAddKR(false) }} onCancel={() => setShowAddKR(false)} />
      ) : (
        <button
          onClick={() => setShowAddKR(true)}
          className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-primary-400 transition-colors"
        >
          <Plus size={11} /> {t.okr.addKR}
        </button>
      ))}
    </div>
  )
}

export function OKRPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT()
  const qc = useQueryClient()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const { data: objectives = [] } = useQuery({
    queryKey: ['objectives', workspaceId],
    queryFn: () => okrApi.list(workspaceId!),
    enabled: !!workspaceId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['objectives', workspaceId] })

  const createMut = useMutation({
    mutationFn: () => okrApi.create(workspaceId!, { title: newTitle.trim(), description: newDesc.trim() || undefined }),
    onSuccess: () => { invalidate(); setShowAdd(false); setNewTitle(''); setNewDesc('') },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof okrApi.update>[1] }) => okrApi.update(id, data),
    onSuccess: invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => okrApi.delete(id),
    onSuccess: invalidate,
  })

  const addKRMut = useMutation({
    mutationFn: ({ objectiveId, data }: { objectiveId: string; data: Parameters<typeof okrApi.addKR>[1] }) =>
      okrApi.addKR(objectiveId, data),
    onSuccess: invalidate,
  })

  const updateKRMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof okrApi.updateKR>[1] }) => okrApi.updateKR(id, data),
    onSuccess: invalidate,
  })

  const deleteKRMut = useMutation({
    mutationFn: (id: string) => okrApi.deleteKR(id),
    onSuccess: invalidate,
  })

  const active = objectives.filter((o) => o.status === 'active')
  const done = objectives.filter((o) => o.status === 'completed')
  const cancelled = objectives.filter((o) => o.status === 'cancelled')

  const overallPct = active.length
    ? Math.round(active.reduce((s, o) => s + calcObjProgress(o), 0) / active.length)
    : 0

  const addBtn = (
    <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 text-sm">
      <Plus size={14} /> {t.okr.addObjective}
    </button>
  )

  const content = (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {embedded && <div className="flex justify-end mb-2">{addBtn}</div>}

        {/* Overall progress bar */}
        {active.length > 0 && (
          <div className="bg-surface-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-4">
            <Target size={16} className="text-primary-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400">{t.okr.overall}</span>
                <span className="text-xs font-bold" style={{ color: progressColor(overallPct) }}>{overallPct}%</span>
              </div>
              <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${overallPct}%`, background: progressColor(overallPct) }} />
              </div>
            </div>
            <span className="text-xs text-slate-500">{active.length} {t.okr.objective.toLowerCase()}</span>
          </div>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="bg-surface-800 border border-slate-700 rounded-2xl p-4 space-y-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t.okr.objectivePlaceholder}
              className="w-full bg-surface-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={`${t.common.description}...`}
              className="w-full bg-surface-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-400 placeholder-slate-600 focus:outline-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t.common.cancel}</button>
              <button onClick={() => createMut.mutate()} disabled={!newTitle.trim()} className="btn-primary text-sm">{t.common.create}</button>
            </div>
          </div>
        )}

        {objectives.length === 0 && !showAdd && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Target size={40} className="text-slate-700 mb-3" />
            <p className="text-slate-400 text-sm">{t.okr.noObjectives}</p>
            {!embedded && (
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4 flex items-center gap-1.5">
                <Plus size={14} /> {t.okr.addObjective}
              </button>
            )}
          </div>
        )}

        {/* Active */}
        {active.map((obj) => (
          <ObjectiveCard
            key={obj.id}
            obj={obj}
            onUpdate={(data) => updateMut.mutate({ id: obj.id, data })}
            onDelete={() => deleteMut.mutate(obj.id)}
            onAddKR={(data) => addKRMut.mutate({ objectiveId: obj.id, data })}
            onUpdateKR={(id, data) => updateKRMut.mutate({ id, data })}
            onDeleteKR={(id) => deleteKRMut.mutate(id)}
          />
        ))}

        {/* Completed */}
        {done.length > 0 && (
          <div>
            <p className="text-xs text-slate-600 mb-2 flex items-center gap-1.5"><Check size={11} /> {t.okr.statuses.completed} · {done.length}</p>
            <div className="space-y-3 opacity-70">
              {done.map((obj) => (
                <ObjectiveCard
                  key={obj.id}
                  obj={obj}
                  onUpdate={(data) => updateMut.mutate({ id: obj.id, data })}
                  onDelete={() => deleteMut.mutate(obj.id)}
                  onAddKR={(data) => addKRMut.mutate({ objectiveId: obj.id, data })}
                  onUpdateKR={(id, data) => updateKRMut.mutate({ id, data })}
                  onDeleteKR={(id) => deleteKRMut.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Cancelled */}
        {cancelled.length > 0 && (
          <div>
            <p className="text-xs text-slate-600 mb-2 flex items-center gap-1.5"><X size={11} /> {t.okr.statuses.cancelled} · {cancelled.length}</p>
            <div className="space-y-3 opacity-50">
              {cancelled.map((obj) => (
                <ObjectiveCard
                  key={obj.id}
                  obj={obj}
                  onUpdate={(data) => updateMut.mutate({ id: obj.id, data })}
                  onDelete={() => deleteMut.mutate(obj.id)}
                  onAddKR={(data) => addKRMut.mutate({ objectiveId: obj.id, data })}
                  onUpdateKR={(id, data) => updateKRMut.mutate({ id, data })}
                  onDeleteKR={(id) => deleteKRMut.mutate(id)}
                />
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
      <Header title={t.okr.title} actions={addBtn} />
      {content}
    </div>
  )
}

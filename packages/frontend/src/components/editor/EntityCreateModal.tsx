import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckSquare, StickyNote, DollarSign } from 'lucide-react'
import { taskApi, noteApi, budgetApi, graphApi } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

export type EntityType = 'task' | 'note' | 'budget'

interface Props {
  type: EntityType
  projectId: string
  workspaceId: string
  pageId: string
  onCreated: (entityId: string, label: string, type: EntityType) => void
  onClose: () => void
}

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

const ICONS: Record<EntityType, React.ReactNode> = {
  task:   <CheckSquare size={14} />,
  note:   <StickyNote size={14} />,
  budget: <DollarSign size={14} />,
}

export function EntityCreateModal({ type, projectId, workspaceId, pageId, onCreated, onClose }: Props) {
  const qc = useQueryClient()
  const t = useT()
  const [saving, setSaving] = useState(false)

  // Task fields
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPriority, setTaskPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM')

  // Note fields
  const [noteText, setNoteText] = useState('')

  // Budget fields
  const [budgetDesc, setBudgetDesc] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetType, setBudgetType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE')
  const [budgetCategory, setBudgetCategory] = useState(t.entityCreate.defaultCategory)

  const TITLES: Record<EntityType, string> = {
    task:   t.entityCreate.newTask,
    note:   t.entityCreate.newNote,
    budget: t.entityCreate.newBudget,
  }

  async function handleCreate() {
    setSaving(true)
    try {
      let entityId = ''
      let label = ''

      if (type === 'task') {
        const task = await taskApi.create({
          projectId,
          title: taskTitle.trim() || t.pages.untitled,
          priority: taskPriority,
        })
        entityId = task.id
        label = task.title
        qc.invalidateQueries({ queryKey: ['tasks'] })
        qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
      } else if (type === 'note') {
        const note = await noteApi.create({
          workspaceId,
          projectId,
          content: noteText.trim()
            ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: noteText.trim() }] }] }
            : EMPTY_DOC,
          pinned: false,
        })
        entityId = note.id
        label = noteText.trim().slice(0, 40) || t.notes.title
        qc.invalidateQueries({ queryKey: ['notes'] })
      } else if (type === 'budget') {
        const entry = await budgetApi.create({
          projectId,
          type: budgetType,
          category: budgetCategory.trim() || t.entityCreate.defaultCategory,
          amount: parseFloat(budgetAmount) || 0,
          currency: 'RUB',
          date: new Date().toISOString(),
          description: budgetDesc.trim() || undefined,
        })
        entityId = entry.id
        label = `${budgetDesc.trim() || budgetCategory} ${budgetAmount ? `(${budgetAmount} ₽)` : ''}`
        qc.invalidateQueries({ queryKey: ['budget'] })
      }

      // Create graph link: page → entity
      await graphApi.createLink({
        workspaceId,
        sourceType: 'page',
        sourceId: pageId,
        targetType: type,
        targetId: entityId,
        linkType: 'REFERENCE',
      })
      qc.invalidateQueries({ queryKey: ['graph'] })

      onCreated(entityId, label, type)
    } finally {
      setSaving(false)
    }
  }

  const canSubmit =
    type === 'task'   ? taskTitle.trim().length > 0 :
    type === 'note'   ? true :
    /* budget */        budgetAmount.length > 0 && !isNaN(parseFloat(budgetAmount))

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2">{ICONS[type]}{TITLES[type]}</span>}>
      <div className="space-y-3">
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

        {type === 'budget' && (
          <>
            <div className="flex gap-2">
              {(['EXPENSE', 'INCOME'] as const).map((bt) => (
                <button
                  key={bt}
                  onClick={() => setBudgetType(bt)}
                  className={cn(
                    'flex-1 py-1.5 rounded-md text-xs font-medium transition-colors',
                    budgetType === bt ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
                  )}
                >
                  {bt === 'EXPENSE' ? t.entityCreate.budgetExpense : t.entityCreate.budgetIncome}
                </button>
              ))}
            </div>
            <input
              autoFocus
              placeholder={t.entityCreate.budgetDescription}
              value={budgetDesc}
              onChange={(e) => setBudgetDesc(e.target.value)}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={t.entityCreate.budgetCategory}
                value={budgetCategory}
                onChange={(e) => setBudgetCategory(e.target.value)}
                className="bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="relative">
                <input
                  type="number"
                  placeholder={t.entityCreate.budgetAmount}
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleCreate()}
                  className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 pr-7 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">₽</span>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button onClick={handleCreate} disabled={!canSubmit || saving} className="btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : t.entityCreate.createAndInsert}
          </button>
        </div>
      </div>
    </Modal>
  )
}

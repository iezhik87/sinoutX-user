import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Zap, ToggleLeft, ToggleRight } from 'lucide-react'
import { automationApi, type AutomationRule, type AutomationTrigger, type AutomationAction } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

const STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

const TRIGGERS: AutomationTrigger[] = ['status_changed_to', 'priority_changed_to', 'task_created', 'task_assigned']
// add_tag / send_notification are not implemented on the backend yet — hidden
// from the UI so we don't surface non-working actions.
const ACTIONS: AutomationAction[] = ['set_status', 'set_priority', 'set_due_today']

function needsTriggerValue(trigger: AutomationTrigger): boolean {
  return trigger === 'status_changed_to' || trigger === 'priority_changed_to'
}

function needsActionValue(action: AutomationAction): boolean {
  return action === 'set_status' || action === 'set_priority' || action === 'add_tag' || action === 'send_notification'
}

function TriggerValueSelect({ trigger, value, onChange }: {
  trigger: AutomationTrigger
  value: string
  onChange: (v: string) => void
}) {
  const opts = trigger === 'status_changed_to' ? STATUSES : PRIORITIES
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
      <option value="">—</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function ActionValueSelect({ action, value, onChange }: {
  action: AutomationAction
  value: string
  onChange: (v: string) => void
}) {
  if (action === 'set_status') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
        <option value="">—</option>
        {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (action === 'set_priority') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
        <option value="">—</option>
        {PRIORITIES.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value..."
      className="bg-surface-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500 w-32"
    />
  )
}

interface AddRuleFormProps {
  projectId: string
  onSave: (rule: Omit<AutomationRule, 'id' | 'projectId' | 'createdAt'>) => void
  onCancel: () => void
}

function AddRuleForm({ onSave, onCancel }: AddRuleFormProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTrigger>('status_changed_to')
  const [triggerValue, setTriggerValue] = useState('')
  const [action, setAction] = useState<AutomationAction>('set_priority')
  const [actionValue, setActionValue] = useState('')

  const canSave = name.trim() &&
    (!needsTriggerValue(trigger) || triggerValue) &&
    (!needsActionValue(action) || actionValue)

  return (
    <div className="bg-surface-700 border border-slate-600 rounded-xl p-4 space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.automation.ruleNamePlaceholder}
        className="w-full bg-surface-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
        autoFocus
      />

      {/* WHEN */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-amber-400 w-10">{t.automation.when}</span>
        <select
          value={trigger}
          onChange={(e) => { setTrigger(e.target.value as AutomationTrigger); setTriggerValue('') }}
          className="bg-surface-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
        >
          {TRIGGERS.map((tr) => (
            <option key={tr} value={tr}>{t.automation.triggers[tr]}</option>
          ))}
        </select>
        {needsTriggerValue(trigger) && (
          <TriggerValueSelect trigger={trigger} value={triggerValue} onChange={setTriggerValue} />
        )}
      </div>

      {/* THEN */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-green-400 w-10">{t.automation.then}</span>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value as AutomationAction); setActionValue('') }}
          className="bg-surface-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
        >
          {ACTIONS.map((ac) => (
            <option key={ac} value={ac}>{t.automation.actions[ac]}</option>
          ))}
        </select>
        {needsActionValue(action) && (
          <ActionValueSelect action={action} value={actionValue} onChange={setActionValue} />
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="btn-ghost text-sm">{t.common.cancel}</button>
        <button
          onClick={() => canSave && onSave({ name: name.trim(), enabled: true, trigger, triggerValue: triggerValue || null, action, actionValue: actionValue || null })}
          disabled={!canSave}
          className="btn-primary text-sm"
        >{t.common.save}</button>
      </div>
    </div>
  )
}

interface Props {
  projectId: string
  onClose: () => void
}

export function AutomationsModal({ projectId, onClose }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: rules = [] } = useQuery({
    queryKey: ['automations', projectId],
    queryFn: () => automationApi.list(projectId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automations', projectId] })

  const createMut = useMutation({
    mutationFn: (data: Omit<AutomationRule, 'id' | 'projectId' | 'createdAt'>) =>
      automationApi.create(projectId, data),
    onSuccess: () => { invalidate(); setShowAdd(false) },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      automationApi.update(id, { enabled }),
    onSuccess: invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => automationApi.delete(id),
    onSuccess: invalidate,
  })

  return (
    <Modal open={true} title={t.automation.title} onClose={onClose} className="max-w-lg">
      <div className="space-y-4">
        {/* Rules list */}
        {rules.length === 0 && !showAdd && (
          <div className="flex flex-col items-center py-8 gap-2 text-center">
            <Zap size={28} className="text-slate-700" />
            <p className="text-sm text-slate-500">{t.automation.noRules}</p>
          </div>
        )}

        {rules.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              'flex items-start gap-3 p-3 rounded-xl border transition-colors',
              rule.enabled ? 'border-slate-700 bg-surface-800' : 'border-slate-800 bg-surface-900 opacity-60',
            )}
          >
            <Zap size={14} className={rule.enabled ? 'text-amber-400 mt-0.5' : 'text-slate-600 mt-0.5'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200">{rule.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                <span className="text-amber-400/80">{t.automation.when}</span>{' '}
                {t.automation.triggers[rule.trigger]}
                {rule.triggerValue && <span className="text-slate-300"> {rule.triggerValue}</span>}
                {' → '}
                <span className="text-green-400/80">{t.automation.then}</span>{' '}
                {t.automation.actions[rule.action]}
                {rule.actionValue && <span className="text-slate-300"> {rule.actionValue}</span>}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => toggleMut.mutate({ id: rule.id, enabled: !rule.enabled })}
                className={rule.enabled ? 'text-green-400 hover:text-green-300' : 'text-slate-600 hover:text-slate-400'}
                title={rule.enabled ? t.automation.enabled : t.automation.disabled}
              >
                {rule.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </button>
              <button
                onClick={() => deleteMut.mutate(rule.id)}
                className="text-slate-600 hover:text-red-400"
                title={t.automation.deleteRule}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}

        {/* Add form */}
        {showAdd && (
          <AddRuleForm
            projectId={projectId}
            onSave={(data) => createMut.mutate(data)}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary-400 transition-colors"
          >
            <Plus size={14} /> {t.automation.addRule}
          </button>
        )}

        <div className="flex justify-end pt-1 border-t border-slate-800">
          <button onClick={onClose} className="btn-ghost">{t.common.close}</button>
        </div>
      </div>
    </Modal>
  )
}

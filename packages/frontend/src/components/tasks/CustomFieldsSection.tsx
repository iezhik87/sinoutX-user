import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customFieldApi, type CustomField } from '@/api/client'
import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

interface Props {
  projectId: string
  taskId: string
}

function FieldInput({ field, value, onChange }: {
  field: CustomField
  value: string | null
  onChange: (v: string | null) => void
}) {
  if (field.fieldType === 'checkbox') {
    return (
      <button
        onClick={() => onChange(value === 'true' ? 'false' : 'true')}
        className={cn('w-4 h-4 rounded border flex items-center justify-center',
          value === 'true' ? 'bg-primary-600 border-primary-600' : 'border-slate-600 bg-surface-900')}
      >
        {value === 'true' && <span className="text-white text-[9px]">✓</span>}
      </button>
    )
  }
  if (field.fieldType === 'select' && field.options) {
    return (
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex-1 bg-surface-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="">—</option>
        {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }
  return (
    <input
      type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="flex-1 bg-surface-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
    />
  )
}

export function CustomFieldsSection({ projectId, taskId }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [show, setShow] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<CustomField['fieldType']>('text')
  const [newOptions, setNewOptions] = useState('')

  const fields = useQuery({
    queryKey: ['custom-fields', projectId],
    queryFn: () => customFieldApi.list(projectId),
    enabled: show,
  })

  const values = useQuery({
    queryKey: ['custom-field-values', taskId],
    queryFn: () => customFieldApi.getValues(taskId),
    enabled: show,
  })

  const valueMap = new Map(values.data?.map((v) => [v.customFieldId, v]) ?? [])

  const createField = useMutation({
    mutationFn: () => customFieldApi.create(projectId, {
      name: newName.trim(),
      fieldType: newType,
      options: newType === 'select' ? newOptions.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields', projectId] })
      setNewName(''); setNewOptions(''); setShowAdd(false)
    },
  })

  const deleteField = useMutation({
    mutationFn: (id: string) => customFieldApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields', projectId] }),
  })

  const setValue = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string | null }) =>
      customFieldApi.setValue(taskId, fieldId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-field-values', taskId] }),
  })

  return (
    <div className="border-t border-slate-800 pt-3">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-xs text-slate-500 mb-2 flex items-center gap-1 hover:text-slate-300 w-full transition-colors"
      >
        {show ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Settings2 size={11} />
        {t.customFields.title}
        {(fields.data?.length ?? 0) > 0 && <span className="ml-1 text-slate-600">{fields.data!.length}</span>}
      </button>

      {show && (
        <div className="space-y-2">
          {fields.data?.map((field) => {
            const val = valueMap.get(field.id)
            return (
              <div key={field.id} className="flex items-center gap-2 group">
                <span className="text-xs text-slate-500 w-28 flex-shrink-0 truncate">{field.name}</span>
                <FieldInput
                  field={field}
                  value={val?.value ?? null}
                  onChange={(v) => setValue.mutate({ fieldId: field.id, value: v })}
                />
                <button
                  type="button"
                  onClick={() => deleteField.mutate(field.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 flex-shrink-0"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })}

          {/* Add new field */}
          {showAdd ? (
            <div className="flex flex-col gap-1.5 p-2 bg-surface-900 rounded-lg border border-slate-800">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.customFields.fieldName}
                className="bg-surface-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as CustomField['fieldType'])}
                className="bg-surface-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
              >
                <option value="text">{t.customFields.types.text}</option>
                <option value="number">{t.customFields.types.number}</option>
                <option value="date">{t.customFields.types.date}</option>
                <option value="select">{t.customFields.types.select}</option>
                <option value="checkbox">{t.customFields.types.checkbox}</option>
              </select>
              {newType === 'select' && (
                <input
                  value={newOptions}
                  onChange={(e) => setNewOptions(e.target.value)}
                  placeholder={t.customFields.optionsHint}
                  className="bg-surface-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              )}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => createField.mutate()}
                  disabled={!newName.trim()}
                  className="btn-primary text-xs py-1 flex-1"
                >
                  {t.common.save}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-xs py-1">
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              <Plus size={11} /> {t.customFields.addField}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Loader2 } from 'lucide-react'
import { collectionApi, type ModuleCollection, type CollectionField, type FieldType } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { useLanguageStore } from '@/stores/languageStore'
import { pickLocalized } from '@/lib/localized'
import { cn } from '@/lib/utils'

const gk = (p: string) => p + Math.random().toString(36).slice(2, 7)
const tri = (s: string) => ({ ru: s, en: s, be: s })

const TYPE_LABELS: Record<FieldType, Record<string, string>> = {
  text: { ru: 'Текст', en: 'Text', be: 'Тэкст' },
  longtext: { ru: 'Текст (абзац)', en: 'Long text', be: 'Тэкст (абзац)' },
  number: { ru: 'Число', en: 'Number', be: 'Лік' },
  date: { ru: 'Дата', en: 'Date', be: 'Дата' },
  datetime: { ru: 'Дата и время', en: 'Date & time', be: 'Дата і час' },
  select: { ru: 'Выбор', en: 'Select', be: 'Выбар' },
  multiselect: { ru: 'Мультивыбор', en: 'Multi-select', be: 'Мультывыбар' },
  checkbox: { ru: 'Да / Нет', en: 'Checkbox', be: 'Так / Не' },
  relation: { ru: 'Связь', en: 'Relation', be: 'Сувязь' },
  file: { ru: 'Файл', en: 'File', be: 'Файл' },
  secret: { ru: 'Секрет (шифр.)', en: 'Secret (encrypted)', be: 'Сакрэт (шыфр.)' },
}
const ALL_TYPES = Object.keys(TYPE_LABELS) as FieldType[]
const VIEW_TYPES = ['table', 'chart', 'board', 'calendar', 'gallery'] as const
const VIEW_LABELS: Record<typeof VIEW_TYPES[number], Record<string, string>> = {
  table: { ru: 'Таблица', en: 'Table', be: 'Табліца' },
  chart: { ru: 'Тренды', en: 'Trends', be: 'Трэнды' },
  board: { ru: 'Доска', en: 'Board', be: 'Дошка' },
  calendar: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' },
  gallery: { ru: 'Галерея', en: 'Gallery', be: 'Галерэя' },
}

const inp = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-200'

// ─── Create a new collection (Реестр) ─────────────────────────────────────────
export function AddCollectionModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated?: (id: string) => void }) {
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const m = useMutation({
    mutationFn: () => collectionApi.createCollection(projectId, { key: gk('r'), name: tri(name.trim()) }),
    onSuccess: (col) => { qc.invalidateQueries({ queryKey: ['collections', projectId] }); onCreated?.(col.id); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={language === 'en' ? 'New collection' : language === 'be' ? 'Новы рэестр' : 'Новый реестр'}>
      <div className="space-y-3">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={language === 'en' ? 'Name, e.g. Contacts' : 'Название, напр. Контакты'} className={inp} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">{language === 'en' ? 'Cancel' : 'Отмена'}</button>
          <button onClick={() => m.mutate()} disabled={!name.trim() || m.isPending} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
            {m.isPending && <Loader2 size={14} className="animate-spin" />}{language === 'en' ? 'Create' : 'Создать'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Edit a collection's fields + views ───────────────────────────────────────
export function SchemaEditorModal({ collection, collections, projectId, onClose }: {
  collection: ModuleCollection; collections: ModuleCollection[]; projectId: string; onClose: () => void
}) {
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const [name, setName] = useState(pickLocalized(collection.name, language))
  const [fields, setFields] = useState<CollectionField[]>(() => JSON.parse(JSON.stringify(collection.fields)))
  const invalidate = () => qc.invalidateQueries({ queryKey: ['collections', projectId] })

  const save = useMutation({
    mutationFn: () => collectionApi.updateCollection(collection.id, { name: tri(name.trim() || collection.key), fields }),
    onSuccess: () => { invalidate(); onClose() },
  })
  const addView = useMutation({ mutationFn: (v: { key: string; type: typeof VIEW_TYPES[number]; name: string | Record<string, string>; config?: Record<string, unknown> }) => collectionApi.addView(collection.id, v), onSuccess: invalidate })
  const delView = useMutation({ mutationFn: (id: string) => collectionApi.deleteView(id), onSuccess: invalidate })
  const delCollection = useMutation({
    mutationFn: () => collectionApi.deleteCollection(collection.id),
    onSuccess: () => { invalidate(); onClose(); navigate(`/projects/${projectId}`) },
  })

  const setField = (i: number, patch: Partial<CollectionField>) => setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  const addField = () => setFields((fs) => [...fs, { key: gk('f'), label: tri(''), type: 'text' }])
  const delField = (i: number) => setFields((fs) => fs.filter((_, idx) => idx !== i))

  // ── Add-view local form ──
  const [vType, setVType] = useState<typeof VIEW_TYPES[number]>('table')
  const [vCfg, setVCfg] = useState<Record<string, string>>({})
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime')
  const numFields = fields.filter((f) => f.type === 'number')
  const groupFields = fields.filter((f) => f.type === 'select' || f.type === 'relation')
  const fileFields = fields.filter((f) => f.type === 'file')
  function submitView() {
    const config: Record<string, unknown> = {}
    if (vType === 'chart') { config.x = vCfg.x; config.y = vCfg.y; if (vCfg.series) config.series = vCfg.series }
    if (vType === 'board') config.groupBy = vCfg.groupBy
    if (vType === 'calendar') config.dateField = vCfg.dateField
    if (vType === 'gallery') config.cover = vCfg.cover
    addView.mutate({ key: gk('v'), type: vType, name: VIEW_LABELS[vType], config })
    setVCfg({})
  }

  return (
    <Modal open onClose={onClose} className="max-w-2xl" title={L('Edit collection', 'Настройка реестра', 'Налада рэестра')}>
      <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{L('Name', 'Название', 'Назва')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
        </div>

        {/* Fields */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{L('Fields', 'Поля', 'Палі')}</span>
            <button onClick={addField} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"><Plus size={13} />{L('Field', 'Поле', 'Поле')}</button>
          </div>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.key} className="bg-surface-800 border border-slate-700 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={pickLocalized(f.label, language)} onChange={(e) => setField(i, { label: tri(e.target.value) })} placeholder={L('Field name', 'Название поля', 'Назва поля')} className={cn(inp, 'flex-1')} />
                  <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })} className={cn(inp, 'w-40')}>
                    {ALL_TYPES.map((t) => <option key={t} value={t}>{pickLocalized(TYPE_LABELS[t], language)}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />{L('req.', 'обяз.', 'абав.')}</label>
                  <button onClick={() => delField(i)} className="p-1 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
                {f.type === 'relation' && (
                  <select value={f.relation?.collection ?? ''} onChange={(e) => setField(i, { relation: { collection: e.target.value } })} className={inp}>
                    <option value="">{L('— target collection —', '— связанный реестр —', '— звязаны рэестр —')}</option>
                    {collections.filter((c) => c.id !== collection.id).map((c) => <option key={c.key} value={c.key}>{pickLocalized(c.name, language)}</option>)}
                  </select>
                )}
                {(f.type === 'select' || f.type === 'multiselect') && (
                  <OptionsEditor field={f} language={language} onChange={(options) => setField(i, { options })} L={L} />
                )}
              </div>
            ))}
            {fields.length === 0 && <p className="text-xs text-slate-600">{L('No fields yet — add one.', 'Полей пока нет — добавьте.', 'Палёў пакуль няма — дадайце.')}</p>}
          </div>
        </div>

        {/* Views */}
        <div>
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{L('Views', 'Виды', 'Віды')}</span>
          <div className="flex flex-wrap gap-1.5 my-2">
            {collection.views.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 text-xs bg-surface-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300">
                {pickLocalized(v.name, language)} <span className="text-slate-600">({v.type})</span>
                {collection.views.length > 1 && <button onClick={() => delView.mutate(v.id)} className="text-slate-500 hover:text-red-400"><X size={11} /></button>}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2 bg-surface-800/50 border border-slate-700 rounded-lg p-2.5">
            <select value={vType} onChange={(e) => { setVType(e.target.value as typeof VIEW_TYPES[number]); setVCfg({}) }} className={cn(inp, 'w-32')}>
              {VIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {vType === 'chart' && <>
              <SelField label="X" opts={dateFields} v={vCfg.x} onChange={(x) => setVCfg((c) => ({ ...c, x }))} language={language} />
              <SelField label="Y" opts={numFields} v={vCfg.y} onChange={(y) => setVCfg((c) => ({ ...c, y }))} language={language} />
              <SelField label={L('series', 'серии', 'серыі')} opts={fields} v={vCfg.series} onChange={(s) => setVCfg((c) => ({ ...c, series: s }))} language={language} optional />
            </>}
            {vType === 'board' && <SelField label={L('group', 'группа', 'група')} opts={groupFields} v={vCfg.groupBy} onChange={(g) => setVCfg((c) => ({ ...c, groupBy: g }))} language={language} />}
            {vType === 'calendar' && <SelField label={L('date', 'дата', 'дата')} opts={dateFields} v={vCfg.dateField} onChange={(d) => setVCfg((c) => ({ ...c, dateField: d }))} language={language} />}
            {vType === 'gallery' && <SelField label={L('cover', 'обложка', 'вокладка')} opts={fileFields} v={vCfg.cover} onChange={(c2) => setVCfg((c) => ({ ...c, cover: c2 }))} language={language} />}
            <button onClick={submitView} disabled={addView.isPending} className="btn-ghost text-xs px-2 py-1.5 flex items-center gap-1"><Plus size={13} />{L('Add view', 'Добавить вид', 'Дадаць від')}</button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button onClick={() => { if (confirm(L('Delete this collection and all its records?', 'Удалить этот реестр и все его записи?', 'Выдаліць гэты рэестр і ўсе яго запісы?'))) delCollection.mutate() }}
          disabled={delCollection.isPending} className="btn-ghost text-sm px-3 py-1.5 flex items-center gap-1.5 text-red-400 hover:text-red-300 mr-auto">
          <Trash2 size={14} /> {L('Delete collection', 'Удалить реестр', 'Выдаліць рэестр')}
        </button>
        <button onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">{L('Cancel', 'Отмена', 'Адмена')}</button>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
          {save.isPending && <Loader2 size={14} className="animate-spin" />}{L('Save', 'Сохранить', 'Захаваць')}
        </button>
      </div>
    </Modal>
  )
}

function SelField({ label, opts, v, onChange, language, optional }: { label: string; opts: CollectionField[]; v?: string; onChange: (v: string) => void; language: string; optional?: boolean }) {
  return (
    <label className="text-xs text-slate-400 flex flex-col gap-1">{label}
      <select value={v ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(inp, 'w-32')}>
        <option value="">{optional ? '—' : '…'}</option>
        {opts.map((f) => <option key={f.key} value={f.key}>{pickLocalized(f.label, language)}</option>)}
      </select>
    </label>
  )
}

function OptionsEditor({ field, language, onChange, L }: { field: CollectionField; language: string; onChange: (o: { value: string; label: Record<string, string> }[]) => void; L: (en: string, ru: string, be: string) => string }) {
  const opts = field.options ?? []
  return (
    <div className="pl-1 space-y-1">
      {opts.map((o, i) => (
        <div key={o.value} className="flex items-center gap-2">
          <input value={pickLocalized(o.label, language)} onChange={(e) => onChange(opts.map((x, idx) => (idx === i ? { ...x, label: tri(e.target.value) } : x)))} className={cn(inp, 'py-1 text-xs')} placeholder={L('option', 'вариант', 'варыянт')} />
          <button onClick={() => onChange(opts.filter((_, idx) => idx !== i))} className="text-slate-500 hover:text-red-400"><X size={12} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...opts, { value: gk('o'), label: tri('') }])} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Plus size={11} />{L('option', 'вариант', 'варыянт')}</button>
    </div>
  )
}

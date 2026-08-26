import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Table2, X, Paperclip, LineChart as LineChartIcon, Settings, ScanText, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { AddCollectionModal, SchemaEditorModal } from '@/components/modules/SchemaEditor'
import { toast } from '@/stores/toastStore'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { collectionApi, uploadApi, attachmentContentUrl, type ModuleCollection, type CollectionField, type CollectionRecord } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { pickLocalized } from '@/lib/localized'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

// Short label for a record (for relation cells / pickers): first filled text-ish field.
function recordLabel(rec: { id: string; data: Record<string, unknown> }, fields: CollectionField[]): string {
  const textField = fields.find((f) => (f.type === 'text' || f.type === 'longtext') && rec.data[f.key])
  if (textField) return String(rec.data[textField.key])
  const firstFilled = fields.map((f) => rec.data[f.key]).find((v) => v !== undefined && v !== null && v !== '')
  return firstFilled !== undefined ? String(firstFilled) : rec.id.slice(0, 6)
}

export function CollectionPage() {
  const { projectId, collectionId } = useParams<{ projectId: string; collectionId: string }>()
  const tt = useT().collections
  const qc = useQueryClient()
  const { language } = useLanguageStore()
  const { currentWorkspaceId } = useWorkspaceStore()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<CollectionRecord | 'new' | null>(null)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [addColOpen, setAddColOpen] = useState(false)
  const ocrFileRef = useRef<HTMLInputElement>(null)

  const { data: moduleInfo } = useQuery({ queryKey: ['module-info', projectId], queryFn: () => collectionApi.moduleInfo(projectId!), enabled: !!projectId })
  const labPipeline = moduleInfo?.pipelines?.[0]
  const { data: ocrCfg } = useQuery({ queryKey: ['ocr-config', projectId], queryFn: () => collectionApi.getOcrConfig(projectId!), enabled: !!projectId })
  const { data: access } = useQuery({ queryKey: ['pipeline-access', projectId], queryFn: () => collectionApi.pipelineAccess(projectId!), enabled: !!projectId })
  const ocrConfigured = !!ocrCfg?.available
  const ocrLocked = !!access && !access.premium && access.trialsLeft <= 0
  const upgradeMsg = language === 'en' ? 'Document recognition is a Pro feature' : 'Распознавание документов — функция Pro'
  const notConfiguredMsg = language === 'en'
    ? 'Set up recognition in Settings → AI → Recognition'
    : 'Настройте распознавание в Настройках → AI → Распознавание'
  const ocrMut = useMutation({
    mutationFn: (file: File) => collectionApi.runScan(projectId!, file, labPipeline?.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['collection-records'] })
      qc.invalidateQueries({ queryKey: ['overview', projectId] })
      qc.invalidateQueries({ queryKey: ['pipeline-access', projectId] })
      const en = language === 'en'
      const extra = (r.medications ? (en ? ` · ${r.medications} meds` : ` · лекарств: ${r.medications}`) : '') + (r.diagnoses ? (en ? ` · ${r.diagnoses} dx` : ` · диагнозов: ${r.diagnoses}`) : '')
      if (r.kind === 'lab') toast.success(`🩺 ${en ? `${r.analyses} analyses, ${r.indicators} indicators` : `анализов: ${r.analyses}, показателей: ${r.indicators}`}`)
      else if (r.kind === 'imaging') toast.success(`${en ? '🩻 Study added' : '🩻 Исследование добавлено'}${extra}`)
      else if (r.kind === 'encounter') toast.success(`${en ? '🩺 Visit added' : '🩺 Приём добавлен'}${extra}`)
      else if (r.kind === 'document') toast.success(`📄 ${en ? 'Document saved' : 'Документ сохранён'}${extra}`)
      else if (r.kind === 'receipt') toast.success(en ? '🧾 Receipt added' : '🧾 Чек добавлен')
      else if (r.kind === 'statement') toast.success(`${en ? '🧾 Statement imported' : '🧾 Выписка импортирована'}${r.transactions ? (en ? ` · ${r.transactions} tx` : ` · операций: ${r.transactions}`) : ''}`)
      else toast.error(en ? 'Could not recognize' : 'Не удалось распознать')
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('premium_required')) { qc.invalidateQueries({ queryKey: ['pipeline-access', projectId] }); toast.error(`🔒 ${upgradeMsg}`) }
      else if (msg.includes('ocr_not_configured')) toast.error(notConfiguredMsg)
      else toast.error(msg)
    },
  })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [selFilters, setSelFilters] = useState<Record<string, string>>({})

  const { data: collections = [] } = useQuery({
    queryKey: ['collections', projectId], queryFn: () => collectionApi.listByProject(projectId!), enabled: !!projectId,
  })
  const collection = collections.find((c) => c.id === collectionId)

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['collection-records', collectionId], queryFn: () => collectionApi.records(collectionId!), enabled: !!collectionId,
  })

  // Deep-link: ?record=<id> (e.g. from the overview timeline) opens that record.
  const [searchParams] = useSearchParams()
  const openedRef = useRef(false)
  useEffect(() => {
    const rid = searchParams.get('record')
    if (rid && !openedRef.current && records.length) {
      const r = records.find((x) => x.id === rid)
      if (r) { setEditing(r); openedRef.current = true }
    }
  }, [searchParams, records])

  // Records of any related collections, to render relation cells/pickers by label.
  const relationTargets = useMemo(() => {
    const keys = new Set((collection?.fields ?? []).filter((f) => f.type === 'relation').map((f) => f.relation?.collection))
    return collections.filter((c) => keys.has(c.key))
  }, [collection, collections])
  const relQueries = useQueries({
    queries: relationTargets.map((c) => ({ queryKey: ['collection-records', c.id], queryFn: () => collectionApi.records(c.id) })),
  })
  const relRecordsByColId = useMemo(() => {
    const m = new Map<string, CollectionRecord[]>()
    relationTargets.forEach((c, i) => m.set(c.id, (relQueries[i]?.data as CollectionRecord[]) ?? []))
    return m
  }, [relationTargets, relQueries])

  const delMut = useMutation({
    mutationFn: (id: string) => collectionApi.deleteRecord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-records', collectionId] }),
  })

  if (!collection) {
    return <div className="flex flex-col h-full"><Header title="—" /><div className="flex-1 flex items-center justify-center text-slate-500">{isLoading ? <Loader2 className="animate-spin" /> : tt.notFound}</div></div>
  }

  const fields = collection.fields
  const listViews = collection.views.filter((v) => v.type !== 'form')
  const activeView = listViews.find((v) => v.key === viewKey) ?? listViews[0]
  const isChart = activeView?.type === 'chart'
  const columns: string[] = ((activeView?.type === 'table' ? activeView.config?.columns : undefined) as string[] | undefined)
    ?? (collection.views.find((v) => v.type === 'table')?.config?.columns as string[] | undefined)
    ?? fields.map((f) => f.key)
  const colFields = columns.map((k) => fields.find((f) => f.key === k)).filter((f): f is CollectionField => !!f)

  const colByKey = (key: string) => collections.find((c) => c.key === key)
  function relLabel(field: CollectionField, value: unknown): string {
    const target = field.relation && colByKey(field.relation.collection)
    if (!target) return value ? String(value) : ''
    const recs = relRecordsByColId.get(target.id) ?? []
    const ids = Array.isArray(value) ? value : value ? [value] : []
    return ids.map((id) => { const r = recs.find((x) => x.id === id); return r ? recordLabel(r, target.fields) : String(id) }).join(', ')
  }

  const dateLocale = language === 'en' ? 'en-US' : language === 'be' ? 'be-BY' : 'ru-RU'

  function renderCell(field: CollectionField, value: unknown, row?: Record<string, unknown>) {
    if (field.type === 'secret') {
      const setKeys = row?._secretSet
      const isSet = Array.isArray(setKeys) && (setKeys as string[]).includes(field.key)
      return <span className="text-slate-500 font-mono">{isSet ? '••••••' : '—'}</span>
    }
    if (value === undefined || value === null || value === '') return <span className="text-slate-600">—</span>
    switch (field.type) {
      case 'checkbox': return value ? '✓' : '—'
      case 'select': return pickLocalized(field.options?.find((o) => o.value === value)?.label, language) || String(value)
      case 'multiselect': return (Array.isArray(value) ? value : [value]).map((v) => pickLocalized(field.options?.find((o) => o.value === v)?.label, language) || String(v)).join(', ')
      // Without these, a stored ISO string fell through to `default` and was
      // printed raw ("2026-07-08T22:00:00.000Z").
      case 'date': {
        const s = String(value)
        // Parse Y-M-D as local so the day never shifts across time zones.
        const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
        const d = p ? new Date(+p[1], +p[2] - 1, +p[3]) : new Date(s)
        return isNaN(d.getTime()) ? s : d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })
      }
      case 'datetime': {
        const d = new Date(String(value))
        return isNaN(d.getTime()) ? String(value) : d.toLocaleString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      }
      case 'relation': return relLabel(field, value)
      case 'file': { const f = value as { id?: string; filename?: string }; return f?.id ? <a href={attachmentContentUrl(f.id)} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline inline-flex items-center gap-1"><Paperclip size={12} />{f.filename ?? 'файл'}</a> : '—' }
      case 'number': {
        const unit = typeof field.unit === 'string' ? field.unit : pickLocalized(field.unit, language)
        const text = unit ? `${value} ${unit}` : String(value)
        // Highlight out-of-range values against sibling low/high fields.
        if (field.range && row) {
          const n = Number(value)
          const lo = row[field.range.lowKey], hi = row[field.range.highKey]
          const low = lo != null && lo !== '' ? Number(lo) : null
          const high = hi != null && hi !== '' ? Number(hi) : null
          const out = (low != null && n < low) ? 'low' : (high != null && n > high) ? 'high' : null
          if (out) {
            const est = !!row.refEst
            return <span className={cn('font-medium', est ? 'text-amber-400' : 'text-red-400')} title={est ? 'норма — ориентир' : ''}>{text} {out === 'low' ? '↓' : '↑'}</span>
          }
        }
        return text
      }
      default: return String(value)
    }
  }

  // A compact card used by board/calendar/gallery views.
  const cardFields = colFields.slice(0, 4)
  function renderCard(rec: CollectionRecord) {
    return (
      <button onClick={() => setEditing(rec)} className="w-full text-left bg-surface-900 border border-slate-700 rounded-lg p-2.5 hover:border-primary-500/50 transition-colors">
        <div className="text-sm text-slate-200 font-medium truncate">{recordLabel(rec, fields)}</div>
        {cardFields.map((f) => {
          const v = rec.data[f.key]
          if (v === undefined || v === null || v === '') return null
          if ((f.type === 'text' || f.type === 'longtext') && recordLabel(rec, fields) === String(v)) return null
          return <div key={f.key} className="text-[11px] text-slate-500 truncate">{pickLocalized(f.label, language)}: {renderCell(f, v, rec.data)}</div>
        })}
      </button>
    )
  }

  // Board columns (group by a select/relation field).
  const groupKey = activeView?.type === 'board' ? (activeView.config?.groupBy as string | undefined) : undefined
  const gbField = fields.find((f) => f.key === groupKey)
  const boardColumns: { key: string; label: string; records: CollectionRecord[] }[] = (() => {
    if (!gbField) return [{ key: '__all', label: '', records }]
    const cols: { key: string; label: string; records: CollectionRecord[] }[] = []
    if (gbField.type === 'select') {
      for (const o of gbField.options ?? []) cols.push({ key: o.value, label: pickLocalized(o.label, language) || o.value, records: records.filter((r) => String(r.data[groupKey!]) === o.value) })
    } else if (gbField.type === 'relation') {
      const target = gbField.relation && colByKey(gbField.relation.collection)
      const recs = target ? (relRecordsByColId.get(target.id) ?? []) : []
      for (const tr of recs) cols.push({ key: tr.id, label: recordLabel(tr, target!.fields), records: records.filter((r) => r.data[groupKey!] === tr.id) })
    }
    cols.push({ key: '__none', label: '—', records: records.filter((r) => r.data[groupKey!] == null || r.data[groupKey!] === '') })
    return cols.filter((c, i) => c.records.length > 0 || i < cols.length - 1)
  })()

  // Gallery items (cover = a file field).
  const coverKey = activeView?.type === 'gallery'
    ? ((activeView.config?.cover as string | undefined) ?? fields.find((f) => f.type === 'file')?.key)
    : undefined
  const galleryItems = records.map((rec) => {
    const f = coverKey ? (rec.data[coverKey] as { id?: string; filename?: string } | undefined) : undefined
    return { rec, url: f?.id ? attachmentContentUrl(f.id) : null }
  })

  const calendarDateKey = activeView?.type === 'calendar'
    ? ((activeView.config?.dateField as string | undefined) ?? fields.find((f) => f.type === 'date' || f.type === 'datetime')?.key ?? '')
    : ''

  // ── Table: search, filter, sort ───────────────────────────────────────────
  const cellStr = (field: CollectionField, value: unknown): string => {
    if (value === undefined || value === null) return ''
    switch (field.type) {
      case 'select': return pickLocalized(field.options?.find((o) => o.value === value)?.label, language) || String(value)
      case 'multiselect': return (Array.isArray(value) ? value : [value]).map((v) => pickLocalized(field.options?.find((o) => o.value === v)?.label, language) || String(v)).join(' ')
      case 'relation': return relLabel(field, value)
      case 'file': return (value as { filename?: string })?.filename ?? ''
      case 'checkbox': return value ? '1' : ''
      default: return String(value)
    }
  }
  const selectableCols = colFields.filter((f) => f.type === 'select')
  const defaultSort = (() => {
    const s = (activeView?.type === 'table' ? (activeView.config?.sort as { field: string; dir: string }[] | undefined)?.[0] : undefined)
    return s ? { key: s.field, dir: (s.dir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc' } : null
  })()
  const effSort = sort ?? defaultSort
  const tableRecords = (() => {
    let rows = records
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter((r) => colFields.some((f) => cellStr(f, r.data[f.key]).toLowerCase().includes(q)))
    for (const [k, val] of Object.entries(selFilters)) {
      if (!val) continue
      rows = rows.filter((r) => String(r.data[k] ?? '') === val)
    }
    if (effSort) {
      const f = fields.find((ff) => ff.key === effSort.key)
      rows = [...rows].sort((a, b) => {
        const av = a.data[effSort.key], bv = b.data[effSort.key]
        let c: number
        if (f?.type === 'number') c = (Number(av) || 0) - (Number(bv) || 0)
        else c = cellStr(f ?? ({ type: 'text' } as CollectionField), av).localeCompare(cellStr(f ?? ({ type: 'text' } as CollectionField), bv))
        return effSort.dir === 'asc' ? c : -c
      })
    }
    return rows
  })()
  const toggleSort = (key: string) => setSort((s) => {
    const cur = s ?? defaultSort
    if (cur?.key !== key) return { key, dir: 'asc' }
    if (cur.dir === 'asc') return { key, dir: 'desc' }
    return null
  })

  return (
    <div className="flex flex-col h-full">
      <Header
        title={<span className="flex items-center gap-2"><Table2 size={15} className="text-primary-400" /> {pickLocalized(collection.name, language)}</span>}
        actions={
          <div className="flex items-center gap-2">
            {labPipeline && (
              <>
                <input ref={ocrFileRef} type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) ocrMut.mutate(f); e.target.value = '' }} />
                <button onClick={() => (ocrLocked ? toast.error(`🔒 ${upgradeMsg}`) : ocrConfigured ? ocrFileRef.current?.click() : toast.error(notConfiguredMsg))} disabled={ocrMut.isPending}
                  className="btn-ghost text-sm px-2.5 py-1.5 flex items-center gap-1.5" title={pickLocalized(labPipeline.label, language)}>
                  {ocrMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <ScanText size={15} />}
                  {pickLocalized(labPipeline.label, language) || (language === 'en' ? 'Scan' : 'Распознать')}
                  {ocrLocked ? ' 🔒' : (access && !access.premium && access.trialsLeft > 0 ? ` (${access.trialsLeft})` : '')}
                </button>
              </>
            )}
            <button onClick={() => setAddColOpen(true)} className="btn-ghost text-sm px-2.5 py-1.5 flex items-center gap-1" title={language === 'en' ? 'New collection' : 'Новый реестр'}>
              <Plus size={15} />{language === 'en' ? 'Collection' : language === 'be' ? 'Рэестр' : 'Реестр'}
            </button>
            <button onClick={() => setSchemaOpen(true)} className="btn-ghost p-1.5" title={language === 'en' ? 'Configure' : 'Настроить'}><Settings size={15} /></button>
            <button onClick={() => setEditing('new')} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2"><Plus size={15} /> {tt.add}</button>
          </div>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {listViews.length > 1 && (
            <div className="flex gap-1 mb-4">
              {listViews.map((v) => (
                <button key={v.key} onClick={() => setViewKey(v.key)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    activeView?.key === v.key ? 'border-primary-500 text-primary-300 bg-primary-600/15' : 'border-slate-700 text-slate-400 hover:text-slate-200')}>
                  {v.type === 'chart' ? <LineChartIcon size={14} /> : <Table2 size={14} />}
                  {pickLocalized(v.name, language)}
                </button>
              ))}
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-500" /></div>
          ) : isChart ? (
            <ChartView records={records} fields={fields} config={activeView!.config} language={language} empty={tt.empty} />
          ) : activeView?.type === 'board' ? (
            <BoardView columns={boardColumns} renderCard={renderCard} />
          ) : activeView?.type === 'gallery' ? (
            <GalleryView items={galleryItems} renderCard={renderCard} empty={tt.empty} />
          ) : activeView?.type === 'calendar' ? (
            <CalendarView records={records} dateKey={calendarDateKey} fields={fields} language={language} empty={tt.empty} onOpen={(r) => setEditing(r)} />
          ) : records.length === 0 ? (
            <p className="text-sm text-slate-500">{tt.empty}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tt.search}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 w-48" />
                {selectableCols.map((f) => (
                  <select key={f.key} value={selFilters[f.key] ?? ''} onChange={(e) => setSelFilters((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300">
                    <option value="">{pickLocalized(f.label, language)}: {tt.all}</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{pickLocalized(o.label, language)}</option>)}
                  </select>
                ))}
                <span className="text-xs text-slate-500 ml-auto">{tableRecords.length} / {records.length}</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-surface-800 text-slate-400">
                    <tr>
                      {colFields.map((f) => (
                        <th key={f.key} onClick={() => toggleSort(f.key)} className="text-left font-medium px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:text-slate-200">
                          {pickLocalized(f.label, language)}{effSort?.key === f.key ? (effSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {tableRecords.map((rec) => (
                      <tr key={rec.id} onClick={() => setEditing(rec)} className="border-t border-slate-800 hover:bg-surface-800/60 cursor-pointer">
                        {colFields.map((f) => <td key={f.key} className="px-3 py-2 align-top text-slate-200">{renderCell(f, rec.data[f.key], rec.data)}</td>)}
                        <td className="px-2 py-2 text-right">
                          <button onClick={(e) => { e.stopPropagation(); if (confirm(tt.deleteConfirm)) delMut.mutate(rec.id) }}
                            className="p-1 rounded hover:bg-red-900/30 text-slate-600 hover:text-red-400"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {(() => {
                    const numCols = colFields.filter((f) => f.type === 'number')
                    if (numCols.length === 0 || tableRecords.length === 0) return null
                    const sum = (k: string) => tableRecords.reduce((s, r) => s + (Number(r.data[k]) || 0), 0)
                    const nf = (n: number) => n.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU')
                    return (
                      <tfoot>
                        <tr className="border-t border-slate-700 bg-surface-800/40 font-medium text-slate-300">
                          {colFields.map((f, i) => (
                            <td key={f.key} className="px-3 py-2 whitespace-nowrap">{f.type === 'number' ? nf(sum(f.key)) : (i === 0 ? `Σ ${tableRecords.length}` : '')}</td>
                          ))}
                          <td />
                        </tr>
                      </tfoot>
                    )
                  })()}
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {editing && (
        <RecordForm
          collection={collection} record={editing === 'new' ? null : editing}
          workspaceId={currentWorkspaceId!} projectId={projectId!}
          relRecordsByColId={relRecordsByColId} colByKey={colByKey}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['collection-records', collectionId] }); setEditing(null) }}
        />
      )}
      {schemaOpen && <SchemaEditorModal collection={collection} collections={collections} projectId={projectId!} onClose={() => setSchemaOpen(false)} />}
      {addColOpen && <AddCollectionModal projectId={projectId!} onClose={() => setAddColOpen(false)} onCreated={(id) => navigate(`/projects/${projectId}/c/${id}`)} />}
    </div>
  )
}

// ─── Record create/edit form ────────────────────────────────────────────────

function RecordForm({ collection, record, workspaceId, projectId, relRecordsByColId, colByKey, onClose, onSaved }: {
  collection: ModuleCollection
  record: CollectionRecord | null
  workspaceId: string
  projectId: string
  relRecordsByColId: Map<string, CollectionRecord[]>
  colByKey: (key: string) => ModuleCollection | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const tt = useT().collections
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const [data, setData] = useState<Record<string, unknown>>(record?.data ?? {})
  const [uploading, setUploading] = useState(false)
  const set = (k: string, v: unknown) => setData((d) => ({ ...d, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => record ? collectionApi.updateRecord(record.id, data) : collectionApi.createRecord(collection.id, data),
    onSuccess: onSaved,
  })

  async function onFile(field: CollectionField, file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const att = await uploadApi.upload(file, workspaceId, { projectId })
      set(field.key, { id: att.id, filename: att.filename })
      // Everything uploaded into the card is also filed in the Documents archive
      // (unless we're already in Documents).
      const docCol = colByKey('documents')
      if (docCol && collection.key !== 'documents') {
        await collectionApi.createRecord(docCol.id, { date: new Date().toISOString().slice(0, 10), title: att.filename, type: 'other', file: { id: att.id, filename: att.filename } })
        qc.invalidateQueries({ queryKey: ['collection-records', docCol.id] })
      }
    } finally { setUploading(false) }
  }

  function input(field: CollectionField) {
    const v = data[field.key]
    const base = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200'
    switch (field.type) {
      case 'longtext': return <textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value)} className={base} />
      case 'number': return <input type="number" value={(v as number) ?? ''} onChange={(e) => set(field.key, e.target.value === '' ? null : Number(e.target.value))} className={base} />
      case 'date': return <input type="date" value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value)} className={base} />
      case 'datetime': return <input type="datetime-local" value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value)} className={base} />
      case 'checkbox': return <input type="checkbox" checked={!!v} onChange={(e) => set(field.key, e.target.checked)} className="w-4 h-4" />
      case 'select': return (
        <select value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value || null)} className={base}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{pickLocalized(o.label, language)}</option>)}
        </select>
      )
      case 'multiselect': {
        const arr = Array.isArray(v) ? (v as string[]) : []
        return (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((o) => {
              const on = arr.includes(o.value)
              return <button type="button" key={o.value}
                onClick={() => set(field.key, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={cn('px-2 py-1 rounded text-xs border', on ? 'border-primary-500 text-primary-300 bg-primary-600/15' : 'border-slate-700 text-slate-400')}>
                {pickLocalized(o.label, language)}</button>
            })}
          </div>
        )
      }
      case 'relation': {
        const target = field.relation && colByKey(field.relation.collection)
        const recs = target ? (relRecordsByColId.get(target.id) ?? []) : []
        return (
          <select value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value || null)} className={base}>
            <option value="">—</option>
            {recs.map((r) => <option key={r.id} value={r.id}>{recordLabel(r, target!.fields)}</option>)}
          </select>
        )
      }
      case 'file': {
        const f = v as { id?: string; filename?: string } | undefined
        return (
          <div className="flex items-center gap-2">
            <input type="file" onChange={(e) => onFile(field, e.target.files?.[0])} className="text-xs text-slate-400" />
            {uploading && <Loader2 size={14} className="animate-spin text-slate-500" />}
            {f?.id && (
              <span className="text-xs inline-flex items-center gap-1">
                <a href={attachmentContentUrl(f.id)} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline inline-flex items-center gap-1"><Paperclip size={12} />{f.filename ?? 'файл'}</a>
                <button onClick={() => set(field.key, null)} className="text-slate-500 hover:text-red-400"><X size={12} /></button>
              </span>
            )}
          </div>
        )
      }
      case 'secret': {
        const setKeys = (data as Record<string, unknown>)._secretSet
        const isSet = Array.isArray(setKeys) && (setKeys as string[]).includes(field.key)
        return <SecretField recordId={record?.id} fieldKey={field.key} isSet={isSet}
          value={(v as string) ?? ''} onChange={(val) => set(field.key, val)} tt={tt} />
      }
      default: return <input type="text" value={(v as string) ?? ''} onChange={(e) => set(field.key, e.target.value)} className={base} />
    }
  }

  return (
    <Modal open onClose={onClose} title={`${pickLocalized(collection.name, language)} — ${record ? tt.edit : tt.add}`}>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {collection.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs text-slate-400 mb-1">{pickLocalized(f.label, language)}{f.required && <span className="text-red-400"> *</span>}</label>
            {input(f)}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">{tt.cancel}</button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
          {saveMut.isPending && <Loader2 size={14} className="animate-spin" />} {tt.save}
        </button>
      </div>
    </Modal>
  )
}

// ─── Secret field (encrypted, masked, reveal/copy on demand) ─────────────────

function SecretField({ recordId, fieldKey, isSet, value, onChange, tt }: {
  recordId?: string
  fieldKey: string
  isSet: boolean
  value: string
  onChange: (v: string) => void
  tt: { secretReveal: string; secretHide: string; secretCopy: string; secretCopied: string; secretKeepHint: string }
}) {
  const [reveal, setReveal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const base = 'w-full bg-slate-800 border border-slate-700 rounded-lg pl-3 pr-16 py-2 text-sm text-slate-200'

  // Plaintext is never sent in bulk — fetch it on demand from the reveal endpoint.
  async function ensureValue(): Promise<string> {
    if (value || !recordId) return value
    setLoading(true)
    try { const v = await collectionApi.revealSecret(recordId, fieldKey); onChange(v); return v }
    finally { setLoading(false) }
  }
  async function toggleReveal() { if (!reveal) await ensureValue(); setReveal((r) => !r) }
  async function copy() {
    const v = await ensureValue()
    if (!v) return
    await navigator.clipboard.writeText(v)
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }
  const canAct = (value || (isSet && recordId)) && !loading
  return (
    <div className="relative">
      <input type={reveal ? 'text' : 'password'} value={value} autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)} className={base}
        placeholder={isSet && !value ? `•••••• — ${tt.secretKeepHint}` : ''} />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-slate-500">
        {loading && <Loader2 size={14} className="animate-spin" />}
        {canAct && (
          <button type="button" onClick={toggleReveal} title={reveal ? tt.secretHide : tt.secretReveal} className="hover:text-slate-300">
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {canAct && (
          <button type="button" onClick={copy} title={copied ? tt.secretCopied : tt.secretCopy} className="hover:text-slate-300">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Chart view (trends) ──────────────────────────────────────────────────────

const CHART_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6']

function ChartView({ records, fields, config, language, empty }: {
  records: CollectionRecord[]
  fields: CollectionField[]
  config: Record<string, unknown>
  language: string
  empty: string
}) {
  const x = config.x as string | undefined
  const y = config.y as string | undefined
  const series = config.series as string | undefined

  const { rows, seriesKeys } = useMemo(() => {
    if (!x || !y) return { rows: [] as Record<string, unknown>[], seriesKeys: [] as string[] }
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }
    const xs = [...new Set(records.map((r) => r.data[x]).filter((v) => v != null && v !== '').map(String))].sort()
    if (series) {
      const keys = [...new Set(records.map((r) => r.data[series]).filter((v) => v != null && v !== '').map(String))]
      const rows = xs.map((xv) => {
        const row: Record<string, unknown> = { x: xv }
        records.filter((r) => String(r.data[x]) === xv).forEach((r) => {
          const val = num(r.data[y]); if (val !== null) row[String(r.data[series])] = val
        })
        return row
      })
      return { rows, seriesKeys: keys }
    }
    const yLabel = pickLocalized(fields.find((f) => f.key === y)?.label, language) || y
    const rows = xs.map((xv) => {
      const r = records.find((rr) => String(rr.data[x]) === xv)
      return { x: xv, [yLabel]: r ? num(r.data[y]) : null }
    })
    return { rows, seriesKeys: [yLabel] }
  }, [records, fields, x, y, series, language])

  if (!x || !y) return <p className="text-sm text-slate-500">{empty}</p>
  if (rows.length === 0 || seriesKeys.length === 0) return <p className="text-sm text-slate-500">{empty}</p>

  return (
    <div className="bg-surface-800 rounded-xl border border-slate-700 p-4" style={{ height: 420 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="x" stroke="#94a3b8" fontSize={12} />
          <YAxis stroke="#94a3b8" fontSize={12} />
          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {seriesKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Board view (kanban by a select/relation field) ──────────────────────────

function BoardView({ columns, renderCard }: {
  columns: { key: string; label: string; records: CollectionRecord[] }[]
  renderCard: (rec: CollectionRecord) => React.ReactNode
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div key={col.key} className="flex-shrink-0 w-64 bg-surface-800/60 rounded-xl border border-slate-700 p-2">
          <div className="flex items-center justify-between px-1.5 py-1 mb-2">
            <span className="text-xs font-semibold text-slate-300 truncate">{col.label || '—'}</span>
            <span className="text-[11px] text-slate-500">{col.records.length}</span>
          </div>
          <div className="space-y-2">
            {col.records.map((r) => <div key={r.id}>{renderCard(r)}</div>)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Gallery view (tiles by a file field) ─────────────────────────────────────

function GalleryView({ items, renderCard, empty }: {
  items: { rec: CollectionRecord; url: string | null }[]
  renderCard: (rec: CollectionRecord) => React.ReactNode
  empty: string
}) {
  if (items.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map(({ rec, url }) => (
        <div key={rec.id} className="bg-surface-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="aspect-video bg-surface-900 flex items-center justify-center overflow-hidden">
            {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <Paperclip size={20} className="text-slate-600" />}
          </div>
          <div className="p-2">{renderCard(rec)}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Calendar view (records placed on a date field) ───────────────────────────

const WEEKDAYS: Record<string, string[]> = {
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  be: ['Пн', 'Аўт', 'Ср', 'Чц', 'Пт', 'Сб', 'Нд'],
}

function CalendarView({ records, dateKey, fields, language, empty, onOpen }: {
  records: CollectionRecord[]
  dateKey: string
  fields: CollectionField[]
  language: string
  empty: string
  onOpen: (rec: CollectionRecord) => void
}) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  if (!dateKey) return <p className="text-sm text-slate-500">{empty}</p>

  const byDay = useMemo(() => {
    const m = new Map<string, CollectionRecord[]>()
    for (const r of records) {
      const v = r.data[dateKey]; if (!v) continue
      const d = String(v).slice(0, 10)
      if (!m.has(d)) m.set(d, [])
      m.get(d)!.push(r)
    }
    return m
  }, [records, dateKey])

  const first = new Date(cursor.y, cursor.m, 1)
  const startOffset = (first.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(language === 'en' ? 'en-US' : language === 'be' ? 'be-BY' : 'ru-RU', { month: 'long', year: 'numeric' })
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="bg-surface-800 rounded-xl border border-slate-700 p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <button onClick={() => setCursor((c) => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m } })} className="px-2 py-1 rounded hover:bg-slate-700 text-slate-400">‹</button>
        <span className="text-sm font-semibold text-slate-200 capitalize">{monthName}</span>
        <button onClick={() => setCursor((c) => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m } })} className="px-2 py-1 rounded hover:bg-slate-700 text-slate-400">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {(WEEKDAYS[language] ?? WEEKDAYS.ru).map((w) => <div key={w} className="text-[11px] text-slate-500 text-center py-1">{w}</div>)}
        {cells.map((day, i) => {
          const iso = day ? `${cursor.y}-${pad(cursor.m + 1)}-${pad(day)}` : ''
          const recs = day ? (byDay.get(iso) ?? []) : []
          return (
            <div key={i} className={cn('min-h-[68px] rounded-lg border p-1', day ? 'border-slate-700 bg-surface-900/40' : 'border-transparent')}>
              {day && <div className="text-[11px] text-slate-500 mb-1">{day}</div>}
              <div className="space-y-1">
                {recs.slice(0, 3).map((r) => (
                  <button key={r.id} onClick={() => onOpen(r)} className="block w-full truncate text-left text-[11px] px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-200 hover:bg-primary-600/30">
                    {recordLabel(r, fields)}
                  </button>
                ))}
                {recs.length > 3 && <div className="text-[10px] text-slate-500 px-1">+{recs.length - 3}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

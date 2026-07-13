import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, LayoutDashboard, ClipboardList, Pill, ScanText, Settings, Download, Wallet, Target, FileText, CopyPlus, Upload } from 'lucide-react'
import { collectionApi, projectApi, moduleApi } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { OcrSettingsModal } from '@/components/modules/OcrSettingsModal'
import { renderIcon } from '@/components/common/EmojiPicker'
import { useLanguageStore } from '@/stores/languageStore'
import { pickLocalized } from '@/lib/localized'
import { toast } from '@/stores/toastStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

export function ModuleOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { language } = useLanguageStore()
  const tt = useT().collections
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const [ocrOpen, setOcrOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => projectApi.getById(projectId!), enabled: !!projectId })
  const { data, isLoading } = useQuery({ queryKey: ['overview', projectId], queryFn: () => collectionApi.overview(projectId!), enabled: !!projectId })
  const { data: moduleInfo } = useQuery({ queryKey: ['module-info', projectId], queryFn: () => collectionApi.moduleInfo(projectId!), enabled: !!projectId })
  const { data: ocrCfg } = useQuery({ queryKey: ['ocr-config', projectId], queryFn: () => collectionApi.getOcrConfig(projectId!), enabled: !!projectId })
  const { data: access } = useQuery({ queryKey: ['pipeline-access', projectId], queryFn: () => collectionApi.pipelineAccess(projectId!), enabled: !!projectId })
  // A module-project's stored name is fixed at install time (Russian), so the
  // header must resolve it through the catalog manifest like the sidebar does.
  const { data: catalog = [] } = useQuery({ queryKey: ['modules-catalog'], queryFn: moduleApi.catalog, enabled: !!project?.isModule })
  const projectTitle = project?.isModule
    ? (pickLocalized(catalog.find((m) => m.moduleId === project.moduleId)?.name, language) || project.name)
    : project?.name

  const scanPipeline = moduleInfo?.pipelines?.[0]
  // Either the module has its own key, or the instance lends its own. Both mean
  // «send me a receipt and I will read it», which is all this flag is asked.
  const ocrConfigured = (!!ocrCfg?.hasKey && !!ocrCfg?.model) || !!ocrCfg?.managedFallback
  const ocrLocked = !!access && !access.premium && access.trialsLeft <= 0
  const upgradeMsg = L('Document recognition is a Pro feature', 'Распознавание документов — функция Pro', 'Распазнаванне дакументаў — функцыя Pro')

  const scanMut = useMutation({
    mutationFn: (file: File) => collectionApi.runScan(projectId!, file, scanPipeline?.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['overview', projectId] })
      qc.invalidateQueries({ queryKey: ['collection-records'] })
      qc.invalidateQueries({ queryKey: ['pipeline-access', projectId] })
      const en = language === 'en'
      const extra = (r.medications ? (en ? ` · ${r.medications} meds` : ` · лекарств: ${r.medications}`) : '') + (r.diagnoses ? (en ? ` · ${r.diagnoses} dx` : ` · диагнозов: ${r.diagnoses}`) : '')
      if (r.kind === 'lab') toast.success(`🩺 ${en ? `${r.indicators} indicators` : `показателей: ${r.indicators}`}`)
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
      else if (msg.includes('ocr_not_configured')) { setOcrOpen(true); toast.error(L('Configure recognition', 'Настройте распознавание', 'Наладзьце распазнаванне')) }
      else toast.error(msg)
    },
  })

  const exportMut = useMutation({
    mutationFn: () => collectionApi.exportPdf(projectId!, language),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${projectTitle ?? 'card'}.pdf`; a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const summaryMut = useMutation({
    mutationFn: () => collectionApi.exportSummary(projectId!, language),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${L('summary', 'выписка', 'выпіска')}.pdf`; a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })
  const isMedcard = moduleInfo?.moduleId === 'medical-record'

  const rolloverMut = useMutation({
    mutationFn: () => collectionApi.budgetRollover(projectId!),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['overview', projectId] })
      qc.invalidateQueries({ queryKey: ['collection-records'] })
      if (r.created > 0) toast.success(language === 'en' ? `Copied ${r.created} to ${r.month}` : `Скопировано на ${r.month}: ${r.created}`)
      else toast.success(L('Next month already planned', 'Следующий месяц уже запланирован', 'Наступны месяц ужо запланаваны'))
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const isVault = moduleInfo?.moduleId === 'vault'
  const bwInputRef = useRef<HTMLInputElement>(null)
  const importVaultMut = useMutation({
    mutationFn: (text: string) => collectionApi.importVaultBitwarden(project!.workspaceId, text),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['overview', projectId] })
      qc.invalidateQueries({ queryKey: ['collection-records'] })
      toast.success(L(`Imported: ${r.logins} logins · ${r.cards} cards · ${r.secrets} notes`, `Импортировано: ${r.logins} логинов · ${r.cards} карт · ${r.secrets} заметок`, `Імпартавана: ${r.logins} · ${r.cards} · ${r.secrets}`))
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })
  async function onBitwardenFile(file?: File) { if (file) importVaultMut.mutate(await file.text()) }

  const goCol = (id: string) => navigate(`/projects/${projectId}/c/${id}`)
  const statusLabel = (s: string) => ({ active: L('active', 'активно', 'актыўна'), chronic: L('chronic', 'хроническое', 'хранічнае'), remission: L('remission', 'ремиссия', 'рэмісія'), resolved: L('resolved', 'разрешено', 'вырашана') } as Record<string, string>)[s] ?? s
  const fmt = (n: number) => n.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU')
  const catLabel = (c: string) => ({
    groceries: L('Groceries', 'Продукты', 'Прадукты'), eatingout: L('Eating out', 'Кафе/рестораны', 'Кафэ'), transport: L('Transport', 'Транспорт', 'Транспарт'),
    housing: L('Housing', 'Жильё', 'Жыллё'), utilities: L('Utilities', 'Коммуналка', 'Камуналка'), health: L('Health', 'Здоровье', 'Здароўе'),
    shopping: L('Shopping', 'Покупки', 'Пакупкі'), entertainment: L('Entertainment', 'Развлечения', 'Забавы'), education: L('Education', 'Образование', 'Адукацыя'),
    salary: L('Salary', 'Зарплата', 'Зарплата'), gift: L('Gift', 'Подарок', 'Падарунак'), transfer: L('Transfer', 'Перевод', 'Перавод'), other: L('Other', 'Другое', 'Іншае'),
  } as Record<string, string>)[c] ?? c

  return (
    <div className="flex flex-col h-full">
      <Header
        title={<span className="flex items-center gap-2"><LayoutDashboard size={15} className="text-primary-400" /> {projectTitle ?? L('Overview', 'Обзор', 'Агляд')}</span>}
        actions={
          <div className="flex items-center gap-2">
            {scanPipeline && <>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) scanMut.mutate(f); e.target.value = '' }} />
              <button onClick={() => (ocrLocked ? toast.error(`🔒 ${upgradeMsg}`) : ocrConfigured ? fileRef.current?.click() : setOcrOpen(true))} disabled={scanMut.isPending}
                className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
                {scanMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <ScanText size={15} />}
                {pickLocalized(scanPipeline.label, language) || L('Scan a document', 'Распознать документ', 'Распазнаць дакумент')}
                {ocrLocked ? ' 🔒' : (access && !access.premium && access.trialsLeft > 0 ? ` (${access.trialsLeft})` : '')}
              </button>
              <button onClick={() => setOcrOpen(true)} className="btn-ghost p-1.5 relative" title={L('OCR settings', 'Настройки распознавания', 'Налады распазнавання')}>
                <Settings size={14} className="text-slate-500" />
                <span className={cn('absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full', ocrConfigured ? 'bg-emerald-500' : 'bg-amber-500')} />
              </button>
            </>}
            {isMedcard && (
              <button onClick={() => summaryMut.mutate()} disabled={summaryMut.isPending} className="btn-ghost text-sm px-2.5 py-1.5 flex items-center gap-1.5" title={L('Clinical summary PDF', 'Выписка (PDF)', 'Выпіска (PDF)')}>
                {summaryMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} {L('Summary', 'Выписка', 'Выпіска')}
              </button>
            )}
            {isVault && (<>
              <input ref={bwInputRef} type="file" accept=".json,application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; onBitwardenFile(f); e.target.value = '' }} />
              <button onClick={() => bwInputRef.current?.click()} disabled={importVaultMut.isPending}
                className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2" title={L('Import a Bitwarden .json export', 'Импорт экспорта Bitwarden (.json)', 'Імпарт Bitwarden (.json)')}>
                {importVaultMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {L('Import Bitwarden', 'Импорт Bitwarden', 'Імпарт Bitwarden')}
              </button>
            </>)}
            <button onClick={() => exportMut.mutate()} disabled={exportMut.isPending} className="btn-ghost text-sm px-2.5 py-1.5 flex items-center gap-1.5" title={L('Export PDF', 'Экспорт PDF', 'Экспарт PDF')}>
              {exportMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} PDF
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          {isLoading || !data ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-500" /></div>
          ) : (
            <>
              {/* Collections */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {data.collections.map((c) => (
                  <button key={c.id} onClick={() => goCol(c.id)} className="bg-surface-800 border border-slate-700 rounded-xl p-4 text-left hover:border-primary-500/50 transition-colors">
                    <div className="text-primary-400 mb-1.5">{renderIcon(c.icon, 18, 'text-primary-400', 'Boxes') ?? null}</div>
                    <div className="text-sm font-medium text-slate-200 truncate">{pickLocalized(c.name, language)}</div>
                    <div className="text-xs text-slate-500">{c.count}</div>
                  </button>
                ))}
              </div>

              {/* Highlights */}
              {(data.conditions.length > 0 || data.medications.length > 0) && (
                <div className="grid sm:grid-cols-2 gap-4">
                  {data.conditions.length > 0 && (
                    <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold mb-2"><ClipboardList size={15} /> {L('Active conditions', 'Активные состояния', 'Актыўныя станы')}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.conditions.map((c) => (
                          <span key={c.id} className="text-xs bg-surface-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200">{c.name} <span className="text-slate-500">· {statusLabel(c.status)}</span></span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.medications.length > 0 && (
                    <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold mb-2"><Pill size={15} /> {L('Current medications', 'Текущие лекарства', 'Бягучыя лекі')}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.medications.map((m) => (
                          <span key={m.id} className="text-xs bg-surface-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200">{m.name}{m.dose ? <span className="text-slate-500"> · {m.dose}</span> : null}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Finance highlights — accounts, net worth, this-month cashflow, top spend */}
              {data.accounts && data.accounts.length > 0 && (
                <div className="space-y-4">
                  <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold"><Wallet size={15} /> {L('Accounts', 'Счета', 'Рахункі')}</div>
                      <div className="text-xs text-slate-400">{L('Net worth', 'Чистый капитал', 'Чысты капітал')}: <span className="text-slate-100 font-semibold">{
                        Object.entries(data.accounts.reduce((m, a) => { m[a.currency || ''] = (m[a.currency || ''] ?? 0) + a.balance; return m }, {} as Record<string, number>))
                          .map(([c, v]) => `${fmt(v)} ${c}`).join(' · ')
                      }</span></div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {data.accounts.map((a) => (
                        <div key={a.id} className="bg-surface-900 border border-slate-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-slate-400 truncate">{a.name}</div>
                          <div className="text-sm font-semibold text-slate-100">{fmt(a.balance)} <span className="text-slate-500 text-xs">{a.currency}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {data.cashflow && (
                      <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                        <div className="text-slate-300 text-sm font-semibold mb-2">{L('This month', 'Этот месяц', 'Гэты месяц')}</div>
                        <div className="flex gap-4 text-sm">
                          <div><span className="text-slate-500">{L('Income', 'Доход', 'Даход')}: </span><span className="text-emerald-400">+{fmt(data.cashflow.income)}</span></div>
                          <div><span className="text-slate-500">{L('Expense', 'Расход', 'Выдатак')}: </span><span className="text-red-400">−{fmt(data.cashflow.expense)}</span></div>
                        </div>
                      </div>
                    )}
                    {data.spendByCategory && data.spendByCategory.length > 0 && (
                      <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                        <div className="text-slate-300 text-sm font-semibold mb-2">{L('Top spending', 'Топ расходов', 'Топ выдаткаў')}</div>
                        <div className="space-y-1">
                          {data.spendByCategory.slice(0, 5).map((s) => (
                            <div key={s.category} className="flex justify-between text-xs">
                              <span className="text-slate-300">{catLabel(s.category)}</span>
                              <span className="text-slate-400">{fmt(s.total)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Budget this month — plan totals + plan-vs-actual */}
              {data.budget && (data.budget.plannedIncome > 0 || data.budget.plannedExpense > 0) && (
                <div className="bg-surface-800 border border-slate-700 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold"><Target size={15} /> {L('Budget this month', 'Бюджет на месяц', 'Бюджэт на месяц')}</div>
                    <button onClick={() => rolloverMut.mutate()} disabled={rolloverMut.isPending} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1.5" title={L('Copy plan to next month', 'Повторить план на следующий месяц', 'Паўтарыць план на наступны месяц')}>
                      {rolloverMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CopyPlus size={13} />} {L('Next month', 'На след. месяц', 'На наст. месяц')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                    <div><span className="text-slate-500">{L('Planned income', 'План доход', 'План даход')}: </span><span className="text-emerald-400">+{fmt(data.budget.plannedIncome)}</span></div>
                    <div><span className="text-slate-500">{L('Planned expense', 'План расход', 'План выдатак')}: </span><span className="text-red-400">−{fmt(data.budget.plannedExpense)}</span></div>
                    {(data.budget.includedIncome > 0 || data.budget.includedExpense > 0) && (
                      <div className="text-slate-400">{L('In real balance', 'Учтено в балансе', 'Улічана ў балансе')}: <span className="text-emerald-400">+{fmt(data.budget.includedIncome)}</span> / <span className="text-red-400">−{fmt(data.budget.includedExpense)}</span></div>
                    )}
                  </div>
                  {data.planVsActual && data.planVsActual.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-500"><span>{L('Category', 'Категория', 'Катэгорыя')}</span><span>{L('plan / actual', 'план / факт', 'план / факт')}</span></div>
                      {data.planVsActual.slice(0, 6).map((p) => (
                        <div key={p.category} className="flex justify-between text-xs">
                          <span className="text-slate-300">{catLabel(p.category)}</span>
                          <span className={p.planned > 0 && p.actual > p.planned ? 'text-red-400' : 'text-slate-400'}>{fmt(p.planned)} / {fmt(p.actual)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Timeline */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-2">{L('Timeline', 'Лента', 'Стужка')}</h3>
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-slate-500">{tt.empty}</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.timeline.map((t, i) => (
                      <button key={`${t.recordId}-${i}`} onClick={() => navigate(`/projects/${projectId}/c/${t.collectionId}?record=${t.recordId}`)}
                        className="w-full flex items-center gap-3 text-left bg-surface-800/60 hover:bg-surface-800 border border-slate-800 rounded-lg px-3 py-2">
                        <span className="text-xs text-slate-500 tabular-nums w-24 flex-shrink-0">{t.date}</span>
                        <span className="text-[11px] text-primary-300/80 w-28 flex-shrink-0 truncate">{pickLocalized(t.collectionName, language)}</span>
                        <span className="text-sm text-slate-200 truncate">{t.title || '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {ocrOpen && <OcrSettingsModal projectId={projectId!} onClose={() => setOcrOpen(false)} />}
    </div>
  )
}

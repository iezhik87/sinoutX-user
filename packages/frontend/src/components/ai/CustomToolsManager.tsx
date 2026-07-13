import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Check, Loader2, Sparkles, Wrench, Play, ToggleLeft, ToggleRight, AlertCircle, Clock, Zap } from 'lucide-react'
import { customToolsApi, type CustomTool, type CustomToolParam } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { toast } from '@/stores/toastStore'

const blankTool = (): CustomTool => ({
  id: '', name: '', description: '', params: [],
  request: { method: 'GET', url: '', headers: [], query: [], bodyType: 'none' },
  auth: { type: 'none' }, secrets: {}, enabled: true,
})

const blankScheduledSkill = (): CustomTool => ({ ...blankTool(), kind: 'scheduled', schedule: { hour: 9 }, prompt: '' })
const blankTriggerSkill = (): CustomTool => ({ ...blankTool(), kind: 'trigger', event: 'record.created', prompt: '' })

function draftToTool(d: Record<string, any>): CustomTool {
  const t = blankTool()
  t.name = String(d.name ?? '')
  t.description = String(d.description ?? '')
  t.params = Array.isArray(d.params) ? d.params.map((p: any): CustomToolParam => ({
    key: String(p.key ?? 'param'), type: ['string', 'number', 'boolean', 'enum'].includes(p.type) ? p.type : 'string',
    required: !!p.required, description: String(p.description ?? ''), example: p.example,
    enumValues: Array.isArray(p.enumValues) ? p.enumValues.map(String) : undefined, default: p.default,
  })) : []
  if (d.request) t.request = {
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(d.request.method) ? d.request.method : 'GET',
    url: String(d.request.url ?? ''),
    headers: Array.isArray(d.request.headers) ? d.request.headers.map((h: any) => ({ key: String(h.key ?? ''), value: String(h.value ?? '') })) : [],
    query: Array.isArray(d.request.query) ? d.request.query.map((q: any) => ({ key: String(q.key ?? ''), value: String(q.value ?? '') })) : [],
    bodyType: ['none', 'json', 'form'].includes(d.request.bodyType) ? d.request.bodyType : 'none',
    bodyTemplate: d.request.bodyTemplate ? String(d.request.bodyTemplate) : undefined,
  }
  if (d.auth) t.auth = { type: ['none', 'bearer', 'header', 'basic'].includes(d.auth.type) ? d.auth.type : 'none', secretName: d.auth.secretName, headerName: d.auth.headerName }
  t.responseHint = d.responseHint ? String(d.responseHint) : undefined
  // empty secret slots for what the API needs
  const needed = new Set<string>()
  if (t.auth.secretName) needed.add(t.auth.secretName)
  if (Array.isArray(d.secretsNeeded)) d.secretsNeeded.forEach((s: any) => s?.name && needed.add(String(s.name)))
  needed.forEach((n) => { t.secrets[n] = '' })
  return t
}

// secret names referenced by the tool (auth + {{secret.x}} placeholders)
function secretNames(t: CustomTool): string[] {
  const s = new Set<string>(Object.keys(t.secrets))
  if (t.auth.secretName) s.add(t.auth.secretName)
  const scan = (str?: string) => { for (const m of (str ?? '').matchAll(/\{\{\s*secret\.([a-zA-Z0-9_]+)\s*\}\}/g)) s.add(m[1]) }
  scan(t.request.url); scan(t.request.bodyTemplate); t.request.headers.forEach((h) => scan(h.value))
  return [...s]
}

export function CustomToolsManager() {
  const { currentWorkspaceId } = useWorkspaceStore()
  const { language } = useLanguageStore()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const qc = useQueryClient()
  const wsId = currentWorkspaceId ?? ''

  const { data: tools } = useQuery({ queryKey: ['custom-tools', wsId], queryFn: () => customToolsApi.list(wsId), enabled: !!wsId })
  const [editing, setEditing] = useState<CustomTool | null>(null)

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['custom-tools', wsId] }); qc.invalidateQueries({ queryKey: ['ai-settings', wsId] }) }
  const saveMut = useMutation({ mutationFn: (t: CustomTool) => customToolsApi.save(wsId, t), onSuccess: () => { invalidate(); setEditing(null); toast.success(L('Skill saved', 'Навык сохранён', 'Навык захаваны')) }, onError: (e: Error) => toast.error(e.message) })
  const delMut = useMutation({ mutationFn: (id: string) => customToolsApi.remove(wsId, id), onSuccess: invalidate, onError: (e: Error) => toast.error(e.message) })
  const toggle = (t: CustomTool) => saveMut.mutate({ ...t, enabled: !t.enabled })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5"><Wrench size={12} /> {L('My skills', 'Мои навыки', 'Мае навыкі')}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(blankScheduledSkill())} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Clock size={13} />{L('+ Scheduled', '+ Расписание', '+ Расклад')}</button>
          <button onClick={() => setEditing(blankTriggerSkill())} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Zap size={13} />{L('+ Trigger', '+ Триггер', '+ Трыгер')}</button>
          <button onClick={() => setEditing(blankTool())} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Plus size={13} />{L('+ HTTP', '+ HTTP', '+ HTTP')}</button>
        </div>
      </div>

      {(!tools || tools.length === 0) && <p className="text-xs text-slate-600 mb-2">{L('Connect any HTTP API as a skill — the assistant will call it.', 'Подключи любой HTTP-API как навык — ассистент будет его вызывать.', 'Падключы любы HTTP-API як навык.')}</p>}

      <div className="space-y-0.5 mb-1">
        {tools?.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-800/50">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-slate-200 inline-flex items-center gap-1">
                {t.kind === 'scheduled' && <Clock size={11} className="text-primary-400" />}
                {t.kind === 'trigger' && <Zap size={11} className="text-primary-400" />}{t.name}
              </span>
              <span className="text-xs text-slate-500 ml-2">{t.kind === 'scheduled' ? L('daily', 'ежедневно', 'штодзень') + ` ${String(t.schedule?.hour ?? 9).padStart(2, '0')}:00` : t.kind === 'trigger' ? L('on', 'при', 'пры') + ` ${t.event}` : t.description}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => setEditing(t)} className="p-1 text-slate-500 hover:text-slate-300" title={L('Edit', 'Изменить', 'Змяніць')}><Pencil size={13} /></button>
              <button onClick={() => delMut.mutate(t.id)} className="p-1 text-slate-500 hover:text-red-400" title={L('Delete', 'Удалить', 'Выдаліць')}><Trash2 size={13} /></button>
              <button onClick={() => toggle(t)} title={t.enabled ? L('On', 'Вкл', 'Укл') : L('Off', 'Выкл', 'Выкл')}>
                {t.enabled ? <ToggleRight size={20} className="text-primary-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && ((editing.kind === 'scheduled' || editing.kind === 'trigger')
        ? <AutomationSkillModal initial={editing} L={L} onClose={() => setEditing(null)} onSave={(t) => saveMut.mutate(t)} saving={saveMut.isPending} />
        : <BuilderModal initial={editing} wsId={wsId} language={language} L={L} onClose={() => setEditing(null)} onSave={(t) => saveMut.mutate(t)} saving={saveMut.isPending} />)}
    </div>
  )
}

const TRIGGER_EVENTS = ['record.created', 'task.created', 'task.updated', 'page.created', 'note.created']

// Editor for the assistant's automation skills: scheduled (daily at an hour) or
// event-triggered (fires on a workspace event).
function AutomationSkillModal({ initial, L, onClose, onSave, saving }: {
  initial: CustomTool
  L: (en: string, ru: string, be: string) => string
  onClose: () => void; onSave: (t: CustomTool) => void; saving: boolean
}) {
  const [tool, setTool] = useState<CustomTool>(initial)
  const up = (p: Partial<CustomTool>) => setTool((t) => ({ ...t, ...p }))
  const isTrigger = tool.kind === 'trigger'
  const eventLabel = (e: string) => ({
    'record.created': L('a record is added (measurement, expense…)', 'добавлена запись в реестр (замер, трата…)', 'дададзены запіс'),
    'task.created': L('a task is created', 'создана задача', 'створана задача'),
    'task.updated': L('a task is updated', 'задача обновлена', 'задача абноўлена'),
    'page.created': L('a page is created', 'создана страница', 'створана старонка'),
    'note.created': L('a note is created', 'создана заметка', 'створана нататка'),
  } as Record<string, string>)[e] ?? e
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">{isTrigger ? <Zap size={15} className="text-primary-400" /> : <Clock size={15} className="text-primary-400" />}{isTrigger ? L('Event trigger', 'Триггер по событию', 'Трыгер па падзеі') : L('Scheduled skill', 'Скил по расписанию', 'Скіл па раскладзе')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={tool.name} onChange={(e) => up({ name: e.target.value })} placeholder={L('Name', 'Имя', 'Імя')} className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100" />
          {isTrigger ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{L('When', 'Когда', 'Калі')}:</span>
              <select value={tool.event ?? 'record.created'} onChange={(e) => up({ event: e.target.value })} className="flex-1 bg-surface-950 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200">
                {TRIGGER_EVENTS.map((e) => <option key={e} value={e}>{eventLabel(e)}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{L('Every day at', 'Каждый день в', 'Кожны дзень у')}:</span>
              <select value={tool.schedule?.hour ?? 9} onChange={(e) => up({ schedule: { hour: Number(e.target.value) } })} className="bg-surface-950 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </div>
          )}
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{isTrigger ? L('What to do when it fires', 'Что делать при срабатывании', 'Што рабіць') : L('What the assistant does each run', 'Что ассистент делает при каждом запуске', 'Што робіць пры запуску')}</p>
            <textarea value={tool.prompt ?? ''} onChange={(e) => up({ prompt: e.target.value })} rows={4}
              placeholder={isTrigger ? L('e.g. if it\'s a blood-pressure measurement with systolic >140, warn me', 'напр. если это замер давления и систолическое >140 — предупреди меня', 'напр. калі ціск >140 — папярэдзь') : L('e.g. collect today\'s tasks, events and payments for 3 days, send briefly', 'напр. собери задачи на сегодня, события и платежи на 3 дня, пришли кратко', 'напр. збяры задачы і падзеі')}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200" />
          </div>
          <p className="text-[11px] text-slate-600">{isTrigger ? L('If nothing is needed, the assistant stays silent. Otherwise it messages your Telegram.', 'Если ничего не нужно — промолчит. Иначе напишет тебе в Telegram.', 'Калі нічога не трэба — прамаўчыць.') : L('Result is delivered to your Telegram.', 'Результат придёт тебе в Telegram.', 'Вынік прыйдзе ў Telegram.')}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200">{L('Cancel', 'Отмена', 'Адмена')}</button>
          <button onClick={() => onSave(tool)} disabled={saving || !tool.name.trim() || !(tool.prompt ?? '').trim()} className="btn-primary text-xs py-1.5 px-4">{saving ? <Loader2 size={13} className="animate-spin" /> : L('Save', 'Сохранить', 'Захаваць')}</button>
        </div>
      </div>
    </div>
  )
}

function BuilderModal({ initial, wsId, language, L, onClose, onSave, saving }: {
  initial: CustomTool; wsId: string; language: string
  L: (en: string, ru: string, be: string) => string
  onClose: () => void; onSave: (t: CustomTool) => void; saving: boolean
}) {
  const [tool, setTool] = useState<CustomTool>(initial)
  const isNew = !initial.id
  const [desc, setDesc] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [curl, setCurl] = useState('')
  const [notes, setNotes] = useState<string>('')
  const [confidence, setConfidence] = useState<string>('')
  const [testInput, setTestInput] = useState<Record<string, string>>({})
  const [testOut, setTestOut] = useState<string>('')
  const up = (p: Partial<CustomTool>) => setTool((t) => ({ ...t, ...p }))

  const assembleMut = useMutation({
    mutationFn: () => customToolsApi.assemble(wsId, { description: desc, curl: curl || undefined, lang: language }),
    onSuccess: (draft) => { const t = draftToTool(draft); setTool(t); setNotes(String(draft.notes ?? '')); setConfidence(String(draft.confidence ?? '')) },
    onError: (e: Error) => toast.error(e.message),
  })
  const testMut = useMutation({
    mutationFn: () => customToolsApi.test(wsId, tool, testInput),
    onSuccess: (r) => setTestOut(JSON.stringify(r, null, 2)),
    onError: (e: Error) => setTestOut('Error: ' + e.message),
  })

  const secrets = secretNames(tool)

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><Wrench size={15} className="text-primary-400" />{isNew ? L('New skill', 'Новый навык', 'Новы навык') : L('Edit skill', 'Изменить навык', 'Змяніць навык')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          {/* AI assembly */}
          <div className="rounded-xl border border-primary-700/40 bg-primary-600/5 p-3">
            <p className="text-xs font-semibold text-primary-300 mb-1.5 flex items-center gap-1.5"><Sparkles size={13} />{L('Describe it — AI builds the draft', 'Опиши словами — AI соберёт черновик', 'Апішы словамі — AI збярэ чарнавік')}</p>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
              placeholder={L('e.g. convert currencies by current rate', 'напр. конвертировать валюты по текущему курсу', 'напр. канвертаваць валюты')}
              className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-200" />
            <div className="flex items-center gap-2 mt-1.5">
              <button onClick={() => assembleMut.mutate()} disabled={!desc.trim() || assembleMut.isPending} className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5">
                {assembleMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{L('Build with AI', 'Собрать с AI', 'Сабраць з AI')}
              </button>
              <button onClick={() => setAdvanced((v) => !v)} className="text-xs text-slate-500 hover:text-slate-300">{L('+ cURL', '+ cURL', '+ cURL')}</button>
            </div>
            {advanced && <textarea value={curl} onChange={(e) => setCurl(e.target.value)} rows={2} placeholder="curl https://api... -H 'X-Key: ...'" className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-[11px] font-mono text-slate-300 mt-1.5" />}
            {confidence && <p className={`text-[11px] mt-1.5 flex items-start gap-1 ${confidence === 'low' ? 'text-amber-400' : 'text-slate-500'}`}><AlertCircle size={11} className="mt-0.5 flex-shrink-0" />{L('Confidence', 'Уверенность', 'Упэўненасць')}: {confidence}{notes ? ` · ${notes}` : ''}</p>}
          </div>

          {/* Name + description */}
          <div className="grid grid-cols-1 gap-2">
            <input value={tool.name} onChange={(e) => up({ name: e.target.value })} placeholder={L('Skill name', 'Имя навыка', 'Імя навыку')} className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100" />
            <textarea value={tool.description} onChange={(e) => up({ description: e.target.value })} rows={2} placeholder={L('When to use it (for the agent)', 'Когда вызывать (для агента)', 'Калі выклікаць (для агента)')} className="w-full bg-surface-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300" />
          </div>

          {/* Params */}
          <div>
            <div className="flex items-center justify-between mb-1"><p className="text-[11px] text-slate-500 uppercase tracking-wider">{L('Parameters', 'Параметры', 'Параметры')}</p>
              <button onClick={() => up({ params: [...tool.params, { key: 'param', type: 'string', required: false }] })} className="text-xs text-primary-400 hover:text-primary-300"><Plus size={12} /></button></div>
            <div className="space-y-1">
              {tool.params.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={p.key} onChange={(e) => up({ params: tool.params.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} className="w-28 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-teal-400" />
                  <select value={p.type} onChange={(e) => up({ params: tool.params.map((x, j) => j === i ? { ...x, type: e.target.value as CustomToolParam['type'] } : x) })} className="bg-surface-950 border border-slate-700 rounded px-1 py-1 text-[11px] text-slate-300">
                    <option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="enum">enum</option>
                  </select>
                  <input value={p.description ?? ''} onChange={(e) => up({ params: tool.params.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} placeholder={L('description', 'описание', 'апісанне')} className="flex-1 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-300" />
                  <label className="text-[10px] text-slate-500 flex items-center gap-0.5"><input type="checkbox" checked={!!p.required} onChange={(e) => up({ params: tool.params.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} className="accent-primary-500" />{L('req', 'обяз', 'абав')}</label>
                  <button onClick={() => up({ params: tool.params.filter((_, j) => j !== i) })} className="text-slate-600 hover:text-red-400"><X size={12} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Request */}
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{L('Request', 'Запрос', 'Запыт')}</p>
            <div className="flex items-center gap-1.5 mb-1.5">
              <select value={tool.request.method} onChange={(e) => up({ request: { ...tool.request, method: e.target.value as CustomTool['request']['method'] } })} className="bg-surface-950 border border-slate-700 rounded px-1.5 py-1.5 text-xs text-slate-200">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input value={tool.request.url} onChange={(e) => up({ request: { ...tool.request, url: e.target.value } })} placeholder="https://api.example.com/...?x={param}" className="flex-1 bg-surface-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] font-mono text-slate-200" />
            </div>
            {/* Auth */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">{L('Auth', 'Авторизация', 'Аўтарызацыя')}:</span>
              <select value={tool.auth.type} onChange={(e) => up({ auth: { ...tool.auth, type: e.target.value as CustomTool['auth']['type'] } })} className="bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200">
                <option value="none">{L('none', 'нет', 'няма')}</option><option value="bearer">Bearer</option><option value="header">{L('API key (header)', 'Ключ (заголовок)', 'Ключ (загаловак)')}</option><option value="basic">Basic</option>
              </select>
              {tool.auth.type === 'header' && <input value={tool.auth.headerName ?? ''} onChange={(e) => up({ auth: { ...tool.auth, headerName: e.target.value } })} placeholder="X-Api-Key" className="w-28 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-slate-300" />}
              {tool.auth.type !== 'none' && <input value={tool.auth.secretName ?? ''} onChange={(e) => up({ auth: { ...tool.auth, secretName: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') } })} placeholder={L('secret name', 'имя секрета', 'імя сакрэту')} className="w-28 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-slate-300" />}
            </div>
          </div>

          {/* Secrets */}
          {secrets.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{L('Secrets (encrypted)', 'Секреты (шифруются)', 'Сакрэты (шыфруюцца)')}</p>
              {secrets.map((n) => (
                <div key={n} className="flex items-center gap-1.5 mb-1">
                  <code className="text-[11px] text-teal-400 w-28">{n}</code>
                  <input type="password" value={tool.secrets[n] ?? ''} onChange={(e) => up({ secrets: { ...tool.secrets, [n]: e.target.value } })} placeholder={L('paste your key', 'вставь свой ключ', 'устаў свой ключ')} className="flex-1 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200" />
                </div>
              ))}
            </div>
          )}

          {/* responseHint */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">{L('Return to agent (dot-path, optional)', 'Возвращать агенту (dot-path, опц.)', 'Вяртаць агенту (dot-path)')}:</span>
            <input value={tool.responseHint ?? ''} onChange={(e) => up({ responseHint: e.target.value })} placeholder="result.rate" className="flex-1 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-slate-300" />
          </div>

          {/* Test */}
          <div className="rounded-xl border border-slate-800 p-3">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Play size={11} />{L('Test', 'Тест', 'Тэст')}</p>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {tool.params.map((p) => (
                <input key={p.key} value={testInput[p.key] ?? ''} onChange={(e) => setTestInput((s) => ({ ...s, [p.key]: e.target.value }))} placeholder={`${p.key}${p.example != null ? ` (${p.example})` : ''}`} className="w-32 bg-surface-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200" />
              ))}
            </div>
            <button onClick={() => testMut.mutate()} disabled={!tool.request.url || testMut.isPending} className="btn-ghost text-xs py-1 px-3 flex items-center gap-1.5">
              {testMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}{L('Run', 'Запустить', 'Запусціць')}
            </button>
            {testOut && <pre className="mt-2 text-[11px] text-slate-400 bg-surface-950 rounded-lg p-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono">{testOut}</pre>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5">{L('Cancel', 'Отмена', 'Адмена')}</button>
          <button onClick={() => onSave(tool)} disabled={!tool.name.trim() || !tool.request.url.trim() || saving} className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{L('Add', 'Добавить', 'Дадаць')}
          </button>
        </div>
      </div>
    </div>
  )
}

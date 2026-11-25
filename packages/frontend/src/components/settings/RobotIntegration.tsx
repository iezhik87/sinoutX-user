import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Bot, Check, Copy, Loader2, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { integrationApi, projectApi, robotApi, type RobotSettings } from '@/api/client'
import { getDateLocale } from '@/i18n/dateLocale'
import { useLanguageStore } from '@/stores/languageStore'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/utils'

function useTt() {
  const { language } = useLanguageStore()
  return (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
}

/** Карточка робота на вкладке интеграций: подключение, ключ, окно настроек. */
export function RobotCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const tt = useTt()
  const { language } = useLanguageStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)

  const { data: status, isLoading } = useQuery({
    queryKey: ['robot-status', workspaceId],
    queryFn: () => robotApi.status(workspaceId),
    enabled: !!workspaceId,
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['robot-status', workspaceId] })

  const connect = useMutation({
    mutationFn: () => robotApi.connect(workspaceId),
    onSuccess: (r) => { setIssued(r.key); invalidate() },
    onError: () => toast.error(tt('Could not connect the robot', 'Не удалось подключить робота', 'Не ўдалося падключыць робата')),
  })
  const disconnect = useMutation({
    mutationFn: () => integrationApi.disable(status!.integrationId!),
    onSuccess: () => { setIssued(null); invalidate() },
    onError: () => toast.error(tt('Could not disconnect the robot', 'Не удалось отключить робота', 'Не ўдалося адключыць робата')),
  })

  const connected = !!status?.connected
  const appUrl = window.location.origin

  return (
    <div className={cn('bg-surface-900 border rounded-xl p-4 transition-colors', connected ? 'border-primary-700/50' : 'border-slate-800')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', connected ? 'bg-primary-600/20 text-primary-400' : 'bg-slate-800 text-slate-400')}>
            <Bot size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-200">{tt('Robot', 'Робот', 'Робат')}</h3>
              {connected && (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded-full">
                  <Check size={9} /> {tt('Connected', 'Подключён', 'Падключаны')}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {connected && status?.lastSeenAt
                ? `${tt('Last request', 'Последнее обращение', 'Апошняе звяртанне')}: ${formatDistanceToNow(new Date(status.lastSeenAt), { locale: getDateLocale(language), addSuffix: true })}`
                : tt('Desktop voice assistant with access to this workspace', 'Голосовой ассистент на столе с доступом ко всему этому пространству', 'Галасавы асістэнт на стале з доступам да ўсёй гэтай прасторы')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {isLoading ? (
            <Loader2 size={14} className="animate-spin text-primary-500" />
          ) : (
            <>
              {status?.integrationId && (
                <button onClick={() => setSettingsOpen(true)} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
                  <SlidersHorizontal size={12} /> {tt('Settings', 'Настройки', 'Налады')}
                </button>
              )}
              <button
                onClick={() => {
                  if (!connected || confirm(tt('Issue a new key? The current one stops working right away.', 'Выпустить новый ключ? Текущий сразу перестанет работать.', 'Выпусціць новы ключ? Бягучы адразу перастане працаваць.'))) connect.mutate()
                }}
                disabled={connect.isPending}
                className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"
              >
                {connected ? tt('New key', 'Новый ключ', 'Новы ключ') : <><Plus size={12} /> {tt('Connect', 'Подключить', 'Падключыць')}</>}
              </button>
              {connected && (
                <button
                  onClick={() => { if (confirm(tt('Disconnect the robot? Its key stops working.', 'Отключить робота? Его ключ перестанет работать.', 'Адключыць робата? Яго ключ перастане працаваць.'))) disconnect.mutate() }}
                  className="btn-ghost text-xs px-2 py-1"
                >
                  {tt('Disconnect', 'Отключить', 'Адключыць')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {issued && (
        <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
          <p className="text-xs text-green-400">
            {tt('Copy this into the robot gateway settings. The key is shown only once.', 'Перенеси это в настройки шлюза робота. Ключ показывается только один раз.', 'Перанясі гэта ў налады шлюза робата. Ключ паказваецца толькі адзін раз.')}
          </p>
          <CopyRow label="SINOUT_URL" value={appUrl} />
          <CopyRow label="SINOUT_WORKSPACE_ID" value={workspaceId} />
          <CopyRow label="SINOUT_API_KEY" value={issued} />
          <div className="flex justify-end">
            <button onClick={() => setIssued(null)} className="btn-ghost text-xs px-2 py-1">{tt('Done', 'Готово', 'Гатова')}</button>
          </div>
        </div>
      )}

      {settingsOpen && status && (
        <RobotSettingsModal
          workspaceId={workspaceId}
          initial={status.settings}
          defaults={status.defaults}
          initialProjectId={status.defaultProjectId}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setSettingsOpen(false); invalidate() }}
        />
      )}
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[11px] text-slate-500 mb-0.5 block">{label}</label>
      <div className="flex items-center gap-2 bg-surface-950 border border-slate-700 rounded-md px-3 py-2">
        <code className="text-xs text-slate-300 flex-1 break-all">{value}</code>
        <button onClick={() => navigator.clipboard.writeText(value)} className="text-slate-400 hover:text-slate-200 flex-shrink-0">
          <Copy size={13} />
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      {children}
    </section>
  )
}

function Slider({ label, hint, value, shown, min, max, step, onChange }: {
  label: string; hint: string; value: number; shown: string; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label className="text-sm text-slate-200">{label}</label>
        <span className="text-xs text-slate-400 tabular-nums">{shown}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary-500"
      />
      <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
    </div>
  )
}

// Порог шума: чем он меньше, тем чувствительнее микрофон. Пользователю понятнее
// наоборот — ползунок вправо значит «слышит лучше», поэтому шкала перевёрнута.
const NOISE_SUM = 7.5

function RobotSettingsModal({ workspaceId, initial, defaults, initialProjectId, onClose, onSaved }: {
  workspaceId: string
  initial: RobotSettings
  defaults: RobotSettings
  initialProjectId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const tt = useTt()
  const [form, setForm] = useState<RobotSettings>(initial)
  const [stopWords, setStopWords] = useState(initial.stopWords.join(', '))
  const [projectId, setProjectId] = useState<string | null>(initialProjectId)
  const set = <K extends keyof RobotSettings>(key: K, value: RobotSettings[K]) => setForm((f) => ({ ...f, [key]: value }))
  const sec = tt('s', 'с', 'с')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => projectApi.listByWorkspace(workspaceId),
  })

  const save = useMutation({
    mutationFn: () => robotApi.saveSettings({
      workspaceId,
      defaultProjectId: projectId,
      settings: { ...form, stopWords: stopWords.split(',').map((w) => w.trim()).filter(Boolean) },
    }),
    onSuccess: onSaved,
    onError: () => toast.error(tt('Could not save the settings', 'Не удалось сохранить настройки', 'Не ўдалося захаваць налады')),
  })

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-primary-400" />
            <h3 className="text-sm font-semibold text-slate-200">{tt('Robot settings', 'Настройки робота', 'Налады робата')}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          <Section title={tt('Hearing', 'Слух', 'Слых')}>
            <Slider
              label={tt('Microphone sensitivity', 'Чувствительность микрофона', 'Адчувальнасць мікрафона')}
              hint={tt('Higher: hears quiet speech, but reacts to noise more often.', 'Выше: слышит тихую речь, но чаще реагирует на шум.', 'Вышэй: чуе ціхую гаворку, але часцей рэагуе на шум.')}
              value={NOISE_SUM - form.noiseFactor} shown={(NOISE_SUM - form.noiseFactor).toFixed(1)}
              min={1.5} max={6} step={0.1}
              onChange={(v) => set('noiseFactor', Number((NOISE_SUM - v).toFixed(1)))}
            />
            <Slider
              label={tt('Waiting for a phrase', 'Ожидание фразы', 'Чаканне фразы')}
              hint={tt('How long it listens for speech after the wake word.', 'Сколько ждать начала речи после слова-обращения.', 'Колькі чакаць пачатку гаворкі пасля слова-звароту.')}
              value={form.waitSpeechS} shown={`${form.waitSpeechS} ${sec}`} min={2} max={15} step={0.5}
              onChange={(v) => set('waitSpeechS', v)}
            />
            <Slider
              label={tt('Pause at the end of a phrase', 'Пауза в конце фразы', 'Паўза ў канцы фразы')}
              hint={tt('Longer: does not interrupt you when you pause to think, but answers later.', 'Дольше: не перебьёт, когда задумаешься, но ответит позже.', 'Даўжэй: не перапыніць, калі задумаешся, але адкажа пазней.')}
              value={form.endSilenceS} shown={`${form.endSilenceS} ${sec}`} min={0.4} max={3} step={0.1}
              onChange={(v) => set('endSilenceS', v)}
            />
          </Section>

          <Section title={tt('Conversation', 'Разговор', 'Размова')}>
            <Slider
              label={tt('Continue without the wake word', 'Продолжение без слова-обращения', 'Працяг без слова-звароту')}
              hint={tt('How long after an answer you can keep talking. 0 turns this off.', 'Сколько после ответа можно говорить дальше. 0 — выключено.', 'Колькі пасля адказу можна гаварыць далей. 0 — выключана.')}
              value={form.followUpS} shown={`${form.followUpS} ${sec}`} min={0} max={30} step={1}
              onChange={(v) => set('followUpS', v)}
            />
            <div>
              <label className="text-sm text-slate-200 mb-1 block">{tt('Stop words', 'Стоп-слова', 'Стоп-словы')}</label>
              <input
                value={stopWords}
                onChange={(e) => setStopWords(e.target.value)}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-[11px] text-slate-500 mt-0.5">{tt('Comma-separated. Saying one of them ends the conversation.', 'Через запятую. Любое из них завершает разговор.', 'Праз коску. Любое з іх завяршае размову.')}</p>
            </div>
          </Section>

          <Section title={tt('Answers', 'Ответы', 'Адказы')}>
            <div>
              <label className="text-sm text-slate-200 mb-1 block">{tt('Answer length', 'Длина ответов', 'Даўжыня адказаў')}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ['short', tt('Short', 'Коротко', 'Коратка')],
                  ['normal', tt('Medium', 'Средне', 'Сярэдне')],
                  ['detailed', tt('Detailed', 'Подробно', 'Падрабязна')],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => set('answerLength', id)}
                    className={cn('text-xs px-2 py-1.5 rounded-md border transition-colors', form.answerLength === id ? 'border-primary-500 bg-primary-600/20 text-primary-300' : 'border-slate-700 text-slate-400 hover:text-slate-200')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-200 mb-1 block">{tt('Wishes for answers', 'Пожелания к ответам', 'Пажаданні да адказаў')}</label>
              <textarea
                rows={3} maxLength={1000}
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder={tt('For example: address me informally, joke sometimes', 'Например: обращайся на ты, иногда шути', 'Напрыклад: звяртайся на ты, часам жартуй')}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
            <div>
              <label className="text-sm text-slate-200 mb-1 block">{tt('Default project', 'Проект по умолчанию', 'Праект па змаўчанні')}</label>
              <select
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
                className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{tt('Not selected', 'Не выбран', 'Не выбраны')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-0.5">{tt('Dictated tasks and notes land here unless you name another project.', 'Сюда попадают продиктованные задачи и заметки, если не назвать другой проект.', 'Сюды трапляюць прадыктаваныя задачы і нататкі, калі не назваць іншы праект.')}</p>
            </div>
          </Section>

          <Section title={tt('Voice', 'Голос', 'Голас')}>
            <Slider
              label={tt('Volume', 'Громкость', 'Гучнасць')}
              hint={tt('Robot speaker volume.', 'Громкость динамика робота.', 'Гучнасць дынаміка робата.')}
              value={form.volume} shown={`${form.volume}%`} min={0} max={100} step={5}
              onChange={(v) => set('volume', v)}
            />
          </Section>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={() => { setForm(defaults); setStopWords(defaults.stopWords.join(', ')) }}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <RotateCcw size={12} /> {tt('Defaults', 'По умолчанию', 'Па змаўчанні')}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">{tt('Cancel', 'Отмена', 'Адмена')}</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary flex items-center gap-1.5">
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} /> {tt('Save', 'Сохранить', 'Захаваць')}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

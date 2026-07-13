import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check } from 'lucide-react'
import { collectionApi, moduleApi } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { useLanguageStore } from '@/stores/languageStore'
import { toast } from '@/stores/toastStore'

const inp = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200'

export function OcrSettingsModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved?: () => void }) {
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const { data: providers = [] } = useQuery({ queryKey: ['ocr-providers'], queryFn: moduleApi.ocrProviders })
  const { data: cfg, isLoading } = useQuery({ queryKey: ['ocr-config', projectId], queryFn: () => collectionApi.getOcrConfig(projectId) })

  const [form, setForm] = useState({ provider: 'openrouter', model: '', baseUrl: '', apiKey: '' })
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (cfg && !seeded) {
      setForm((f) => ({ ...f, provider: cfg.provider || 'openrouter', model: cfg.model || '', baseUrl: cfg.baseUrl || '' }))
      setSeeded(true)
    }
  }, [cfg, seeded])

  const provInfo = providers.find((p) => p.key === form.provider)
  const isConfigured = (!!cfg?.hasKey && !!cfg?.model) || !!cfg?.managedFallback
  const valid = !!form.model.trim() && (!!form.apiKey.trim() || !!cfg?.hasKey) && (!provInfo?.custom || !!form.baseUrl.trim())
  // Nothing to configure here when the instance already lends a key — say so
  // instead of showing an empty form that looks broken.
  const usingShared = !cfg?.hasKey && !!cfg?.managedFallback

  const save = useMutation({
    mutationFn: () => collectionApi.saveOcrConfig(projectId, {
      provider: form.provider, model: form.model.trim(),
      baseUrl: form.baseUrl.trim() || undefined, apiKey: form.apiKey.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-config', projectId] })
      toast.success(L('Saved', 'Сохранено', 'Захавана'))
      onSaved?.(); onClose()
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  // Forget the module's own key. Recognition then uses the instance key if there
  // is one, and stops if there is not — which is the honest outcome, not a
  // half-configured module pretending to work.
  const reset = useMutation({
    mutationFn: () => collectionApi.saveOcrConfig(projectId, { reset: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-config', projectId] })
      toast.success(L('Reset', 'Сброшено', 'Скінута'))
      onSaved?.(); onClose()
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const setProvider = (p: string) => setForm((f) => ({ ...f, provider: p, model: '' }))

  return (
    <Modal open onClose={onClose} title={L('Recognition (OCR) settings', 'Настройки распознавания (OCR)', 'Налады распазнавання (OCR)')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-2 w-2 rounded-full ${isConfigured ? 'bg-emerald-500' : 'bg-slate-600'}`} />
          <span className={`text-xs ${isConfigured ? 'text-emerald-400' : 'text-slate-500'}`}>
            {isConfigured ? L('Active', 'Активно', 'Актыўна') : L('Not configured', 'Не настроено', 'Не наладжана')}
          </span>
        </div>
        <p className="text-xs text-slate-400">{L('Pick a vision-capable model. Photos are sent to your provider on your own key (BYOK).', 'Выберите модель с поддержкой изображений. Фото уходит вашему провайдеру на ваш ключ (BYOK).', 'Абярыце мадэль з падтрымкай малюнкаў. Фота сыходзіць вашаму правайдэру на ваш ключ (BYOK).')}</p>

        {isLoading ? <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div> : <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('Provider', 'Провайдер', 'Правайдэр')}</label>
            <select value={form.provider} onChange={(e) => setProvider(e.target.value)} className={inp}>
              {providers.map((p) => <option key={p.key} value={p.key}>{p.custom ? L('Custom (OpenAI-compatible)', 'Свой (OpenAI-совместимый)', 'Свой (OpenAI-сумяшчальны)') : p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('Model', 'Модель', 'Мадэль')}</label>
            {provInfo?.custom || (provInfo?.models.length ?? 0) === 0 ? (
              <input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="model id" className={inp} />
            ) : (
              <select value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} className={inp}>
                <option value="">—</option>
                {provInfo?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}
          </div>

          {provInfo?.custom && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Base URL</label>
              <input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://…/v1" className={inp} />
            </div>
          )}

          {usingShared && (
            <p className="text-[11px] text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
              {L(
                'This instance provides a shared recognition key — receipts and lab results already work. Add your own key only to use a different model.',
                'Инстанс предоставляет общий ключ распознавания — чеки и анализы уже работают. Свой ключ нужен, только если хотите другую модель.',
                'Інстанс дае агульны ключ распазнавання — чэкі і аналізы ўжо працуюць. Свой ключ патрэбны, толькі каб узяць іншую мадэль.',
              )}
            </p>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('API key', 'API-ключ', 'API-ключ')}{cfg?.hasKey && <span className="text-emerald-400 ml-2 text-[11px]">✓ {L('saved', 'сохранён', 'захаваны')}</span>}</label>
            <input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={cfg?.hasKey ? L('leave blank to keep', 'оставьте пустым, чтобы не менять', 'пакіньце пустым') : 'sk-…'} className={inp} />
          </div>

          {!valid && (
            <p className="text-[11px] text-amber-400">
              {!form.model.trim() ? L('Choose a model.', 'Выберите модель.', 'Абярыце мадэль.')
                : provInfo?.custom && !form.baseUrl.trim() ? L('Base URL is required for a custom provider.', 'Для своего провайдера нужен Base URL.', 'Для свайго правайдэра патрэбен Base URL.')
                  : L('Enter an API key.', 'Введите API-ключ.', 'Увядзіце API-ключ.')}
            </p>
          )}
        </>}

        <div className="flex justify-end gap-2 pt-1">
          {cfg?.hasKey && (
            <button
              onClick={() => {
                if (!confirm(L('Forget this key, model and base URL?', 'Забыть ключ, модель и Base URL?', 'Забыць ключ, мадэль і Base URL?'))) return
                reset.mutate()
              }}
              disabled={reset.isPending}
              className="btn-ghost text-sm px-3 py-1.5 mr-auto text-slate-500 hover:text-red-400"
            >
              {reset.isPending ? <Loader2 size={14} className="animate-spin" /> : L('Reset', 'Сбросить', 'Скінуць')}
            </button>
          )}
          <button onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">{L('Cancel', 'Отмена', 'Адмена')}</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !valid} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{L('Save', 'Сохранить', 'Захаваць')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

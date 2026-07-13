import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/useT'
import { Loader2, Check, Plug, RotateCcw, Pencil } from 'lucide-react'

export interface ModelOpt { id: string; label: string }

export interface ProviderState {
  hasKey: boolean
  provider?: string
  model?: string
  baseUrl?: string
}

/**
 * One provider slot, configured the same way everywhere: pick a provider, paste
 * a key, Connect, choose a model from what the provider reports, Save. When it is
 * done it collapses to a green «connected: provider · model» line.
 *
 * The two callbacks are all that differ between the admin's managed keys and a
 * user's BYOK: `listModels` verifies the key and returns models, `save` persists
 * the choice. Everything else — the flow, the wording, the green line — is shared,
 * which is the whole point.
 */
export function ProviderConnect({
  title,
  providers,
  current,
  keyless,
  staticModels,
  listModels,
  save,
  reset,
}: {
  title: string
  providers: readonly string[]
  current: ProviderState
  /** Providers that need no key (pollinations, ollama). */
  keyless?: (provider: string) => boolean
  /** Fallback list when the provider has no queryable /models (image gen). */
  staticModels?: (provider: string) => ModelOpt[]
  /** Verify the key and return the provider's models. Empty array = keep typing. */
  listModels: (p: { provider: string; apiKey?: string; baseUrl?: string }) => Promise<{ ok: boolean; models?: ModelOpt[]; error?: string }>
  save: (p: { provider: string; model: string; apiKey?: string; baseUrl?: string }) => Promise<void>
  reset?: () => Promise<void>
}) {
  const t = useT().settings.connect
  const connected = current.hasKey && !!current.model
  const [editing, setEditing] = useState(false)

  const [provider, setProvider] = useState(current.provider ?? '')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(current.baseUrl ?? '')
  const [model, setModel] = useState(current.model ?? '')
  const [models, setModels] = useState<ModelOpt[]>([])
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)

  const needsKey = !keyless?.(provider)
  // A keyless provider is "connected" the moment it is picked; a keyed one needs
  // the Connect round-trip so we know the key works before offering its models.
  const canConnect = !!provider && (!needsKey || !!apiKey.trim() || current.hasKey)

  // ── Collapsed green line ────────────────────────────────────────────────────
  if (connected && !editing) {
    return (
      <div className="bg-surface-800 border border-emerald-700/40 rounded-xl p-4 flex items-center gap-3">
        <Check size={15} className="text-emerald-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-200">{title}</div>
          <div className="text-xs text-emerald-400/90 font-mono truncate">{current.provider} · {current.model}</div>
        </div>
        <button onClick={() => { setEditing(true); setPhase('idle'); setModels([]) }} className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1">
          <Pencil size={11} /> {t.change}
        </button>
        {reset && (
          <button
            onClick={async () => { if (confirm(t.resetConfirm)) await reset() }}
            className="text-[11px] text-slate-500 hover:text-red-400 flex items-center gap-1"
          >
            <RotateCcw size={11} /> {t.reset}
          </button>
        )}
      </div>
    )
  }

  const doConnect = async () => {
    setPhase('connecting'); setError(null)
    try {
      const r = await listModels({ provider, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined })
      if (!r.ok) { setError(r.error ?? t.connectFail); setPhase('idle'); return }
      const list = r.models?.length ? r.models : (staticModels?.(provider) ?? [])
      setModels(list)
      // Keep the saved model selected if it is still offered.
      if (!list.some((m) => m.id === model)) setModel(list[0]?.id ?? '')
      setPhase('connected')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.connectFail); setPhase('idle')
    }
  }

  const doSave = async () => {
    if (!provider || !model) return
    setPhase('saving'); setError(null)
    try {
      await save({ provider, model, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.saveFail); setPhase('connected')
    }
  }

  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200'

  return (
    <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-200">{title}</span>
        {connected && <button onClick={() => setEditing(false)} className="text-[11px] text-slate-500 hover:text-slate-300">{t.cancel}</button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setPhase('idle'); setModels([]); setModel('') }}
          className={cn(input, 'appearance-none')}
        >
          <option value="">{t.pickProvider}</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {needsKey && (
          <input
            type="password" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={current.hasKey ? t.keyKeep : t.keyPlaceholder}
            className={cn(input, 'font-mono')}
          />
        )}

        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t.baseUrl} className={cn(input, 'font-mono')} />
      </div>

      {/* Step 1 → Connect, step 2 → pick a model + Save. */}
      {phase === 'connected' || phase === 'saving' ? (
        <div className="space-y-2">
          <div className="text-[11px] text-emerald-400 flex items-center gap-1"><Check size={12} /> {t.connected} · {models.length} {t.models}</div>
          {models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={cn(input, 'appearance-none')}>
              <option value="">{t.pickModel}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t.model} className={cn(input, 'font-mono')} />
          )}
          <button
            onClick={doSave}
            disabled={!model || phase === 'saving'}
            className="btn btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40"
          >
            {phase === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t.save}
          </button>
        </div>
      ) : (
        <button
          onClick={doConnect}
          disabled={!canConnect || phase === 'connecting'}
          className="btn btn-secondary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40"
        >
          {phase === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
          {t.connect}
        </button>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

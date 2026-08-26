import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/useT'
import { Loader2, Check, RotateCcw, Pencil } from 'lucide-react'

export interface ModelOpt { id: string; label: string }

export interface ProviderState {
  hasKey: boolean
  provider?: string
  model?: string
  baseUrl?: string
}

/**
 * One provider slot — the LLM, vision, embeddings and image generation all use
 * this same component, so all four behave identically.
 *
 * The flow follows one rule: a model list can only come from a provider that has
 * a key, and a key belongs to the provider it was saved under. Hence:
 *   nothing set        → provider «none», empty key, no models
 *   provider picked    → «enter the key», still no models
 *   key entered        → the provider is asked for its models
 *   model picked, save → collapses to the green «provider · model» line
 *   Change             → provider shown, key reads «entered», models reloaded
 *   provider swapped   → key drops, models empty until a new key is typed
 *
 * The two callbacks are all that differ between the admin's managed keys and a
 * user's BYOK: `listModels` fetches (and thereby validates) the models, `save`
 * persists the choice.
 */
export function ProviderConnect({
  title,
  providers,
  current,
  keyless,
  staticModels,
  listModels,
  verify,
  save,
  reset,
}: {
  title: string
  providers: readonly string[]
  current: ProviderState
  /** Providers that need no key (pollinations, ollama). */
  keyless?: (provider: string) => boolean
  /** Fallback list when the provider cannot be asked for one. */
  staticModels?: (provider: string) => ModelOpt[]
  /** Fetch the provider's models. A rejection here is how a bad key surfaces. */
  listModels: (p: { provider: string; apiKey?: string; baseUrl?: string }) => Promise<{ ok: boolean; models?: ModelOpt[]; error?: string }>
  /** Optional extra proof that key + model answer, run before saving. */
  verify?: (p: { provider: string; model: string; apiKey?: string; baseUrl?: string }) => Promise<{ ok: boolean; error?: string }>
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
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped when the user finishes typing a key — the models are fetched then,
  // not on every keystroke.
  const [keyEpoch, setKeyEpoch] = useState(0)

  const needsKey = !keyless?.(provider)
  // The stored key was issued for the stored provider; pick another one and we
  // have no key for it, which is exactly why its model list must start empty.
  const storedKeyUsable = !!current.hasKey && provider === current.provider
  const haveKey = !needsKey || !!apiKey.trim() || storedKeyUsable
  const formOpen = !connected || editing

  useEffect(() => {
    if (!formOpen || !provider || !haveKey) { setModels([]); return }
    let cancelled = false
    setLoading(true); setError(null)
    // A blank apiKey means «use the one already stored» — the server resolves it.
    listModels({ provider, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined })
      .then((r) => {
        if (cancelled) return
        const fallback = staticModels?.(provider) ?? []
        if (!r.ok) { setError(r.error ?? t.connectFail); setModels(fallback); return }
        const list = r.models?.length ? r.models : fallback
        setModels(list)
        // Drop a model the provider no longer offers, so Save cannot submit it.
        setModel((m) => (m && list.some((x) => x.id === m) ? m : ''))
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : t.connectFail)
        setModels(staticModels?.(provider) ?? [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // `apiKey` is deliberately absent: `keyEpoch` is what says it is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, baseUrl, keyEpoch, storedKeyUsable, needsKey, formOpen])

  // ── Collapsed green line ────────────────────────────────────────────────────
  if (connected && !editing) {
    return (
      <div className="bg-surface-800 border border-emerald-700/40 rounded-xl p-4 flex items-center gap-3">
        <Check size={15} className="text-emerald-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-200">{title}</div>
          <div className="text-xs text-emerald-400/90 font-mono truncate">{current.provider} · {current.model}</div>
        </div>
        <button
          onClick={() => {
            // Reopen on exactly what is stored, so «Change» never shows a form
            // half-filled with whatever was typed and abandoned last time.
            setEditing(true)
            setProvider(current.provider ?? '')
            setBaseUrl(current.baseUrl ?? '')
            setModel(current.model ?? '')
            setApiKey(''); setError(null)
          }}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
        >
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

  const pickProvider = (p: string) => {
    setProvider(p)
    setModels([])
    setError(null)
    // Returning to the saved provider restores what was saved with it; any other
    // choice starts blank, because the stored key does not belong to it.
    const back = p === current.provider
    setApiKey('')
    setModel(back ? (current.model ?? '') : '')
    setBaseUrl(back ? (current.baseUrl ?? '') : '')
  }

  const submitKey = () => { if (apiKey.trim()) setKeyEpoch((n) => n + 1) }

  const doSave = async () => {
    if (!provider || !model) return
    setSaving(true); setError(null)
    const args = { provider, model, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined }
    try {
      if (verify) {
        const v = await verify(args)
        if (!v.ok) { setError(v.error ?? t.connectFail); return }
      }
      await save(args)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.saveFail)
    } finally {
      setSaving(false)
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
        <select value={provider} onChange={(e) => pickProvider(e.target.value)} className={cn(input, 'appearance-none')}>
          <option value="">{t.pickProvider}</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {needsKey && (
          <input
            type="password" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={submitKey}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitKey() } }}
            placeholder={storedKeyUsable ? t.keyEntered : t.keyPlaceholder}
            className={cn(input, 'font-mono', storedKeyUsable && !apiKey && 'placeholder:text-emerald-400/70')}
            disabled={!provider}
          />
        )}

        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t.baseUrl}
          className={cn(input, 'font-mono')} disabled={!provider} />
      </div>

      {/* The model list exists only once there is a key to fetch it with. */}
      {provider && haveKey && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Loader2 size={12} className="animate-spin" /> {t.pickModel}
            </div>
          ) : models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={cn(input, 'appearance-none')}>
              <option value="">{t.pickModel}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t.model} className={cn(input, 'font-mono')} />
          )}
          <button
            onClick={doSave}
            disabled={!model || saving || loading}
            className="btn btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t.save}
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

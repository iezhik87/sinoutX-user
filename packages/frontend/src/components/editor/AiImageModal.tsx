import { useState, useRef, useEffect } from 'react'
import { ImagePlus, X, Sparkles, Loader2, RotateCcw } from 'lucide-react'
import { aiApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n/useT'

interface AiImageModalProps {
  onInsert: (url: string) => void
  onClose: () => void
  projectId?: string
}

export function AiImageModal({ onInsert, onClose, projectId }: AiImageModalProps) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const t = useT()
  const { currentWorkspaceId } = useWorkspaceStore()

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function generate() {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError(null)
    setPreviewUrl(null)
    try {
      const { url } = await aiApi.generateImage(prompt.trim(), currentWorkspaceId ?? undefined, projectId)
      setPreviewUrl(url)
    } catch {
      setError(t.editor.aiImage.errorGeneration)
    } finally {
      setLoading(false)
    }
  }

  function handleInsert() {
    if (previewUrl) {
      onInsert(previewUrl)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
            <ImagePlus size={16} className="text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">{t.editor.aiImage.title}</p>
            <p className="text-xs text-slate-500">{t.editor.aiImage.subtitle}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  generate()
                }
              }}
              placeholder={t.editor.aiImage.promptPlaceholder}
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
            />
            <p className="text-xs text-slate-600 mt-1">{t.editor.aiImage.ctrlEnter}</p>
          </div>

          {!previewUrl && (
            <button
              onClick={generate}
              disabled={!prompt.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)' }}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" />{t.editor.aiImage.generating}</>
                : <><Sparkles size={15} />{t.editor.aiImage.generate}</>}
            </button>
          )}

          {loading && (
            <p className="text-xs text-slate-500 text-center">{t.editor.aiImage.progressHint}</p>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          {previewUrl && (
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden border border-slate-700">
                <img src={previewUrl} alt="Generated" className="w-full object-cover" />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPreviewUrl(null); generate() }}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm text-slate-400 border border-slate-700 hover:border-slate-600 hover:text-slate-200 transition-colors"
                >
                  <RotateCcw size={14} />
                  {t.editor.aiImage.regenerate}
                </button>
                <button
                  onClick={handleInsert}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)' }}
                >
                  <ImagePlus size={14} />
                  {t.editor.aiImage.insert}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

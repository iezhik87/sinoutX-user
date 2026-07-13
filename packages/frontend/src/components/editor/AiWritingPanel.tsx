import { useState, useEffect, useRef } from 'react'
import { Sparkles, Check, X, Loader2, RotateCcw } from 'lucide-react'
import { aiApi } from '@/api/client'
import { useLanguageStore } from '@/stores/languageStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n/useT'

export type AiWriteAction = 'continue' | 'improve' | 'summarize' | 'shorter' | 'longer' | 'translate' | 'explain'

interface AiWritingPanelProps {
  action: AiWriteAction
  contextText: string
  onInsert: (text: string) => void
  onDiscard: () => void
}

function buildPrompt(action: AiWriteAction, language: string, contextText: string): string {
  const lang = language === 'ru' ? 'Russian' : language === 'be' ? 'Belarusian' : 'English'
  const instructions: Record<AiWriteAction, string> = {
    continue:  `Continue the following text naturally in ${lang}. Output only the continuation, no commentary.`,
    improve:   `Improve the following text — make it clearer, more engaging and well-written. Return only the improved version in ${lang}.`,
    summarize: `Summarize the following text concisely. Return only the summary in ${lang}.`,
    shorter:   `Make the following text shorter while keeping the key information. Return only the shortened version in ${lang}.`,
    longer:    `Expand the following text with more detail and depth. Return only the expanded version in ${lang}.`,
    translate: `Translate the following text to ${lang}. Return only the translation.`,
    explain:   `Explain clearly and concisely what the following term or fragment means, in ${lang}. If it's a term, definition or concept — give a short, plain-language explanation a non-expert can understand (2-4 sentences). Return only the explanation, no preamble.`,
  }
  return `${instructions[action]}\n\nText:\n${contextText}`
}

export function AiWritingPanel({ action, contextText, onInsert, onDiscard }: AiWritingPanelProps) {
  const { language } = useLanguageStore()
  const { currentWorkspaceId } = useWorkspaceStore()
  const t = useT()
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  const actionLabels: Record<AiWriteAction, string> = {
    continue:  t.editor.aiWrite.continue,
    improve:   t.editor.aiWrite.improve,
    summarize: t.editor.aiWrite.summarize,
    shorter:   t.editor.aiWrite.shorter,
    longer:    t.editor.aiWrite.longer,
    translate: t.editor.aiWrite.translate,
    explain:   t.editor.aiWrite.explain,
  }

  const run = () => {
    setOutput('')
    setError('')
    setLoading(true)
    const abort = new AbortController()
    abortRef.current = abort

    const prompt = buildPrompt(action, language, contextText)
    aiApi.streamChat(
      [{ role: 'user', content: prompt }],
      { workspaceId: currentWorkspaceId ?? undefined, userLanguage: language as 'ru' | 'en' | 'be' },
      (event) => {
        if (event.type === 'text' && event.text) {
          setOutput((prev) => prev + event.text)
        }
        if (event.type === 'done') {
          setLoading(false)
        }
      },
      abort.signal,
    ).catch((err) => {
      if (err?.name === 'AbortError') return
      setError(t.editor.aiWrite.error)
      setLoading(false)
    })
  }

  useEffect(() => {
    run()
    return () => abortRef.current?.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-overlay)' }}>
      <div
        className="w-full max-w-xl mx-4 rounded-2xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-fade-in"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/60">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)' }}
          >
            <Sparkles size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">{actionLabels[action]}</p>
            <p className="text-xs text-slate-500 truncate">{t.editor.aiWrite.basedOn}: «{contextText.slice(0, 60)}{contextText.length > 60 ? '…' : ''}»</p>
          </div>
          <button onClick={onDiscard} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Output */}
        <div
          ref={outputRef}
          className="px-5 py-4 min-h-32 max-h-80 overflow-y-auto text-sm text-slate-200 leading-relaxed whitespace-pre-wrap"
        >
          {loading && !output && (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 size={14} className="animate-spin" />
              <span>{t.editor.aiWrite.generating}</span>
            </div>
          )}
          {output}
          {loading && output && (
            <span className="inline-block w-0.5 h-4 bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
          {error && <p className="text-red-400">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-700/60">
          <button
            onClick={() => run()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={12} />
            {t.editor.aiWrite.retry}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onDiscard} className="btn-ghost text-xs px-3 py-1.5">
              <X size={13} className="mr-1" />
              {t.editor.aiWrite.discard}
            </button>
            <button
              onClick={() => output && onInsert(output)}
              disabled={!output || loading}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
            >
              <Check size={13} className="mr-1" />
              {t.editor.aiWrite.insert}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

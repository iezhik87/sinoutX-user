import { useState, useRef, useCallback } from 'react'
import { Search, RefreshCw, X, ExternalLink, Globe, ChevronRight } from 'lucide-react'
import { useT } from '@/i18n/useT'

const SEARCH_BASE = '/search'

export function BrowserPage() {
  const t = useT()
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState(SEARCH_BASE)
  const [loading, setLoading] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function navigate(target: string) {
    setUrl(target)
    setLoading(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    navigate(`${SEARCH_BASE}?q=${encodeURIComponent(query.trim())}`)
  }

  const onLoad = useCallback(() => setLoading(false), [])

  function refresh() {
    setLoading(true)
    if (iframeRef.current) {
      // eslint-disable-next-line no-self-assign
      iframeRef.current.src = iframeRef.current.src
    }
  }

  const displayUrl = url === SEARCH_BASE ? '' : url

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-app)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sidebar)' }}
      >
        <Globe size={15} className="text-slate-500 flex-shrink-0" />

        {/* Search / URL bar */}
        <form onSubmit={submit} className="flex-1 flex items-center gap-1">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.common.searchOrAddress}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm transition-colors"
          >
            <Search size={13} />
          </button>
        </form>

        {/* Controls */}
        <button
          onClick={refresh}
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-md hover:bg-slate-800"
          title={t.common.refresh}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-md hover:bg-slate-800"
          title={t.common.openInNewTab}
        >
          <ExternalLink size={14} />
        </a>

        {/* Current URL hint */}
        {displayUrl && (
          <div className="hidden lg:flex items-center gap-1 text-xs text-slate-600 max-w-xs overflow-hidden">
            <ChevronRight size={11} />
            <span className="truncate">{displayUrl}</span>
          </div>
        )}
      </div>

      {/* iframe */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-500">{t.common.loading}</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={onLoad}
          title="Браузер"
          className="w-full h-full border-0"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { X, Download, Loader2, AlertCircle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { attachmentContentUrl, type Attachment } from '@/api/client'
import { useT } from '@/i18n'

interface FileViewerProps {
  file: Attachment
  onClose: () => void
}

/** Прокси-URL через бэкенд (решает CORS с MinIO) + токен для авторизации по URL */
function proxyUrl(id: string) {
  return attachmentContentUrl(id)
}

export function FileViewer({ file, onClose }: FileViewerProps) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-surface-900 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0">
            <X size={16} />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{file.filename}</p>
            <p className="text-xs text-slate-500">{file.mimeType} · {formatBytes(file.size)}</p>
          </div>
        </div>
        <a
          href={proxyUrl(file.id)}
          download={file.filename}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex-shrink-0"
        >
          <Download size={13} /> {t.fileViewer.download}
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ViewerContent file={file} />
      </div>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── Router ───────────────────────────────────────────────────────────────────

function ViewerContent({ file }: { file: Attachment }) {
  const mime = file.mimeType
  const src = proxyUrl(file.id)

  if (mime === 'application/pdf') return <PdfViewer url={src} />

  if (mime.startsWith('image/')) return <ImageViewer url={src} name={file.filename} />

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    file.filename.endsWith('.docx') || file.filename.endsWith('.doc')
  ) return <DocxViewer url={src} />

  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    file.filename.endsWith('.xlsx') || file.filename.endsWith('.xls') || file.filename.endsWith('.csv')
  ) return <XlsxViewer url={src} mimeType={mime} />

  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mime === 'application/vnd.ms-powerpoint' ||
    file.filename.endsWith('.pptx') || file.filename.endsWith('.ppt')
  ) return <PptxViewer url={src} />

  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('typescript'))
    return <TextViewer url={src} mimeType={mime} />

  if (mime.startsWith('video/')) return <VideoViewer url={src} />
  if (mime.startsWith('audio/')) return <AudioViewer url={src} />

  return <UnsupportedViewer filename={file.filename} url={src} />
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

function PdfViewer({ url }: { url: string }) {
  return (
    <iframe
      src={url}
      className="w-full h-full border-0"
      title="PDF viewer"
    />
  )
}

// ─── Image ────────────────────────────────────────────────────────────────────

function ImageViewer({ url, name }: { url: string; name: string }) {
  const t = useT()
  const [zoom, setZoom] = useState(1)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-center gap-2 py-2 border-b border-slate-800 bg-surface-900">
        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-1.5 text-slate-400 hover:text-slate-200 rounded">
          <ZoomOut size={14} />
        </button>
        <span className="text-xs text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="p-1.5 text-slate-400 hover:text-slate-200 rounded">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setZoom(1)} className="text-xs text-slate-500 hover:text-slate-300 ml-1">1:1</button>
        <button onClick={() => setZoom(0)} className="text-xs text-slate-500 hover:text-slate-300">{t.fileViewer.fitWidth}</button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center bg-slate-950 p-4">
        <img
          src={url}
          alt={name}
          style={zoom > 0 ? { transform: `scale(${zoom})`, transformOrigin: 'center', maxWidth: 'none' } : { maxWidth: '100%', maxHeight: '100%' }}
          className="rounded shadow-lg"
        />
      </div>
    </div>
  )
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

function DocxViewer({ url }: { url: string }) {
  const t = useT()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        // Dynamic import of mammoth
        const mammoth = await import('mammoth')
        const result = await mammoth.convertToHtml({ arrayBuffer: buf }, {
          styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "p[style-name='Heading 3'] => h3",
          ],
        })
        if (!cancelled) setHtml(result.value)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url])

  if (loading) return <LoadingState text={t.fileViewer.loadingDoc} />
  if (error) return <ErrorState error={error} />

  return (
    <div className="h-full overflow-auto bg-white">
      <div
        className="max-w-3xl mx-auto py-12 px-16 text-gray-900"
        style={{ fontFamily: 'Georgia, serif', lineHeight: 1.7, fontSize: '15px' }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html ?? '') }}
      />
    </div>
  )
}

// ─── XLSX / CSV ───────────────────────────────────────────────────────────────

interface SheetData {
  name: string
  headers: string[]
  rows: (string | number | boolean | null)[][]
}

function XlsxViewer({ url, mimeType }: { url: string; mimeType: string }) {
  const t = useT()
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(url)
        const buf = await res.arrayBuffer()

        let parsed: SheetData[]
        if (mimeType === 'text/csv' || url.endsWith('.csv')) {
          const text = new TextDecoder('utf-8').decode(buf)
          const allRows = text.split('\n').filter(Boolean).map((l) =>
            l.split(',').map((c) => c.trim().replace(/^"|"$/g, '') as string | number | boolean | null)
          )
          const headers = (allRows[0] ?? []).map(String)
          parsed = [{ name: 'Sheet1', headers, rows: allRows.slice(1) }]
        } else {
          const ExcelJS = await import('exceljs')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(buf)
          parsed = workbook.worksheets.map((ws) => {
            const allRows: (string | number | boolean | null)[][] = []
            ws.eachRow((row) => {
              const cells = (row.values as unknown[]).slice(1)
              allRows.push(cells.map((c) => {
                if (c === null || c === undefined) return null
                if (typeof c === 'object' && 'text' in (c as object)) return String((c as { text: unknown }).text)
                if (typeof c === 'object' && 'result' in (c as object)) return (c as { result: string | number | boolean | null }).result
                return c as string | number | boolean
              }))
            })
            const headers = (allRows[0] ?? []).map(String)
            return { name: ws.name, headers, rows: allRows.slice(1) }
          })
        }

        if (!cancelled) {
          setSheets(parsed)
          setActiveSheet(0)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url, mimeType])

  if (loading) return <LoadingState text={t.fileViewer.loadingSheet} />
  if (error) return <ErrorState error={error} />
  if (!sheets.length) return <ErrorState error={t.fileViewer.noData} />

  const sheet = sheets[activeSheet]

  return (
    <div className="flex flex-col h-full">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-1 px-4 py-2 border-b border-slate-800 bg-surface-900 overflow-x-auto flex-shrink-0">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={cn(
                'px-3 py-1 text-xs rounded whitespace-nowrap transition-colors',
                i === activeSheet ? 'bg-primary-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-900 z-10">
            <tr>
              <th className="w-10 px-2 py-2 text-right text-slate-600 border-b border-r border-slate-800 font-normal">#</th>
              {sheet.headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-slate-300 font-semibold border-b border-r border-slate-800 whitespace-nowrap">
                  {h || <span className="text-slate-600">{String.fromCharCode(65 + i)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-slate-900/50 group">
                <td className="px-2 py-1.5 text-right text-slate-600 border-b border-r border-slate-800/50 select-none">{ri + 1}</td>
                {sheet.headers.map((_, ci) => {
                  const val = row[ci]
                  const isNum = typeof val === 'number'
                  return (
                    <td
                      key={ci}
                      className={cn(
                        'px-3 py-1.5 border-b border-r border-slate-800/50 whitespace-nowrap max-w-[300px] truncate',
                        isNum ? 'text-right text-emerald-400 font-mono' : 'text-slate-300',
                      )}
                      title={val !== null ? String(val) : ''}
                    >
                      {val !== null && val !== undefined ? String(val) : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="py-3 text-center text-xs text-slate-600">
          {sheet.rows.length} {t.fileViewer.rows} · {sheet.headers.length} {t.fileViewer.cols}
        </div>
      </div>
    </div>
  )
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────

function PptxViewer({ url }: { url: string }) {
  const t = useT()
  const [slides, setSlides] = useState<string[]>([])
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        // PPTX — это ZIP. Используем JSZip через динамический импорт
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(buf)

        const slideFiles = Object.keys(zip.files)
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)?.[0] ?? '0')
            const nb = parseInt(b.match(/\d+/)?.[0] ?? '0')
            return na - nb
          })

        const parsed: string[] = []
        for (const f of slideFiles) {
          const xml = await zip.files[f].async('string')
          // Извлекаем текстовые узлы <a:t>
          const texts: string[] = []
          const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
          let m: RegExpExecArray | null
          while ((m = re.exec(xml)) !== null) {
            const t = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            if (t.trim()) texts.push(t.trim())
          }
          parsed.push(texts.join('\n'))
        }
        if (!cancelled) { setSlides(parsed); setLoading(false) }
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [url])

  if (loading) return <LoadingState text={t.fileViewer.loadingPresentation} />

  if (error || slides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-6xl">📊</div>
        <p className="text-slate-400">{t.fileViewer.pptLimited}</p>
        <p className="text-slate-600 text-sm">{t.fileViewer.downloadForFull}</p>
      </div>
    )
  }

  const slide = slides[current]
  return (
    <div className="flex flex-col h-full">
      {/* Slide counter */}
      <div className="flex items-center justify-center gap-4 py-2 border-b border-slate-800 bg-surface-900 flex-shrink-0">
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs text-slate-400">
          {t.fileViewer.slide} {current + 1} {t.fileViewer.of} {slides.length}
        </span>
        <button
          onClick={() => setCurrent(c => Math.min(slides.length - 1, c + 1))}
          disabled={current === slides.length - 1}
          className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Slide content */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-8">
        <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl p-12 min-h-[400px]">
          <pre className="whitespace-pre-wrap text-gray-800 font-sans text-base leading-relaxed">
            {slide || <span className="text-gray-400 italic">{t.fileViewer.emptySlide}</span>}
          </pre>
        </div>
      </div>

      {/* Thumbnails */}
      <div className="flex gap-2 px-4 py-2 border-t border-slate-800 bg-surface-900 overflow-x-auto flex-shrink-0">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={cn(
              'flex-shrink-0 w-16 h-10 rounded border text-xs transition-colors',
              i === current ? 'border-primary-500 bg-primary-500/10 text-primary-400' : 'border-slate-700 text-slate-500 hover:border-slate-600',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Text / Code ──────────────────────────────────────────────────────────────

function TextViewer({ url, mimeType }: { url: string; mimeType: string }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then(r => r.text())
      .then(t => { if (!cancelled) setText(t) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [url])

  if (loading) return <LoadingState text={t.fileViewer.loadingFile} />
  if (error) return <ErrorState error={error} />

  const isJson = mimeType.includes('json')
  let display = text ?? ''
  if (isJson) {
    try { display = JSON.stringify(JSON.parse(display), null, 2) } catch { /* keep as is */ }
  }

  return (
    <div className="h-full overflow-auto bg-surface-950 p-6">
      <pre className="text-sm text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-words">
        {display}
      </pre>
    </div>
  )
}

// ─── Video ────────────────────────────────────────────────────────────────────

function VideoViewer({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-black p-4">
      <video src={url} controls className="max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  )
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function AudioViewer({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <audio src={url} controls className="w-full max-w-lg" />
    </div>
  )
}

// ─── Unsupported ──────────────────────────────────────────────────────────────

function UnsupportedViewer({ filename, url }: { filename: string; url: string }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="text-6xl">📎</div>
      <p className="text-slate-400 text-sm">{t.fileViewer.previewUnavailable}</p>
      <a
        href={url}
        download={filename}
        className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm transition-colors"
      >
        <Download size={14} /> {t.fileViewer.downloadFile}
      </a>
    </div>
  )
}

// ─── Shared states ────────────────────────────────────────────────────────────

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Loader2 size={28} className="animate-spin text-primary-500" />
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  )
}

function ErrorState({ error }: { error: string }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <AlertCircle size={28} className="text-red-400" />
      <p className="text-sm text-slate-400">{t.fileViewer.loadError}</p>
      <p className="text-xs text-slate-600 max-w-md text-center">{error}</p>
    </div>
  )
}

// ─── Simple HTML sanitizer (убираем script/style) ─────────────────────────────

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
}

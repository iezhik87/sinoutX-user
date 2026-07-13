import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Edit2, Check, Trash2, X, HelpCircle, GripHorizontal, AlertCircle, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

type L = (en: string, ru: string, be: string) => string

// ─── SVG sanitizer ────────────────────────────────────────────────────────────

function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/href\s*=\s*["'](?!#)[^"']*["']/gi, '')
    .trim()
}

function wrapSvg(code: string): string {
  const clean = sanitizeSvg(code)
  if (!clean) return ''
  if (/^\s*<svg/i.test(clean)) return clean
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">${clean}</svg>`
}

// ─── Examples (light palette) ─────────────────────────────────────────────────

const buildExamples = (L: L) => [
  {
    title: L('Functional diagram', 'Функциональная схема', 'Функцыянальная схема'),
    code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 140" width="620" height="140">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#374151"/>
    </marker>
  </defs>
  <rect width="620" height="140" fill="#f8fafc"/>
  <!-- Blocks -->
  <rect x="20" y="50" width="140" height="44" rx="6" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>
  <text x="90" y="77" text-anchor="middle" fill="#1e3a8a" font-size="14" font-family="sans-serif" font-weight="600">Вход</text>
  <rect x="240" y="50" width="140" height="44" rx="6" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>
  <text x="310" y="77" text-anchor="middle" fill="#1e3a8a" font-size="14" font-family="sans-serif" font-weight="600">Обработка</text>
  <rect x="460" y="50" width="140" height="44" rx="6" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>
  <text x="530" y="77" text-anchor="middle" fill="#1e3a8a" font-size="14" font-family="sans-serif" font-weight="600">Выход</text>
  <!-- Arrows -->
  <line x1="160" y1="72" x2="238" y2="72" stroke="#374151" stroke-width="1.5" marker-end="url(#arrow)"/>
  <line x1="380" y1="72" x2="458" y2="72" stroke="#374151" stroke-width="1.5" marker-end="url(#arrow)"/>
</svg>`,
  },
  {
    title: L('Circuit diagram', 'Электрическая схема', 'Электрычная схема'),
    code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 200" width="520" height="200">
  <rect width="520" height="200" fill="#f8fafc"/>
  <style>
    .wire { stroke: #374151; stroke-width: 2; fill: none; }
    .lbl  { fill: #111827; font-size: 12px; font-family: sans-serif; }
    .comp { stroke: #1d4ed8; stroke-width: 1.5; fill: none; }
    .dot  { fill: #374151; }
  </style>
  <!-- Power rails -->
  <line class="wire" x1="40" y1="40" x2="480" y2="40"/>
  <text class="lbl" x="10" y="45" font-weight="bold" fill="#dc2626">+V</text>
  <line class="wire" x1="40" y1="160" x2="480" y2="160"/>
  <text class="lbl" x="14" y="165" fill="#374151">GND</text>
  <!-- Left vertical -->
  <line class="wire" x1="80" y1="40" x2="80" y2="160"/>
  <!-- Resistor R1 -->
  <line class="wire" x1="150" y1="40" x2="170" y2="40"/>
  <rect class="comp" x="170" y="28" width="80" height="24" rx="2" fill="#eff6ff"/>
  <text class="lbl" x="210" y="43" text-anchor="middle">R1  10kΩ</text>
  <line class="wire" x1="250" y1="40" x2="270" y2="40"/>
  <!-- Capacitor C1 -->
  <line class="wire" x1="320" y1="40" x2="320" y2="88"/>
  <line class="comp" x1="298" y1="88" x2="342" y2="88"/>
  <line class="comp" x1="298" y1="98" x2="342" y2="98"/>
  <line class="wire" x1="320" y1="98" x2="320" y2="160"/>
  <text class="lbl" x="350" y="96">C1  100нФ</text>
  <!-- Right vertical -->
  <line class="wire" x1="420" y1="40" x2="420" y2="160"/>
  <!-- Nodes -->
  <circle class="dot" cx="80" cy="40" r="4"/>
  <circle class="dot" cx="80" cy="160" r="4"/>
  <circle class="dot" cx="420" cy="40" r="4"/>
</svg>`,
  },
  {
    title: L('Algorithm (flowchart)', 'Алгоритм (блок-схема)', 'Алгарытм (блок-схема)'),
    code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 460" width="280" height="460">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#374151"/>
    </marker>
  </defs>
  <rect width="280" height="460" fill="#f8fafc"/>
  <style>
    .box     { fill: #dbeafe; stroke: #2563eb; stroke-width: 1.5; }
    .diamond { fill: #fef9c3; stroke: #ca8a04; stroke-width: 1.5; }
    .oval    { fill: #dcfce7; stroke: #16a34a; stroke-width: 1.5; }
    .txt     { fill: #1e293b; font-size: 12px; font-family: sans-serif; text-anchor: middle; dominant-baseline: middle; }
    .small   { fill: #374151; font-size: 11px; font-family: sans-serif; text-anchor: middle; }
    .wire    { stroke: #374151; stroke-width: 1.5; fill: none; marker-end: url(#arr); }
    .wireno  { stroke: #374151; stroke-width: 1.5; fill: none; }
  </style>
  <ellipse cx="140" cy="34" rx="70" ry="24" class="oval"/>
  <text class="txt" x="140" y="34">Начало</text>
  <line class="wire" x1="140" y1="58" x2="140" y2="84"/>
  <rect x="65" y="86" width="150" height="42" rx="6" class="box"/>
  <text class="txt" x="140" y="107">Ввод данных</text>
  <line class="wire" x1="140" y1="128" x2="140" y2="154"/>
  <polygon points="140,156 220,194 140,232 60,194" class="diamond"/>
  <text class="txt" x="140" y="194">Условие?</text>
  <line class="wire" x1="140" y1="232" x2="140" y2="258"/>
  <text class="small" x="155" y="248">Да</text>
  <rect x="65" y="260" width="150" height="42" rx="6" class="box"/>
  <text class="txt" x="140" y="281">Обработка</text>
  <line class="wire" x1="140" y1="302" x2="140" y2="328"/>
  <rect x="65" y="330" width="150" height="42" rx="6" class="box"/>
  <text class="txt" x="140" y="351">Вывод результата</text>
  <line class="wire" x1="140" y1="372" x2="140" y2="398"/>
  <ellipse cx="140" cy="422" rx="70" ry="24" class="oval"/>
  <text class="txt" x="140" y="422">Конец</text>
  <!-- No branch -->
  <line class="wireno" x1="220" y1="194" x2="250" y2="194"/>
  <line class="wireno" x1="250" y1="194" x2="250" y2="351"/>
  <line class="wire"   x1="250" y1="351" x2="217" y2="351"/>
  <text class="small" x="240" y="187">Нет</text>
</svg>`,
  },
  {
    title: L('Pneumatic / hydraulic diagram', 'Пневматическая / гидравлическая схема', 'Пнеўматычная / гідраўлічная схема'),
    code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 220" width="580" height="220">
  <rect width="580" height="220" fill="#f8fafc"/>
  <style>
    .pipe { stroke: #2563eb; stroke-width: 2; fill: none; }
    .comp { stroke: #1d4ed8; stroke-width: 1.5; fill: #eff6ff; }
    .lbl  { fill: #1e293b; font-size: 11px; font-family: sans-serif; text-anchor: middle; }
  </style>
  <!-- Compressor -->
  <circle class="comp" cx="65" cy="110" r="34"/>
  <text class="lbl" x="65" y="108">Комп-</text>
  <text class="lbl" x="65" y="121">рессор</text>
  <text class="lbl" x="65" y="165">P1</text>
  <!-- Pipe -->
  <line class="pipe" x1="99" y1="110" x2="165" y2="110"/>
  <!-- Filter -->
  <rect class="comp" x="165" y="86" width="52" height="48" rx="4"/>
  <line class="pipe" x1="170" y1="96" x2="212" y2="120"/>
  <line class="pipe" x1="170" y1="120" x2="212" y2="96"/>
  <text class="lbl" x="191" y="155">Фильтр</text>
  <!-- Pipe -->
  <line class="pipe" x1="217" y1="110" x2="285" y2="110"/>
  <!-- Valve -->
  <rect class="comp" x="285" y="86" width="90" height="48" rx="4"/>
  <text class="lbl" x="330" y="107">Клапан</text>
  <text class="lbl" x="330" y="121">5/2</text>
  <text class="lbl" x="330" y="155">Распределитель</text>
  <!-- Outputs -->
  <line class="pipe" x1="375" y1="100" x2="440" y2="72"/>
  <line class="pipe" x1="375" y1="120" x2="440" y2="148"/>
  <!-- Cylinder body -->
  <rect class="comp" x="440" y="58" width="100" height="104" rx="4"/>
  <!-- Piston -->
  <rect x="456" y="64" width="10" height="92" rx="2" fill="#bfdbfe" stroke="#2563eb" stroke-width="1"/>
  <text class="lbl" x="490" y="185">Цилиндр</text>
  <!-- Rod -->
  <line class="pipe" x1="540" y1="110" x2="565" y2="110"/>
  <line x1="560" y1="100" x2="575" y2="110" stroke="#1d4ed8" stroke-width="2"/>
  <line x1="560" y1="120" x2="575" y2="110" stroke="#1d4ed8" stroke-width="2"/>
</svg>`,
  },
  {
    title: L('System block diagram', 'Структурная схема системы', 'Структурная схема сістэмы'),
    code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300">
  <defs>
    <marker id="a" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#374151"/>
    </marker>
  </defs>
  <rect width="600" height="300" fill="#f8fafc"/>
  <style>
    .bus  { fill: #e2e8f0; stroke: #94a3b8; stroke-width: 1; }
    .cpu  { fill: #dbeafe; stroke: #2563eb; stroke-width: 2; }
    .blk  { fill: #f1f5f9; stroke: #64748b; stroke-width: 1.5; }
    .txt  { fill: #1e293b; font-size: 12px; font-family: sans-serif; text-anchor: middle; dominant-baseline: middle; }
    .sub  { fill: #64748b; font-size: 10px; font-family: sans-serif; text-anchor: middle; }
    .w    { stroke: #374151; stroke-width: 1.5; fill: none; marker-end: url(#a); }
    .wn   { stroke: #374151; stroke-width: 1.5; fill: none; }
  </style>
  <!-- CPU -->
  <rect x="220" y="120" width="160" height="60" rx="8" class="cpu"/>
  <text class="txt" x="300" y="147" font-weight="600" fill="#1e3a8a">Процессор</text>
  <text class="sub" x="300" y="162">CPU</text>
  <!-- Left bus -->
  <rect x="170" y="30" width="18" height="240" rx="3" class="bus"/>
  <text class="sub" x="179" y="282">Шина данных</text>
  <!-- Right bus -->
  <rect x="412" y="30" width="18" height="240" rx="3" class="bus"/>
  <text class="sub" x="421" y="282">Шина I/O</text>
  <!-- Left blocks -->
  <rect x="20" y="36" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="85" y="59">ОЗУ  4 ГБ</text>
  <rect x="20" y="127" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="85" y="150">ПЗУ  Flash</text>
  <rect x="20" y="218" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="85" y="241">DMA</text>
  <!-- Right blocks -->
  <rect x="450" y="36" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="515" y="59">UART / SPI</text>
  <rect x="450" y="127" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="515" y="150">GPIO</text>
  <rect x="450" y="218" width="130" height="46" rx="6" class="blk"/>
  <text class="txt" x="515" y="241">ADC / DAC</text>
  <!-- Connections left -->
  <line class="wn" x1="150" y1="59"  x2="170" y2="59"/>
  <line class="wn" x1="150" y1="150" x2="170" y2="150"/>
  <line class="wn" x1="150" y1="241" x2="170" y2="241"/>
  <line class="w"  x1="220" y1="150" x2="190" y2="150"/>
  <!-- Connections right -->
  <line class="w"  x1="380" y1="150" x2="410" y2="150"/>
  <line class="wn" x1="430" y1="59"  x2="450" y2="59"/>
  <line class="wn" x1="430" y1="150" x2="450" y2="150"/>
  <line class="wn" x1="430" y1="241" x2="450" y2="241"/>
</svg>`,
  },
]

// ─── Help modal ────────────────────────────────────────────────────────────────

function HelpModal({ onClose, onInsert }: { onClose: () => void; onInsert: (code: string) => void }) {
  const t = useT()
  const { language } = useLanguageStore()
  const L: L = (en, ru, be) => (language === 'en' ? en : language === 'be' ? be : ru)
  const EXAMPLES = buildExamples(L)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-100">{t.editorHelp.svgTemplates}</p>
            <p className="text-xs text-slate-500">{t.editorHelp.techDiagrams}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {EXAMPLES.map((ex) => (
            <div key={ex.title} className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60">
                <span className="text-xs font-medium text-slate-400">{ex.title}</span>
                <button
                  onClick={() => { onInsert(ex.code); onClose() }}
                  className="text-xs text-teal-400 hover:text-teal-300 transition-colors px-2 py-0.5 rounded hover:bg-teal-400/10"
                >
                  {t.editorHelp.insert}
                </button>
              </div>
              <div
                className="bg-white p-3 overflow-auto"
                style={{ maxHeight: 200 }}
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(ex.code) }}
              />
            </div>
          ))}
          <div className="rounded-lg border border-slate-800 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t.editorHelp.tips}</p>
            <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
              <li>{L('First element', 'Первый элемент', 'Першы элемент')} — <code className="text-teal-400">&lt;rect width="..." height="..." fill="#f8fafc"/&gt;</code> — {L('white background', 'белый фон', 'белы фон')}</li>
              <li>{L('Colors', 'Цвета', 'Колеры')}: {L('block fill', 'фон блоков', 'фон блокаў')} <code className="text-teal-400">#dbeafe</code>, {L('border', 'рамка', 'рамка')} <code className="text-teal-400">#2563eb</code>, {L('text', 'текст', 'тэкст')} <code className="text-teal-400">#1e293b</code></li>
              <li>{L('Arrows via', 'Стрелки через', 'Стрэлкі праз')} <code className="text-teal-400">&lt;defs&gt;&lt;marker&gt;</code></li>
              <li>{L('Always set', 'Всегда указывай', 'Заўсёды ўказвай')} <code className="text-teal-400">viewBox</code> {L('and', 'и', 'і')} <code className="text-teal-400">xmlns</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function SvgBlockView({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { code: string; height: number } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}) {
  const t = useT()
  const { language } = useLanguageStore()
  const L: L = (en, ru, be) => (language === 'en' ? en : language === 'be' ? be : ru)
  const EXAMPLES = buildExamples(L)
  const [editing, setEditing] = useState(!node.attrs.code)
  const [draft, setDraft] = useState(node.attrs.code || EXAMPLES[0].code)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const height = node.attrs.height ?? 300
  const resizeStartY = useRef<number | null>(null)
  const resizeStartH = useRef<number>(height)

  // Zoom & pan state
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoomFocused, setZoomFocused] = useState(false)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOffset = useRef({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)

  const renderedSvg = node.attrs.code ? wrapSvg(node.attrs.code) : ''

  // Reset zoom when SVG code changes
  useEffect(() => { setScale(1); setOffset({ x: 0, y: 0 }) }, [node.attrs.code])

  const validate = useCallback((code: string) => {
    if (!code.trim()) { setError(''); return }
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(wrapSvg(code), 'image/svg+xml')
      const parseErr = doc.querySelector('parsererror')
      setError(parseErr ? t.editorHelp.svgXmlError + ': ' + (parseErr.textContent?.split('\n')[0] ?? t.editorHelp.svgInvalidSyntax) : '')
    } catch {
      setError(t.editorHelp.svgParseError)
    }
  }, [])

  useEffect(() => { validate(draft) }, [draft, validate])

  function applyEdit() {
    if (error) return
    updateAttributes({ code: draft })
    setEditing(false)
  }

  function cancelEdit() {
    setDraft(node.attrs.code || EXAMPLES[0].code)
    setEditing(false)
    setError('')
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    resizeStartY.current = e.clientY
    resizeStartH.current = height
    const onMove = (ev: MouseEvent) => {
      if (resizeStartY.current === null) return
      updateAttributes({ height: Math.max(100, resizeStartH.current + (ev.clientY - resizeStartY.current)) })
    }
    const onUp = () => {
      resizeStartY.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <NodeViewWrapper className="my-4 rounded-xl overflow-hidden border border-slate-700 select-none">
      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(false)}
          onInsert={(code) => { setDraft(code); setEditing(true) }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono font-medium">svg</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); setHelpOpen(true) }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-teal-400 transition-colors"
          >
            <HelpCircle size={12} /> {t.editorHelp.templates}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
            className="p-1 text-slate-600 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
          {editing ? (
            <>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelEdit() }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-0.5"
              >
                {t.editorHelp.cancel}
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); applyEdit() }}
                disabled={!!error}
                className={cn(
                  'flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors',
                  error ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-primary-600 text-white hover:bg-primary-500',
                )}
              >
                <Check size={11} /> {t.editorHelp.apply}
              </button>
            </>
          ) : (
            <button
              onMouseDown={(e) => { e.preventDefault(); setEditing(true) }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Edit2 size={11} /> {t.editorHelp.edit}
            </button>
          )}
        </div>
      </div>

      {/* Code editor */}
      {editing && (
        <div className="border-b border-slate-700/50">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(8, draft.split('\n').length + 1)}
            spellCheck={false}
            placeholder={t.editorHelp.svgPlaceholder}
            className="w-full bg-slate-900 text-slate-200 font-mono text-xs px-4 py-3 resize-y focus:outline-none"
            style={{ minHeight: 120 }}
          />
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-950/40 border-t border-red-900/40">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-400 font-mono">{error}</span>
            </div>
          )}
        </div>
      )}

      {/* SVG preview — zoomable */}
      <div
        className="relative bg-white"
        style={{
          height: `${height}px`,
          outline: zoomFocused ? '2px solid #6366f1' : '2px solid transparent',
          outlineOffset: '-2px',
          transition: 'outline-color 0.15s',
        }}
      >
        {/* Zoom controls */}
        {renderedSvg && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/90 border border-slate-200 rounded-lg shadow-sm px-1 py-0.5">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setScale((s) => Math.min(s * 1.25, 8))}
              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title={t.editorHelp.zoomIn}
            >
              <ZoomIn size={14} />
            </button>
            <span className="text-xs text-slate-400 w-10 text-center select-none">
              {Math.round(scale * 100)}%
            </span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setScale((s) => Math.max(s / 1.25, 0.1))}
              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title={t.editorHelp.zoomOut}
            >
              <ZoomOut size={14} />
            </button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}
              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title={t.editorHelp.resetZoom}
            >
              <Maximize2 size={14} />
            </button>
          </div>
        )}

        {/* Click-to-zoom hint */}
        {renderedSvg && !zoomFocused && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <span className="text-[10px] text-slate-400 bg-white/80 border border-slate-200 rounded px-2 py-0.5 shadow-sm">
              {t.editorHelp.zoomHint}
            </span>
          </div>
        )}

        {/* Viewport */}
        <div
          ref={viewportRef}
          className="w-full h-full overflow-hidden"
          style={{ cursor: renderedSvg ? (isPanning.current ? 'grabbing' : (zoomFocused ? 'grab' : 'default')) : 'default' }}
          onClick={() => { if (renderedSvg) setZoomFocused(true) }}
          onWheel={(e) => {
            if (!renderedSvg || !zoomFocused) return
            e.preventDefault()
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
            setScale((s) => Math.min(Math.max(s * factor, 0.1), 8))
          }}
          onMouseDown={(e) => {
            if (!renderedSvg || e.button !== 0) return
            isPanning.current = true
            panStart.current = { x: e.clientX, y: e.clientY }
            panOffset.current = { ...offset }
            e.currentTarget.style.cursor = 'grabbing'
          }}
          onMouseMove={(e) => {
            if (!isPanning.current) return
            setOffset({
              x: panOffset.current.x + (e.clientX - panStart.current.x),
              y: panOffset.current.y + (e.clientY - panStart.current.y),
            })
          }}
          onMouseUp={(e) => {
            isPanning.current = false
            e.currentTarget.style.cursor = zoomFocused ? 'grab' : 'default'
          }}
          onMouseLeave={(e) => {
            isPanning.current = false
            e.currentTarget.style.cursor = 'default'
            setZoomFocused(false)
          }}
        >
          {renderedSvg ? (
            <div
              style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(${offset.y}px)) scale(${scale})`,
                transformOrigin: 'top center',
                position: 'absolute',
                left: '50%',
                top: '16px',
                transition: isPanning.current ? 'none' : 'transform 0.05s',
              }}
              dangerouslySetInnerHTML={{ __html: renderedSvg }}
              className="[&_svg]:max-w-none [&_svg]:h-auto"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <span className="text-xs">{t.editorHelp.svgEmptyHint}</span>
            </div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="flex items-center justify-center h-3 bg-slate-800/60 hover:bg-slate-700/80 cursor-row-resize transition-colors border-t border-slate-800 group"
      >
        <GripHorizontal size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
      </div>
    </NodeViewWrapper>
  )
}

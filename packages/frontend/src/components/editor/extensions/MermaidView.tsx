import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Edit2, Check, AlertCircle, Trash2, HelpCircle, X, GripHorizontal, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

let mermaidInitialized = false

function cleanMermaidError(raw: unknown, fallback: string): string {
  const msg = raw instanceof Error ? raw.message : String(raw)
  const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean)
  const meaningful = lines.filter(
    (l) => !/^mermaid version/i.test(l) && !/^syntax error in text$/i.test(l),
  )
  if (meaningful.length > 0) return meaningful.join(' · ')
  return lines[0] ?? fallback
}

function sanitizeCode(code: string): string {
  return code
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

async function renderMermaid(code: string, emptyMsg: string, errFallback: string): Promise<{ svg: string; error?: never } | { svg?: never; error: string }> {
  try {
    const m = (await import('mermaid')).default
    if (!mermaidInitialized) {
      m.initialize({ startOnLoad: false, theme: 'neutral', darkMode: false, securityLevel: 'loose' })
      mermaidInitialized = true
    }
    const clean = sanitizeCode(code)
    if (!clean) return { error: emptyMsg }
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`
    const { svg } = await m.render(id, clean)
    return { svg }
  } catch (e) {
    return { error: cleanMermaidError(e, errFallback) }
  }
}

// ─── Help modal ───────────────────────────────────────────────────────────────

type L = (en: string, ru: string, be: string) => string

const helpSections = (L: L) => [
  {
    title: L('Flowchart', 'Блок-схема', 'Блок-схема'),
    code: `flowchart TD
  A[Начало] --> B{Условие?}
  B -->|Да| C[Действие]
  B -->|Нет| D[Другое]
  C --> E[Конец]
  D --> E`,
  },
  {
    title: L('Branching', 'Разветвление', 'Разгалінаванне'),
    code: `flowchart TD
  A{Статус?}
  A -->|new| B[Подтвердить]
  A -->|paid| C[Доставить]
  A -->|done| D[Закрыть]`,
  },
  {
    title: L('Sequence', 'Последовательность', 'Паслядоўнасць'),
    code: `sequenceDiagram
  Клиент->>Сервер: Запрос
  Сервер->>БД: SQL
  БД-->>Сервер: Данные
  Сервер-->>Клиент: Ответ`,
  },
  {
    title: L('Classes', 'Классы', 'Класы'),
    code: `classDiagram
  class User {
    +String name
    +login()
  }
  class Order {
    +int id
    +create()
  }
  User --> Order`,
  },
  {
    title: 'Mindmap',
    code: `mindmap
  root((Проект))
    Фронтенд
      React
      TipTap
    Бэкенд
      Node.js
      Prisma`,
  },
  {
    title: L('Gantt', 'Гант', 'Гант'),
    code: `gantt
  title План
  section Разработка
  Дизайн   : 2024-01-01, 7d
  Вёрстка  : 7d
  Бэкенд   : 14d`,
  },
  {
    title: L('Pie chart', 'Круговая', 'Кругавая'),
    code: `pie title Распределение
  "Frontend" : 40
  "Backend"  : 35
  "DevOps"   : 25`,
  },
]

const arrowRows = (L: L) => [
  { code: '`A --> B`', desc: L('normal arrow', 'обычная стрелка', 'звычайная страла') },
  { code: '`A --- B`', desc: L('line, no arrow', 'линия без стрелки', 'лінія без стралы') },
  { code: '`A -.-> B`', desc: L('dashed', 'пунктирная', 'пункцірная') },
  { code: '`A ==> B`', desc: L('thick', 'жирная', 'тоўстая') },
  { code: '`A -->|текст| B`', desc: L('with label', 'с подписью', 'з подпісам') },
]

const shapeRows = (L: L) => [
  { code: '`A[текст]`', desc: L('rectangle', 'прямоугольник', 'прамавугольнік') },
  { code: '`A(текст)`', desc: L('rounded', 'скруглённый', 'скруглены') },
  { code: '`A{текст}`', desc: L('diamond — condition', 'ромб — условие', 'ромб — умова') },
  { code: '`A((текст))`', desc: L('circle', 'круг', 'круг') },
  { code: '`A[/текст/]`', desc: L('parallelogram', 'параллелограмм', 'паралелаграм') },
]

const dirRows = (L: L) => [
  { code: 'TD', desc: L('top to bottom', 'сверху вниз', 'зверху ўніз') },
  { code: 'LR', desc: L('left to right', 'слева направо', 'злева направа') },
  { code: 'BT', desc: L('bottom to top', 'снизу вверх', 'знізу ўверх') },
  { code: 'RL', desc: L('right to left', 'справа налево', 'справа налева') },
]

function HelpModal({ onClose, onInsert }: { onClose: () => void; onInsert: (code: string) => void }) {
  const t = useT()
  const { language } = useLanguageStore()
  const L: L = (en, ru, be) => (language === 'en' ? en : language === 'be' ? be : ru)
  const HELP_SECTIONS = helpSections(L)
  const ARROWS = arrowRows(L)
  const SHAPES = shapeRows(L)
  const DIRECTIONS = dirRows(L)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-100">{t.editorHelp.mermaidHelp}</p>
            <p className="text-xs text-slate-500">{t.editorHelp.diagramSyntax}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-6">

          {/* Examples */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.examples}</p>
            <div className="grid grid-cols-1 gap-3">
              {HELP_SECTIONS.map((s) => (
                <div key={s.title} className="rounded-lg border border-slate-800 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60">
                    <span className="text-xs font-medium text-slate-400">{s.title}</span>
                    <button
                      onClick={() => { onInsert(s.code); onClose() }}
                      className="text-xs text-teal-400 hover:text-teal-300 transition-colors px-2 py-0.5 rounded hover:bg-teal-400/10"
                    >
                      {t.editorHelp.insert}
                    </button>
                  </div>
                  <pre className="px-3 py-2.5 text-xs text-slate-300 font-mono leading-relaxed overflow-x-auto">{s.code}</pre>
                </div>
              ))}
            </div>
          </div>

          {/* Arrows */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.arrows}</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden divide-y divide-slate-800">
              {ARROWS.map((r) => (
                <div key={r.code} className="flex items-center gap-3 px-3 py-2">
                  <code className="text-xs text-teal-400 font-mono w-40 flex-shrink-0">{r.code.replace(/`/g, '')}</code>
                  <span className="text-xs text-slate-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Shapes */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.nodeShapes}</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden divide-y divide-slate-800">
              {SHAPES.map((r) => (
                <div key={r.code} className="flex items-center gap-3 px-3 py-2">
                  <code className="text-xs text-teal-400 font-mono w-40 flex-shrink-0">{r.code.replace(/`/g, '')}</code>
                  <span className="text-xs text-slate-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Directions */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.direction}</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden divide-y divide-slate-800">
              {DIRECTIONS.map((r) => (
                <div key={r.code} className="flex items-center gap-3 px-3 py-2">
                  <code className="text-xs text-teal-400 font-mono w-40 flex-shrink-0">flowchart {r.code}</code>
                  <span className="text-xs text-slate-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-600 text-center">{L('Full docs: mermaid.js.org', 'Полная документация: mermaid.js.org', 'Поўная дакументацыя: mermaid.js.org')}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MermaidBlockView({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { code: string; height: number } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
  selected: boolean
}) {
  const t = useT()
  const { language } = useLanguageStore()
  const L: L = (en, ru, be) => (language === 'en' ? en : language === 'be' ? be : ru)
  const DEFAULT_CODE = 'flowchart TD\n    A["Начало"] --> B["Конец"]'
  const [editing, setEditing] = useState(!node.attrs.code || node.attrs.code === DEFAULT_CODE || node.attrs.code === 'graph TD\n    A[Начало] --> B[Конец]')
  const [draft, setDraft] = useState(node.attrs.code || DEFAULT_CODE)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const height = node.attrs.height ?? 300
  const resizeStartY = useRef<number | null>(null)
  const resizeStartH = useRef<number>(height)

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoomFocused, setZoomFocused] = useState(false)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOffset = useRef({ x: 0, y: 0 })

  const render = useCallback(async (code: string) => {
    if (!code.trim()) return
    setRendering(true)
    const result = await renderMermaid(
      code,
      L('Empty diagram code', 'Пустой код диаграммы', 'Пусты код дыяграмы'),
      L('Diagram syntax error', 'Ошибка синтаксиса диаграммы', 'Памылка сінтаксісу дыяграмы'),
    )
    setRendering(false)
    if (result.error) {
      setError(result.error)
      setEditing(true)
    } else {
      setError('')
      setSvg(result.svg ?? '')
    }
  }, [language])

  useEffect(() => {
    render(node.attrs.code)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [node.attrs.code, render])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    resizeStartY.current = e.clientY
    resizeStartH.current = height

    const onMove = (ev: MouseEvent) => {
      if (resizeStartY.current === null) return
      const delta = ev.clientY - resizeStartY.current
      const newH = Math.max(120, resizeStartH.current + delta)
      updateAttributes({ height: Math.round(newH) })
    }
    const onUp = () => {
      resizeStartY.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function applyEdit() {
    updateAttributes({ code: draft })
    setEditing(false)
  }

  function cancelEdit() {
    setDraft(node.attrs.code)
    setEditing(false)
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
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono font-medium">diagram</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); setHelpOpen(true) }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-teal-400 transition-colors"
            title={t.editorHelp.syntaxHelp}
          >
            <HelpCircle size={12} /> {t.editorHelp.help}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
            className="p-1 text-slate-600 hover:text-red-400 transition-colors"
            title={t.embed.deleteBlock}
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
                className={cn('flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-primary-600 text-white hover:bg-primary-500 transition-colors')}
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
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(6, draft.split('\n').length + 1)}
          spellCheck={false}
          className="w-full bg-slate-900 text-slate-200 font-mono text-xs px-4 py-3 resize-y focus:outline-none"
          style={{ borderBottom: '1px solid var(--border-subtle)', minHeight: 100 }}
        />
      )}

      {/* Diagram preview — zoomable */}
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
        {svg && !error && (
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
        {svg && !error && !zoomFocused && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <span className="text-[10px] text-slate-400 bg-white/80 border border-slate-200 rounded px-2 py-0.5 shadow-sm">
              {t.editorHelp.zoomHint}
            </span>
          </div>
        )}

        <div
          className="w-full h-full overflow-hidden"
          style={{ cursor: svg && !error ? (isPanning.current ? 'grabbing' : (zoomFocused ? 'grab' : 'default')) : 'default' }}
          onClick={() => { if (svg && !error) setZoomFocused(true) }}
          onWheel={(e) => {
            if (!svg || error || !zoomFocused) return
            e.preventDefault()
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
            setScale((s) => Math.min(Math.max(s * factor, 0.1), 8))
          }}
          onMouseDown={(e) => {
            if (!svg || error || e.button !== 0) return
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
          onMouseUp={(e) => { isPanning.current = false; e.currentTarget.style.cursor = zoomFocused ? 'grab' : 'default' }}
          onMouseLeave={(e) => {
            isPanning.current = false
            e.currentTarget.style.cursor = 'default'
            setZoomFocused(false)
          }}
        >
          {rendering ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs text-slate-500">{t.editorHelp.rendering}</span>
            </div>
          ) : error ? (
            <div className="flex flex-col gap-1.5 p-4">
              <div className="flex items-start gap-2 text-red-400 text-xs">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span className="break-words font-mono">{error}</span>
              </div>
              <p className="text-xs text-slate-400 pl-5">
                {t.editorHelp.supported} <span className="text-slate-500">flowchart, sequenceDiagram, classDiagram, gantt, pie, erDiagram</span>
              </p>
            </div>
          ) : svg ? (
            <div
              style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(${offset.y}px)) scale(${scale})`,
                transformOrigin: 'top center',
                position: 'absolute',
                left: '50%',
                top: '16px',
                transition: isPanning.current ? 'none' : 'transform 0.05s',
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
              className="[&_svg]:max-w-none [&_svg]:h-auto"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs text-slate-600">{t.editorHelp.enterDiagramCode}</span>
            </div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="flex items-center justify-center h-3 bg-slate-800/60 hover:bg-slate-700/80 cursor-row-resize transition-colors group border-t border-slate-800"
        title={t.editorHelp.dragResize}
      >
        <GripHorizontal size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
      </div>
    </NodeViewWrapper>
  )
}

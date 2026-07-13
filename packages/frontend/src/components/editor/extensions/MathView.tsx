import { NodeViewWrapper } from '@tiptap/react'
import { useState, useEffect, useRef } from 'react'
import { Edit2, Check, Trash2, X, HelpCircle, GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

type L = (en: string, ru: string, be: string) => string

const mathExamples = (L: L) => [
  { title: L('Quadratic equation', 'Квадратное уравнение', 'Квадратнае ўраўненне'), formula: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { title: L("Euler's identity", 'Формула Эйлера', 'Формула Эйлера'), formula: 'e^{i\\pi} + 1 = 0' },
  { title: L('Gaussian integral', 'Интеграл Гаусса', 'Інтэграл Гаўса'), formula: '\\int_{-\\infty}^{+\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}' },
  { title: L("Newton's gravitation", 'Формула Ньютона', 'Формула Ньютана'), formula: 'F = G\\frac{m_1 m_2}{r^2}' },
  { title: L("Ohm's law", 'Закон Ома', 'Закон Ома'), formula: 'I = \\frac{U}{R}' },
  { title: L('Power', 'Мощность', 'Магутнасць'), formula: 'P = UI\\cos\\varphi' },
  { title: L('Pythagorean theorem', 'Теорема Пифагора', 'Тэарэма Піфагора'), formula: 'c = \\sqrt{a^2 + b^2}' },
  { title: L('Moment of inertia', 'Момент инерции', 'Момант інерцыі'), formula: 'I = \\int r^2\\,dm' },
  { title: L("Bernoulli's equation", 'Уравнение Бернулли', 'Ураўненне Бернулі'), formula: 'P + \\frac{\\rho v^2}{2} + \\rho g h = \\text{const}' },
  { title: L("Faraday's law", 'Закон Фарадея', 'Закон Фарадэя'), formula: '\\mathcal{E} = -\\frac{d\\Phi_B}{dt}' },
  { title: L('2×2 matrix', 'Матрица 2×2', 'Матрыца 2×2'), formula: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { title: L('Series sum', 'Сумма ряда', 'Сума раду'), formula: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}' },
]

function HelpModal({ onClose, onInsert }: { onClose: () => void; onInsert: (f: string) => void }) {
  const t = useT()
  const { language } = useLanguageStore()
  const L: L = (en, ru, be) => (language === 'en' ? en : language === 'be' ? be : ru)
  const MATH_EXAMPLES = mathExamples(L)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[80vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-100">{t.editorHelp.latexHelp}</p>
            <p className="text-xs text-slate-500">{t.editorHelp.formulasCalc}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.examples}</p>
            <div className="grid grid-cols-1 gap-2">
              {MATH_EXAMPLES.map((ex) => (
                <div key={ex.title} className="rounded-lg border border-slate-800 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60">
                    <span className="text-xs font-medium text-slate-400">{ex.title}</span>
                    <button
                      onClick={() => { onInsert(ex.formula); onClose() }}
                      className="text-xs text-teal-400 hover:text-teal-300 transition-colors px-2 py-0.5 rounded hover:bg-teal-400/10"
                    >
                      {t.editorHelp.insert}
                    </button>
                  </div>
                  <pre className="px-3 py-2 text-xs text-slate-300 font-mono leading-relaxed overflow-x-auto">{ex.formula}</pre>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.editorHelp.commonSymbols}</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden divide-y divide-slate-800">
              {[
                ['\\frac{a}{b}', L('fraction a/b', 'дробь a/b', 'дроб a/b')],
                ['\\sqrt{x}', L('square root', 'квадратный корень', 'квадратны корань')],
                ['x^{2}', L('power', 'степень', 'ступень')],
                ['x_{i}', L('subscript', 'нижний индекс', 'ніжні індэкс')],
                ['\\sum_{i=1}^{n}', L('sum', 'сумма', 'сума')],
                ['\\int_{a}^{b}', L('integral', 'интеграл', 'інтэграл')],
                ['\\alpha, \\beta, \\gamma', L('Greek letters', 'греческие буквы', 'грэчаскія літары')],
                ['\\pm, \\times, \\div', L('arithmetic', 'арифметика', 'арыфметыка')],
                ['\\leq, \\geq, \\neq', L('comparison', 'сравнение', 'параўнанне')],
                ['\\infty, \\partial, \\nabla', L('special symbols', 'спецсимволы', 'спецсімвалы')],
              ].map(([code, desc]) => (
                <div key={code} className="flex items-center gap-3 px-3 py-2">
                  <code className="text-xs text-teal-400 font-mono w-44 flex-shrink-0">{code}</code>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600 text-center">{L('Full docs: katex.org/docs/supported', 'Полная документация: katex.org/docs/supported', 'Поўная дакументацыя: katex.org/docs/supported')}</p>
        </div>
      </div>
    </div>
  )
}

export function MathBlockView({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { formula: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}) {
  const t = useT()
  const DEFAULT = 'E = mc^2'
  const isNew = !node.attrs.formula || node.attrs.formula === DEFAULT
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(node.attrs.formula || DEFAULT)
  const [rendered, setRendered] = useState('')
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    renderFormula(node.attrs.formula)
  }, [node.attrs.formula])

  async function renderFormula(formula: string) {
    if (!formula.trim()) { setRendered(''); return }
    try {
      const katex = (await import('katex')).default
      const html = katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false,
        errorColor: '#ef4444',
      })
      setRendered(html)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.editorHelp.formulaError)
    }
  }

  function applyEdit() {
    updateAttributes({ formula: draft })
    setEditing(false)
  }

  function cancelEdit() {
    setDraft(node.attrs.formula)
    setEditing(false)
  }

  return (
    <NodeViewWrapper className="my-4 rounded-xl overflow-hidden border border-slate-700 select-none">
      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(false)}
          onInsert={(f) => { setDraft(f); setEditing(true) }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono font-medium">formula</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); setHelpOpen(true) }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-teal-400 transition-colors"
            title={t.editorHelp.latexHelp}
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

      {/* Editor */}
      {editing && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(2, draft.split('\n').length + 1)}
          spellCheck={false}
          placeholder={t.editorHelp.latexPlaceholder}
          className="w-full bg-slate-900 text-slate-200 font-mono text-sm px-4 py-3 resize-y focus:outline-none border-b border-slate-700/50"
          style={{ minHeight: 56 }}
        />
      )}

      {/* Preview */}
      <div
        ref={containerRef}
        className="px-6 py-5 bg-slate-900/60 flex justify-center items-center min-h-[64px]"
      >
        {error ? (
          <span className="text-xs text-red-400 font-mono">{error}</span>
        ) : rendered ? (
          <div
            dangerouslySetInnerHTML={{ __html: rendered }}
            className="katex-block text-slate-100 overflow-x-auto max-w-full"
          />
        ) : (
          <span className="text-xs text-slate-600">{t.editorHelp.formulaEmpty}</span>
        )}
      </div>

      <div className="flex items-center justify-center h-3 bg-slate-800/60 border-t border-slate-800">
        <GripHorizontal size={12} className="text-slate-700" />
      </div>
    </NodeViewWrapper>
  )
}

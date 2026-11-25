import { useT } from '@/i18n/useT'
import { MODEL_TAGS, emptyModelFilters, type ModelFilters } from '@/lib/modelFilters'
import { BENCHMARK_TASKS, type BenchmarkTask } from '@/lib/modelBenchmarks'

export function ModelFilterControls({ value, onChange }: { value: ModelFilters; onChange: (value: ModelFilters) => void }) {
  const c = useT().admin.catalog
  const labels = { text: c.tagText, coding: c.tagCoding, reasoning: c.tagReasoning, tools: c.tagTools, vision: c.tagVision, imagegen: c.tagImagegen, audio: c.tagAudio, video: c.tagVideo }
  const input = 'block mt-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 w-full'
  return <fieldset className="space-y-2 rounded-lg border border-slate-700 p-3">
    <legend className="px-1 text-xs text-slate-400">{c.filters}</legend>
    <div className="flex flex-wrap gap-2">{MODEL_TAGS.map((tag) => <button type="button" key={tag} aria-pressed={value.tags.includes(tag)}
      onClick={() => onChange({ ...value, tags: value.tags.includes(tag) ? value.tags.filter((x) => x !== tag) : [...value.tags, tag] })}
      className={`rounded-lg border px-2 py-1 text-xs ${value.tags.includes(tag) ? 'border-primary-500 bg-primary-600/80 text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>{labels[tag]}</button>)}</div>
    <p className="text-[11px] text-slate-500">{c.combineHint}</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <label className="text-xs text-slate-400">{c.priceFilter}<select className={input} value={value.price} onChange={(e) => onChange({ ...value, price: e.target.value as ModelFilters['price'] })}>
        <option value="any">{c.anyPrice}</option><option value="free">{c.free}</option><option value="paid">{c.paid}</option><option value="known">{c.knownPrice}</option><option value="unknown">{c.unknownPrice}</option>
      </select></label>
      <label className="text-xs text-slate-400">{c.minContext}<select className={input} value={value.minContext} onChange={(e) => onChange({ ...value, minContext: e.target.value })}>
        <option value="">{c.anyContext}</option>{[32000, 64000, 128000, 200000, 1000000].map((n) => <option key={n} value={n}>{n / 1000}k+</option>)}
      </select></label>
      <label className="text-xs text-slate-400">{c.maxInput}<input type="number" min="0" step="any" className={input} value={value.maxPrompt} onChange={(e) => onChange({ ...value, maxPrompt: e.target.value })} placeholder="—" /></label>
      <label className="text-xs text-slate-400">{c.maxOutputPrice}<input type="number" min="0" step="any" className={input} value={value.maxCompletion} onChange={(e) => onChange({ ...value, maxCompletion: e.target.value })} placeholder="—" /></label>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="text-xs text-slate-400">{c.benchmarkTask}<select aria-label={c.benchmarkTask} className={input} value={value.benchmarkTask} onChange={(e) => onChange({ ...value, benchmarkTask: e.target.value as BenchmarkTask })}>
        {BENCHMARK_TASKS.map((task) => <option key={task} value={task}>{c.benchmarkTasks[task]}</option>)}
      </select></label>
      <label className="text-xs text-slate-400">{c.benchmarkData}<select aria-label={c.benchmarkData} className={input} value={value.benchmarkPresence} onChange={(e) => onChange({ ...value, benchmarkPresence: e.target.value as ModelFilters['benchmarkPresence'] })}>
        <option value="any">{c.benchmarkAny}</option><option value="scored">{c.benchmarkScored}</option><option value="unscored">{c.benchmarkUnscored}</option>
      </select></label>
      <label className="text-xs text-slate-400">{c.minScore}<input type="number" min="0" max="100" step="any" className={input} value={value.minScore} onChange={(e) => onChange({ ...value, minScore: e.target.value })} placeholder="—" /></label>
    </div>
    <p className="text-[11px] text-slate-500">{c.benchmarkHint}</p>
    <button type="button" onClick={() => onChange(emptyModelFilters())} className="text-xs text-slate-400 hover:text-slate-200">{c.resetFilters}</button>
  </fieldset>
}

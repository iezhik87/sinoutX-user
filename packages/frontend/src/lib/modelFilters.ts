import { taskBenchmark, type BenchmarkedModel, type BenchmarkTask } from './modelBenchmarks'

export interface FilterableModel extends BenchmarkedModel {
  id: string
  tags: string[]
  contextLength: number
  promptPer1M: number | null
  completionPer1M: number | null
}
export interface ModelFilters {
  tags: string[]
  minContext: string
  maxPrompt: string
  maxCompletion: string
  price: 'any' | 'free' | 'paid' | 'known' | 'unknown'
  benchmarkTask: BenchmarkTask
  benchmarkPresence: 'any' | 'scored' | 'unscored'
  minScore: string
}
export const emptyModelFilters = (): ModelFilters => ({ tags: [], minContext: '', maxPrompt: '', maxCompletion: '', price: 'any', benchmarkTask: 'overall', benchmarkPresence: 'any', minScore: '' })
export const MODEL_TAGS = ['text', 'coding', 'reasoning', 'tools', 'vision', 'imagegen', 'audio', 'video'] as const

export function matchesModelFilters(model: FilterableModel, filters: ModelFilters): boolean {
  const benchmark = taskBenchmark(model, filters.benchmarkTask)
  if (filters.benchmarkPresence === 'scored' && !benchmark) return false
  if (filters.benchmarkPresence === 'unscored' && benchmark) return false
  if (filters.minScore !== '' && (!Number.isFinite(Number(filters.minScore)) || Number(filters.minScore) < 0 || Number(filters.minScore) > 100 || !benchmark || benchmark.score < Number(filters.minScore))) return false
  if (!filters.tags.every((tag) => model.tags.includes(tag))) return false
  if (filters.minContext && model.contextLength < Number(filters.minContext)) return false
  for (const [text, price] of [[filters.maxPrompt, model.promptPer1M], [filters.maxCompletion, model.completionPer1M]] as const) {
    if (text && (!Number.isFinite(Number(text)) || Number(text) < 0 || price === null || price > Number(text))) return false
  }
  const known = model.promptPer1M !== null && model.completionPer1M !== null
  const free = model.promptPer1M === 0 && model.completionPer1M === 0
  if (filters.price === 'known' && !known) return false
  if (filters.price === 'unknown' && known) return false
  if (filters.price === 'free' && !free) return false
  if (filters.price === 'paid' && (!known || free)) return false
  return true
}

export type PriceBasis = 'blended' | 'prompt' | 'completion'
export function modelPrice(model: FilterableModel, basis: PriceBasis): number | null {
  if (basis === 'prompt') return model.promptPer1M
  if (basis === 'completion') return model.completionPer1M
  return model.promptPer1M === null || model.completionPer1M === null ? null : model.promptPer1M * 0.7 + model.completionPer1M * 0.3
}
export function compareModelPrice(a: FilterableModel, b: FilterableModel, basis: PriceBasis, descending = false): number {
  const x = modelPrice(a, basis), y = modelPrice(b, basis)
  if (x === null || y === null) return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1
  return (descending ? y - x : x - y) || a.id.localeCompare(b.id)
}

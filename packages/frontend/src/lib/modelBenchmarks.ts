export const BENCHMARK_TASKS = ['overall', 'coding', 'agentic', 'reasoning', 'dataAnalysis', 'browser', 'research', 'design'] as const
export type BenchmarkTask = typeof BENCHMARK_TASKS[number]
export interface BenchmarkRun { model: string; scores: Partial<Record<BenchmarkTask, number>> }
export interface ModelBenchmark {
  source: string; dataUrl: string; release: string; publishedAt: string | null; fetchedAt: string; stale: boolean; runs: BenchmarkRun[]; notes: string[]
}
export interface BenchmarkedModel { id: string; benchmark?: ModelBenchmark | null }

/** Best published configuration for THIS task, retaining its exact test ID. */
export function taskBenchmark(model: BenchmarkedModel, task: BenchmarkTask): { score: number; run: string } | null {
  let best: { score: number; run: string } | null = null
  for (const run of model.benchmark?.runs ?? []) {
    const score = run.scores[task]
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > 100) continue
    if (!best || score > best.score || (score === best.score && run.model.localeCompare(best.run) < 0)) best = { score, run: run.model }
  }
  return best
}
export function compareBenchmark(a: BenchmarkedModel, b: BenchmarkedModel, task: BenchmarkTask, ascending = false): number {
  const x = taskBenchmark(a, task), y = taskBenchmark(b, task)
  if (!x || !y) return x === y ? a.id.localeCompare(b.id) : x ? -1 : 1
  return (ascending ? x.score - y.score : y.score - x.score) || a.id.localeCompare(b.id)
}

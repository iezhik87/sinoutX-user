import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, X, Loader2, CheckCircle2, FileText, ListChecks, Sparkles } from 'lucide-react'
import { Modal } from '@/components/common/Modal'
import { api } from '@/api/client'
import { taskApi, pageApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { toast } from '@/stores/toastStore'
import { useNavigate } from 'react-router-dom'

interface TranscribeResult {
  transcript: string
  analysis: {
    title: string
    summary: string
    decisions: string[]
    tasks: { title: string; assignee: string | null; dueHint: string | null }[]
    keyPoints: string[]
  }
}

interface Props {
  onClose: () => void
  projectId?: string
}

export function TranscribeModal({ onClose, projectId }: Props) {
  const { currentWorkspaceId, currentProjectId } = useWorkspaceStore()
  const { language } = useLanguageStore()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<TranscribeResult | null>(null)
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [creatingPage, setCreatingPage] = useState(false)
  const [createdTaskIds, setCreatedTaskIds] = useState<Set<number>>(new Set())

  const pid = projectId ?? currentProjectId

  const transcribeMut = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData()
      form.append('file', f, f.name)
      const res = await api.post<TranscribeResult>('/ai/transcribe', form, {
        params: { workspaceId: currentWorkspaceId },
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })
      return res.data
    },
    onSuccess: (data) => {
      setResult(data)
      setSelectedTasks(new Set(data.analysis.tasks.map((_, i) => i)))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function pickFile(f: File) {
    setFile(f)
    setResult(null)
    setSelectedTasks(new Set())
    setCreatedTaskIds(new Set())
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  async function createPage() {
    if (!result || !pid) return
    setCreatingPage(true)
    try {
      const { analysis, transcript } = result
      const content = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: analysis.title }] },
          { type: 'paragraph', content: [{ type: 'text', text: analysis.summary }] },
          ...(analysis.keyPoints.length ? [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: L('Key Points', 'Ключевые моменты', 'Ключавыя моманты') }] },
            ...analysis.keyPoints.map((p) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: p }] }] }] })),
          ] : []),
          ...(analysis.decisions.length ? [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: L('Decisions', 'Принятые решения', 'Прынятыя рашэнні') }] },
            ...analysis.decisions.map((d) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: d }] }] }] })),
          ] : []),
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: L('Full Transcript', 'Полная транскрипция', 'Поўная транскрыпцыя') }] },
          { type: 'paragraph', content: [{ type: 'text', text: transcript }] },
        ],
      }
      const page = await pageApi.create({ projectId: pid, title: analysis.title })
      await pageApi.update(page.id, { content })
      qc.invalidateQueries({ queryKey: ['pages'] })
      toast.success(L('Page created', 'Страница создана', 'Старонка створана'))
      navigate(`/pages/${page.id}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setCreatingPage(false)
    }
  }

  async function createTasks() {
    if (!result || !pid) return
    const toCreate = result.analysis.tasks.filter((_, i) => selectedTasks.has(i))
    const created = new Set(createdTaskIds)
    for (const [i, task] of result.analysis.tasks.entries()) {
      if (!selectedTasks.has(i) || createdTaskIds.has(i)) continue
      try {
        await taskApi.create({ projectId: pid, title: task.title })
        created.add(i)
      } catch { /* skip */ }
    }
    setCreatedTaskIds(created)
    qc.invalidateQueries({ queryKey: ['tasks'] })
    const n = created.size - createdTaskIds.size
    toast.success(L(`Created ${n} tasks`, `Создано задач: ${n}`, `Створана задач: ${n}`))
    if (!toCreate.length) toast.info(L('No new tasks', 'Нет новых задач', 'Няма новых задач'))
  }

  const ACCEPT = 'audio/*,video/*,.mp3,.mp4,.wav,.m4a,.ogg,.webm,.flac'

  return (
    <Modal open onClose={onClose} title={L('Meeting Transcription', 'Транскрипция встречи', 'Транскрыпцыя сустрэчы')} className="max-w-2xl">
      <div className="space-y-4">

        {/* Upload area */}
        {!result && (
          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-primary-500 rounded-xl p-8 text-center cursor-pointer transition-colors"
          >
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
            <Mic size={28} className="mx-auto text-slate-500 mb-3" />
            <p className="text-sm text-slate-300 font-medium">
              {file ? file.name : L('Drop audio/video or click to select', 'Перетащите аудио/видео или нажмите для выбора', 'Перацягніце аўдыя/відэа або націсніце для выбару')}
            </p>
            <p className="text-xs text-slate-600 mt-1">MP3, MP4, WAV, M4A, OGG, WEBM, FLAC · {L('up to 100 MB', 'до 100 МБ', 'да 100 МБ')}</p>
            {file && <p className="text-xs text-primary-400 mt-2">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
          </div>
        )}

        {/* Transcribe button */}
        {file && !result && (
          <button
            onClick={() => transcribeMut.mutate(file)}
            disabled={transcribeMut.isPending}
            className="btn-primary w-full justify-center"
          >
            {transcribeMut.isPending
              ? <><Loader2 size={14} className="animate-spin" />{L('Transcribing...', 'Транскрибирую...', 'Транскрыбую...')}</>
              : <><Sparkles size={14} />{L('Transcribe', 'Транскрибировать', 'Транскрыбаваць')}</>}
          </button>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Reset */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-100">{result.analysis.title}</h3>
              <button onClick={() => { setResult(null); setFile(null) }} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={14} /></button>
            </div>

            {/* Summary */}
            {result.analysis.summary && (
              <p className="text-sm text-slate-400 bg-surface-950 rounded-lg p-3">{result.analysis.summary}</p>
            )}

            {/* Key points */}
            {result.analysis.keyPoints.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{L('Key points', 'Ключевые моменты', 'Ключавыя моманты')}</p>
                <ul className="space-y-1">
                  {result.analysis.keyPoints.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-primary-500 mt-0.5 flex-shrink-0">•</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Decisions */}
            {result.analysis.decisions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{L('Decisions', 'Принятые решения', 'Прынятыя рашэнні')}</p>
                <ul className="space-y-1">
                  {result.analysis.decisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <CheckCircle2 size={13} className="text-green-400 mt-0.5 flex-shrink-0" />{d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tasks */}
            {result.analysis.tasks.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{L('Tasks', 'Задачи', 'Задачы')}</p>
                <div className="space-y-1.5">
                  {result.analysis.tasks.map((task, i) => (
                    <label key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(i)}
                        onChange={() => setSelectedTasks((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}
                        className="accent-primary-500"
                      />
                      <span className={`flex-1 text-sm ${createdTaskIds.has(i) ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{task.title}</span>
                      {task.assignee && <span className="text-xs text-slate-500">{task.assignee}</span>}
                      {task.dueHint && <span className="text-xs text-slate-600">{task.dueHint}</span>}
                      {createdTaskIds.has(i) && <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Transcript preview */}
            <details className="group">
              <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-400 transition-colors">
                {L('Full transcript', 'Полная транскрипция', 'Поўная транскрыпцыя')} ({result.transcript.split(' ').length} {L('words', 'слов', 'слоў')})
              </summary>
              <p className="mt-2 text-xs text-slate-500 bg-surface-950 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">{result.transcript}</p>
            </details>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-slate-800">
              {pid && (
                <>
                  <button onClick={createPage} disabled={creatingPage} className="btn-ghost flex items-center gap-1.5 text-sm">
                    {creatingPage ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                    {L('Create page', 'Создать страницу', 'Стварыць старонку')}
                  </button>
                  {result.analysis.tasks.length > 0 && (
                    <button onClick={createTasks} disabled={selectedTasks.size === 0} className="btn-ghost flex items-center gap-1.5 text-sm">
                      <ListChecks size={13} />
                      {L(`Create tasks (${selectedTasks.size})`, `Создать задачи (${selectedTasks.size})`, `Стварыць задачы (${selectedTasks.size})`)}
                    </button>
                  )}
                </>
              )}
              <button onClick={onClose} className="btn-ghost ml-auto">{L('Close', 'Закрыть', 'Закрыць')}</button>
            </div>
          </div>
        )}

        {!file && !result && (
          <p className="text-xs text-slate-600 text-center">
            {L('Requires OpenAI API key in AI settings', 'Требуется OpenAI API ключ в настройках AI', 'Патрэбны ключ OpenAI API у наладах AI')}
          </p>
        )}
      </div>
    </Modal>
  )
}

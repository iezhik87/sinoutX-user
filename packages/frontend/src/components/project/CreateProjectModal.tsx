import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { projectApi, type ProjectTemplate } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { useT, type Localized } from '@/i18n'
import { Modal } from '@/components/common/Modal'

// Built-in project templates offered when creating a project with AI.
const CREATE_TEMPLATES: (Localized<string> & { id: ProjectTemplate })[] = [
  { id: 'basic',        ru: 'Базовый',         en: 'Basic',        be: 'Базавы' },
  { id: 'deep',         ru: 'Углублённый',     en: 'Deep',         be: 'Паглыблены' },
  { id: 'educational',  ru: 'Образовательный', en: 'Educational',  be: 'Адукацыйны' },
  { id: 'economic',     ru: 'Экономический',   en: 'Economic',     be: 'Эканамічны' },
  { id: 'research',     ru: 'Исследование',    en: 'Research',     be: 'Даследаванне' },
  { id: 'essay',        ru: 'Реферат',         en: 'Essay',        be: 'Рэферат' },
  { id: 'presentation', ru: 'Презентация',     en: 'Presentation', be: 'Прэзентацыя' },
  { id: 'coursework',   ru: 'Курсовая',        en: 'Course work',  be: 'Курсавая' },
  { id: 'dissertation', ru: 'Диссертация',     en: 'Dissertation', be: 'Дысертацыя' },
  { id: 'engineering',  ru: 'Инженерный',      en: 'Engineering',  be: 'Інжынерны' },
  { id: 'dossier',      ru: 'Досье',           en: 'Dossier',      be: 'Дасье' },
  { id: 'custom',       ru: 'Свой шаблон',     en: 'Custom',       be: 'Свой шаблон' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateProjectModal({ open, onClose }: Props) {
  const { currentWorkspaceId, setCurrentProject } = useWorkspaceStore()
  const { language } = useLanguageStore()
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [useAi, setUseAi] = useState(false)
  const [aiTemplate, setAiTemplate] = useState<ProjectTemplate>('basic')
  const [aiInstructions, setAiInstructions] = useState('')
  const [genTasks, setGenTasks] = useState(true)
  const [genNotes, setGenNotes] = useState(true)

  function reset() {
    setName(''); setUseAi(false); setAiTemplate('basic'); setAiInstructions('')
    setGenTasks(true); setGenNotes(true)
  }

  const createProject = useMutation({
    mutationFn: (projectName: string) => projectApi.create({ workspaceId: currentWorkspaceId!, name: projectName }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects', currentWorkspaceId] })
      setCurrentProject(p.id)
      // Capture AI choices before resetting state.
      const projectName = name.trim()
      const ai = useAi, tpl = aiTemplate, instr = aiInstructions, gt = genTasks, gn = genNotes
      reset()
      onClose()
      navigate(`/projects/${p.id}`)
      if (ai) {
        document.dispatchEvent(new CustomEvent('ai:open', {
          detail: {
            template: tpl,
            prompt: t.sidebar.aiCreate.prompt.replace('{name}', projectName),
            instructions: tpl === 'custom' ? instr : undefined,
            templateName: tpl === 'custom' ? projectName : undefined,
            genTasks: gt,
            genNotes: gn,
          },
        }))
      }
    },
  })

  function handleClose() {
    reset()
    onClose()
  }

  const ac = t.sidebar.aiCreate

  return (
    <Modal open={open} onClose={handleClose} title={t.sidebar.newProject}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) createProject.mutate(name.trim()) }}
        className="space-y-4"
      >
        <input
          autoFocus
          type="text"
          placeholder={t.sidebar.projectName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="nb-input w-full"
        />

        {/* Generate with AI */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="accent-primary-600" />
          <span className="text-sm text-slate-200">{ac.useAi}</span>
        </label>

        {useAi && (
          <div className="space-y-3 rounded-lg border border-slate-700 bg-surface-800/50 p-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{ac.template}</label>
              <select
                value={aiTemplate}
                onChange={(e) => setAiTemplate(e.target.value as ProjectTemplate)}
                className="nb-input w-full"
              >
                {CREATE_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{language === 'en' ? tpl.en : language === 'be' ? tpl.be : tpl.ru}</option>
                ))}
              </select>
            </div>

            {aiTemplate === 'custom' && (
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder={ac.customPlaceholder}
                rows={3}
                className="nb-input w-full resize-none"
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={genTasks} onChange={(e) => setGenTasks(e.target.checked)} className="accent-primary-600" />
                <span className="text-sm text-slate-300">{ac.genTasks}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={genNotes} onChange={(e) => setGenNotes(e.target.checked)} className="accent-primary-600" />
                <span className="text-sm text-slate-300">{ac.genNotes}</span>
              </label>
              {(!genTasks || !genNotes) && (
                <p className="text-xs text-slate-500">{ac.onlyPages}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={handleClose} className="btn-ghost">
            {t.common.cancel}
          </button>
          <button type="submit" disabled={!name.trim() || createProject.isPending} className="btn-primary">
            {createProject.isPending ? <Loader2 size={14} className="animate-spin" /> : (useAi ? ac.createGenerate : t.common.create)}
          </button>
        </div>
      </form>
    </Modal>
  )
}

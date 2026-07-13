import { useState, useRef, useEffect, useCallback } from 'react'
import {
  X, Send, Sparkles, RotateCcw, CheckCircle2, AlertCircle,
  Loader2, ChevronRight, Clock, Mic, MicOff, FolderKanban,
  History, Trash2, ChevronLeft, MessageSquare, Plus,
} from 'lucide-react'
import {
  aiApi, aiSettingsApi, aiConversationApi,
  type AiChatMessage, type AiContext, type ProjectTemplate, type AiConversationSummary,
} from '@/api/client'
import { cn } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLanguageStore } from '@/stores/languageStore'
import { useT, type Language, type Localized } from '@/i18n'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCallItem {
  id: string
  name: string
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  durationMs?: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallItem[]
  isStreaming?: boolean
  isThinking?: boolean   // waiting for first token / between tool calls
  startedAt?: number
  durationMs?: number
}

interface AiSidebarProps {
  open: boolean
  onClose: () => void
  context: AiContext
  initialTemplate?: ProjectTemplate
  initialTemplateName?: string
  initialPrompt?: string
  initialInstructions?: string
  initialGenTasks?: boolean
  initialGenNotes?: boolean
  onWidthChange?: (width: number) => void
  /** Phone: cover the screen instead of docking as a resizable right panel. */
  fullScreen?: boolean
}

// ── Project template definitions ─────────────────────────────────────────────

interface TemplateInfo extends Localized<string> {
  id: ProjectTemplate
  icon: string
}

const PROJECT_TEMPLATES: TemplateInfo[] = [
  { id: 'basic',        ru: 'Базовый',        en: 'Basic',        be: 'Базавы',         icon: 'lucide:FolderKanban' },
  { id: 'deep',         ru: 'Углублённый',    en: 'Deep',         be: 'Паглыблены',     icon: 'lucide:Layers' },
  { id: 'educational',  ru: 'Образовательный',en: 'Educational',  be: 'Адукацыйны',     icon: 'lucide:BookOpen' },
  { id: 'economic',     ru: 'Экономический',  en: 'Economic',     be: 'Эканамічны',     icon: 'lucide:Database' },
  { id: 'research',     ru: 'Исследование',   en: 'Research',     be: 'Даследаванне',   icon: 'lucide:Compass' },
  { id: 'essay',        ru: 'Реферат',        en: 'Essay',        be: 'Рэферат',        icon: 'lucide:FileText' },
  { id: 'presentation', ru: 'Презентация',    en: 'Presentation', be: 'Прэзентацыя',    icon: 'lucide:LayoutDashboard' },
  { id: 'coursework',   ru: 'Курсовая',       en: 'Course work',  be: 'Курсавая',       icon: 'lucide:BookMarked' },
  { id: 'dissertation', ru: 'Диссертация',    en: 'Dissertation', be: 'Дысертацыя',     icon: 'lucide:Award' },
  { id: 'engineering',  ru: 'Инженерный',     en: 'Engineering',  be: 'Інжынерны',      icon: 'lucide:Wrench' },
  { id: 'dossier',      ru: 'Досье',          en: 'Dossier',      be: 'Дасье',          icon: 'lucide:ClipboardList' },
]

// ── Constants ─────────────────────────────────────────────────────────────────

function getWelcome(lang: Language): string {
  const WELCOME: Localized<string> = {
    en: `Hello! I'm the SinoutX AI assistant. I can:
• Create projects with content
• Add pages, tasks, notes, budget
• Download and save sources by URL
• Build connections between pages on the graph

Try: *"Create a project on the history of Rome"* or *"Download sources on the topic of climate"*`,
    be: `Прывітанне! Я AI-асістэнт SinoutX. Магу:
• Ствараць праекты з кантэнтам
• Дадаваць старонкі, задачы, нататкі, бюджэт
• Спампоўваць і захоўваць крыніцы па URL
• Будаваць сувязі паміж старонкамі на графе

Паспрабуй: *«Стварыць праект па гісторыі Рыма»* або *«Спампаваць крыніцы па тэме клімату»*`,
    ru: `Привет! Я AI-ассистент SinoutX. Могу:
• Создавать проекты с содержимым
• Добавлять страницы, задачи, заметки, бюджет
• Скачивать и сохранять источники по URL
• Строить связи между страницами на графе

Попробуй: *«Создай проект по истории Рима»* или *«Скачай источники по теме климата»*`,
  }
  return WELCOME[lang]
}

// ── Tool label + icon ─────────────────────────────────────────────────────────

function toolLabel(tool: string, lang: Language): string {
  const ru: Record<string, string> = {
    create_project: 'Создаю проект',
    create_folder: 'Создаю папку',
    create_page: 'Создаю страницу',
    update_page: 'Обновляю страницу',
    create_task: 'Создаю задачу',
    create_tasks_batch: 'Создаю задачи',
    create_note: 'Создаю заметку',
    add_budget_entry: 'Добавляю запись в бюджет',
    create_link: 'Создаю связь',
    list_workspaces: 'Загружаю рабочие пространства',
    list_projects: 'Загружаю проекты',
    list_pages: 'Загружаю страницы',
    list_tasks: 'Загружаю задачи',
    get_page: 'Читаю страницу',
    fetch_and_save_source: 'Скачиваю источник',
    list_sources: 'Загружаю источники',
    create_event: 'Создаю событие',
    create_workspace: 'Создаю рабочее пространство',
    list_page_templates: 'Загружаю шаблоны страниц',
    create_page_from_template: 'Создаю страницу по шаблону',
    save_page_as_template: 'Сохраняю страницу как шаблон',
    list_project_templates: 'Загружаю шаблоны проектов',
    save_project_as_template: 'Сохраняю проект как шаблон',
    create_project_from_template: 'Создаю проект по шаблону',
    get_project_memory: 'Читаю память проекта',
    update_project_memory: 'Обновляю память проекта',
  }
  const en: Record<string, string> = {
    create_project: 'Creating project',
    create_folder: 'Creating folder',
    create_page: 'Creating page',
    update_page: 'Updating page',
    create_task: 'Creating task',
    create_tasks_batch: 'Creating tasks',
    create_note: 'Creating note',
    add_budget_entry: 'Adding budget entry',
    create_link: 'Creating link',
    list_workspaces: 'Loading workspaces',
    list_projects: 'Loading projects',
    list_pages: 'Loading pages',
    list_tasks: 'Loading tasks',
    get_page: 'Reading page',
    fetch_and_save_source: 'Downloading source',
    list_sources: 'Loading sources',
    create_event: 'Creating event',
    create_workspace: 'Creating workspace',
    list_page_templates: 'Loading page templates',
    create_page_from_template: 'Creating page from template',
    save_page_as_template: 'Saving page as template',
    list_project_templates: 'Loading project templates',
    save_project_as_template: 'Saving project as template',
    create_project_from_template: 'Creating project from template',
    get_project_memory: 'Reading project memory',
    update_project_memory: 'Updating project memory',
  }
  const be: Record<string, string> = {
    create_project: 'Стваральны праект',
    create_folder: 'Стварую папку',
    create_page: 'Стварую старонку',
    update_page: 'Абнаўляю старонку',
    create_task: 'Стварую задачу',
    create_tasks_batch: 'Стварую задачы',
    create_note: 'Стварую нататку',
    add_budget_entry: 'Дадаю запіс у бюджэт',
    create_link: 'Стварую сувязь',
    list_workspaces: 'Загружаю прасторы',
    list_projects: 'Загружаю праекты',
    list_pages: 'Загружаю старонкі',
    list_tasks: 'Загружаю задачы',
    get_page: 'Чытаю старонку',
    fetch_and_save_source: 'Спампоўваю крыніцу',
    list_sources: 'Загружаю крыніцы',
    create_event: 'Стварую падзею',
    create_workspace: 'Стварую прастору',
    list_page_templates: 'Загружаю шаблоны старонак',
    create_page_from_template: 'Стварую старонку па шаблоне',
    save_page_as_template: 'Захоўваю старонку як шаблон',
    list_project_templates: 'Загружаю шаблоны праектаў',
    save_project_as_template: 'Захоўваю праект як шаблон',
    create_project_from_template: 'Стварую праект па шаблоне',
    get_project_memory: 'Чытаю памяць праекта',
    update_project_memory: 'Абнаўляю памяць праекта',
  }
  const LABELS: Localized<Record<string, string>> = { ru, en, be }
  return LABELS[lang][tool] ?? tool
}

// ── Main component ────────────────────────────────────────────────────────────

export function AiSidebar({ open, onClose, context, initialTemplate, initialTemplateName, initialPrompt, initialInstructions, initialGenTasks, initialGenNotes, onWidthChange, fullScreen }: AiSidebarProps) {
  const { language } = useLanguageStore()
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: 'welcome', role: 'assistant', content: getWelcome(language) },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | undefined>(initialTemplate)
  const [customTemplateName, setCustomTemplateName] = useState<string | undefined>(initialTemplateName)
  const [customInstructions, setCustomInstructions] = useState<string | undefined>(initialInstructions)
  const [genTasks, setGenTasks] = useState<boolean>(initialGenTasks ?? true)
  const [genNotes, setGenNotes] = useState<boolean>(initialGenNotes ?? true)
  const [scopeLocked, setScopeLocked] = useState(false)

  // History panel
  const [historyOpen, setHistoryOpen] = useState(false)
  const [currentConvId, setCurrentConvId] = useState<string | null>(null)
  const convIdRef = useRef<string | null>(null)
  convIdRef.current = currentConvId

  // Load history list
  const { data: conversations, refetch: refetchConversations } = useQuery({
    queryKey: ['ai-conversations', context.projectId ?? context.workspaceId],
    queryFn: () => aiConversationApi.list({ workspaceId: context.workspaceId! }),
    enabled: !!(context.projectId || context.workspaceId),
    staleTime: 5000,
  })

  // Save completed exchange (user + assistant) to current conversation
  const saveExchange = useCallback(async (userContent: string, assistantContent: string, toolCallItems: ToolCallItem[]) => {
    if (!context.workspaceId) {
      console.warn('[AiSidebar] saveExchange: no workspaceId, skipping history save')
      return
    }
    try {
      let id = convIdRef.current
      if (!id) {
        // Create new conversation, title = first 60 chars of user message
        const title = userContent.slice(0, 60) + (userContent.length > 60 ? '…' : '')
        const conv = await aiConversationApi.create({
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          title,
        })
        id = conv.id
        setCurrentConvId(id)
        convIdRef.current = id
      }
      const msgs: { role: string; content: string; toolCalls?: unknown }[] = [
        { role: 'user', content: userContent },
      ]
      if (toolCallItems.length > 0) {
        msgs.push({ role: 'assistant', content: '', toolCalls: toolCallItems.map((t) => ({ name: t.name, status: t.status })) })
      }
      msgs.push({ role: 'assistant', content: assistantContent })
      await aiConversationApi.addMessages(id, msgs)
      refetchConversations()
    } catch (err) {
      console.error('[AiSidebar] saveExchange failed:', err)
    }
  }, [context.workspaceId, context.projectId, refetchConversations])

  // Load a past conversation
  const loadConversation = useCallback(async (convId: string) => {
    try {
      const conv = await aiConversationApi.get(convId)
      const loaded: Message[] = [{ id: 'welcome', role: 'assistant', content: getWelcome(language)}]
      for (const m of conv.messages) {
        if (m.role === 'user' || m.role === 'assistant') {
          if (m.role === 'assistant' && !m.content && m.toolCalls) continue // skip tool-call-only messages
          loaded.push({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content })
        }
      }
      setMessages(loaded)
      setCurrentConvId(convId)
      convIdRef.current = convId
      setHistoryOpen(false)
    } catch { /* ignore */ }
  }, [])

  // Start new chat
  const newChat = useCallback(() => {
    setMessages([{ id: 'welcome', role: 'assistant', content: getWelcome(language)}])
    setCurrentConvId(null)
    convIdRef.current = null
    setHistoryOpen(false)
  }, [])

  // Apply initial template/prompt/instructions when sidebar opens with them
  useEffect(() => {
    setSelectedTemplate(initialTemplate)
    if (initialTemplateName !== undefined) setCustomTemplateName(initialTemplateName)
    if (open && initialPrompt) setInput(initialPrompt)
    if (open && initialInstructions !== undefined) setCustomInstructions(initialInstructions)
    if (open) { setGenTasks(initialGenTasks ?? true); setGenNotes(initialGenNotes ?? true) }
    // Opening for a template/prompt (e.g. project creation) starts a FRESH chat
    // instead of appending generation to whatever conversation was open.
    if (open && (initialTemplate || initialPrompt)) {
      setMessages([{ id: 'welcome', role: 'assistant', content: getWelcome(language) }])
      setCurrentConvId(null)
      convIdRef.current = null
    }
    if (!open) setScopeLocked(false)
  }, [open, initialTemplate, initialTemplateName, initialPrompt, initialInstructions, initialGenTasks, initialGenNotes, language])
  const [width, setWidth] = useState(400)
  const abortRef = useRef<AbortController | null>(null)
  const t = useT()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const streamContentRef = useRef('')
  const streamToolCallsRef = useRef<ToolCallItem[]>([])
  const qc = useQueryClient()

  // ── Voice input ───────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')

  const toggleMic = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) {
      alert(t.aiSidebar.speechNotSupported)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR()
    rec.lang = language === 'en' ? 'en-US' : 'ru-RU'
    rec.continuous = true
    rec.interimResults = true
    // Fixed base = whatever was typed before dictation started. It is NEVER
    // mutated, so nothing can accumulate into itself.
    finalTranscriptRef.current = input

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // Browsers disagree wildly here. Some (desktop Chrome) give distinct final
      // segments to concatenate; others (Samsung Internet / this device) emit each
      // GROWING guess — "теперь", "теперь ты", "теперь ты можешь" — as its OWN
      // entry, even marked final, so summing them gives «теперьтеперь ты…».
      //
      // Universal rule: walk the results and DEDUPE growth. If a chunk is a prefix
      // extension of the previous one (either contains the other), it's the same
      // phrase growing → keep the longer, don't append. Only a chunk that doesn't
      // overlap the previous is a genuinely new segment → append it.
      const segs: string[] = []
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const t = String(e.results[i][0].transcript)
        if (e.results[i].isFinal) {
          const prev = segs[segs.length - 1]
          if (prev !== undefined && (t.startsWith(prev) || prev.startsWith(t))) {
            segs[segs.length - 1] = t.length >= prev.length ? t : prev
          } else {
            segs.push(t)
          }
        } else {
          interim = t // only the latest interim guess
        }
      }
      const base = finalTranscriptRef.current
      const spoken = `${segs.join(' ')} ${interim}`.replace(/\s+/g, ' ').trim()
      setInput(base && spoken ? `${base} ${spoken}` : base || spoken)
    }
    rec.onend = () => setIsRecording(false)
    // On error just stop — the last onresult already left the correct text in the
    // input; overwriting it here would wipe what was dictated.
    rec.onerror = () => setIsRecording(false)

    rec.start()
    recognitionRef.current = rec
    setIsRecording(true)
  }, [isRecording, input, language])

  const { data: settingsData } = useQuery({
    queryKey: ['ai-settings', context.workspaceId],
    queryFn: () => aiSettingsApi.get(context.workspaceId!),
    enabled: !!context.workspaceId && open,
    staleTime: 60_000,
  })

  const currentModel = (() => {
    const s = settingsData?.settings
    if (!s) return null
    // On the built-in model the actual provider/model is our business, not the
    // user's — the header just says «SinoutX». Only BYOK shows the real name.
    if (s.provider === 'sinoutx') return 'SinoutX'
    const model = s.providers?.[s.provider]?.model ?? s.provider
    return model.includes('/') ? model.split('/').pop()! : model
  })()

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      onWidthChange?.(width)
    } else {
      onWidthChange?.(0)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update welcome message when language changes
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === 'welcome') {
        return [{ id: 'welcome', role: 'assistant', content: getWelcome(language) }]
      }
      return prev
    })
  }, [language])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Resize drag ──────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: { preventDefault(): void; clientX: number }) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const newWidth = Math.max(320, Math.min(720, dragRef.current.startWidth + dragRef.current.startX - me.clientX))
      setWidth(newWidth)
      onWidthChange?.(newWidth)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width])

  // ── Send ─────────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text }
    const assistantId = (Date.now() + 1).toString()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      isThinking: true,
      toolCalls: [],
      startedAt: Date.now(),
    }

    setMessages((prev: Message[]) => [...prev, userMsg, assistantMsg])
    setIsLoading(true)
    streamContentRef.current = ''
    streamToolCallsRef.current = []

    const history: AiChatMessage[] = [
      ...messages.filter((m) => m.id !== 'welcome').map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    abortRef.current = new AbortController()

    try {
      await aiApi.streamChat(
        history,
        {
          ...context,
          userLanguage: language,
          projectTemplate: selectedTemplate,
          projectTemplateInstructions: selectedTemplate === 'custom' ? customInstructions : undefined,
          genTasks,
          genNotes,
          scopeProjectId: scopeLocked && context.projectId ? context.projectId : undefined,
          scopeProjectName: scopeLocked && context.projectId ? (context.projectName ?? undefined) : undefined,
        },
        (event) => {
          if (event.type === 'text' && event.text) {
            streamContentRef.current += event.text
            setMessages((prev: Message[]) =>
              prev.map((m: Message) =>
                m.id === assistantId
                  ? { ...m, content: m.content + event.text, isThinking: false }
                  : m,
              ),
            )
          } else if (event.type === 'tool_start' && event.tool) {
            const toolItem: ToolCallItem = {
              id: `${event.tool}-${Date.now()}`,
              name: event.tool,
              status: 'running',
              startedAt: Date.now(),
            }
            streamToolCallsRef.current = [...streamToolCallsRef.current, toolItem]
            setMessages((prev: Message[]) =>
              prev.map((m: Message) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isThinking: false,
                      toolCalls: [...(m.toolCalls ?? []), toolItem],
                    }
                  : m,
              ),
            )
          } else if (event.type === 'tool_done' && event.tool) {
            streamToolCallsRef.current = streamToolCallsRef.current.map((tc) =>
              tc.name === event.tool && tc.status === 'running'
                ? { ...tc, status: 'done' as const, durationMs: Date.now() - tc.startedAt }
                : tc,
            )
            setMessages((prev: Message[]) =>
              prev.map((m: Message) => {
                if (m.id !== assistantId) return m
                const calls = (m.toolCalls ?? []).map((tc: ToolCallItem) => {
                  if (tc.name === event.tool && tc.status === 'running') {
                    return { ...tc, status: 'done' as const, durationMs: Date.now() - tc.startedAt }
                  }
                  return tc
                })
                return { ...m, toolCalls: calls, isThinking: true }
              }),
            )
          } else if (event.type === 'tool_error' && event.tool) {
            streamToolCallsRef.current = streamToolCallsRef.current.map((tc) =>
              tc.name === event.tool && tc.status === 'running'
                ? { ...tc, status: 'error' as const, error: event.text, durationMs: Date.now() - tc.startedAt }
                : tc,
            )
            setMessages((prev: Message[]) =>
              prev.map((m: Message) => {
                if (m.id !== assistantId) return m
                const calls = (m.toolCalls ?? []).map((tc: ToolCallItem) => {
                  if (tc.name === event.tool && tc.status === 'running') {
                    return { ...tc, status: 'error' as const, error: event.text, durationMs: Date.now() - tc.startedAt }
                  }
                  return tc
                })
                return { ...m, toolCalls: calls }
              }),
            )
          } else if (event.type === 'done') {
            setMessages((prev: Message[]) =>
              prev.map((m: Message) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: false,
                      isThinking: false,
                      durationMs: m.startedAt ? Date.now() - m.startedAt : undefined,
                    }
                  : m,
              ),
            )
            saveExchange(text, streamContentRef.current, streamToolCallsRef.current)
            qc.invalidateQueries({ queryKey: ['projects'] })
            qc.invalidateQueries({ queryKey: ['pages'] })
            qc.invalidateQueries({ queryKey: ['page'] })
            qc.invalidateQueries({ queryKey: ['tasks'] })
            qc.invalidateQueries({ queryKey: ['notes'] })
          } else if (event.type === 'error') {
            setMessages((prev: Message[]) =>
              prev.map((m: Message) =>
                m.id === assistantId
                  ? { ...m, content: `❌ ${t.aiSidebar.errorPrefix}: ${event.text}`, isStreaming: false, isThinking: false }
                  : m,
              ),
            )
          }
        },
        abortRef.current.signal,
      )
    } catch (err) {
      const e = err as Error
      if (e.name !== 'AbortError') {
        const msg = e.message?.toLowerCase().includes('fetch failed') || e.message?.toLowerCase().includes('failed to fetch')
          ? '🌐 Соединение с сервером оборвалось. Проверьте интернет-соединение и повторите запрос.'
          : `❌ ${e.message}`
        setMessages((prev: Message[]) =>
          prev.map((m: Message) =>
            m.id === assistantId
              ? { ...m, content: msg, isStreaming: false, isThinking: false }
              : m,
          ),
        )
      }
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, context, language, selectedTemplate, customInstructions, qc, saveExchange])

  const stop = () => {
    abortRef.current?.abort()
    setIsLoading(false)
    setMessages((prev: Message[]) =>
      prev.map((m: Message) =>
        m.isStreaming
          ? {
              ...m,
              isStreaming: false,
              isThinking: false,
              toolCalls: m.toolCalls?.map((tc: ToolCallItem) =>
                tc.status === 'running' ? { ...tc, status: 'done' as const } : tc,
              ),
            }
          : m,
      ),
    )
  }

  const clear = () => {
    setMessages([{ id: 'welcome', role: 'assistant', content: getWelcome(language)}])
  }

  if (!open) return null

  // Count tool calls in progress across all messages
  const runningTools = messages.flatMap((m) => m.toolCalls ?? []).filter((t) => t.status === 'running')

  return (
    <div
      className={cn(
        'flex flex-col bg-surface-900 relative',
        fullScreen
          ? 'fixed inset-0 z-50 w-full h-[100dvh]'
          : 'h-screen border-l border-slate-800 flex-shrink-0',
      )}
      style={fullScreen ? undefined : { width }}
    >
      {/* Resize handle — desktop dock only. */}
      {!fullScreen && (
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50 transition-colors z-10"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={15} className={cn('flex-shrink-0', isLoading ? 'text-primary-400 animate-pulse' : 'text-primary-400')} />
          <span className="text-sm font-semibold text-slate-100">{t.ai.title}</span>
          {currentModel && (
            <span className="text-xs text-slate-500 font-normal">({currentModel})</span>
          )}
          {context.projectName && (
            <span className="text-xs text-slate-500 truncate">· {context.projectName}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            title={t.aiSidebar.chatHistory}
            className={cn(
              'p-1.5 rounded transition-colors',
              historyOpen
                ? 'text-primary-400 bg-primary-900/40'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            )}
          >
            <History size={13} />
          </button>
          <button
            onClick={newChat}
            title={t.common.newChat}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={clear}
            title={t.ai.clear}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Global progress bar */}
      {isLoading && (
        <div className="h-0.5 bg-slate-800 overflow-hidden flex-shrink-0">
          <div className="h-full bg-primary-500 animate-progress-indeterminate" />
        </div>
      )}

      {/* Active tool banner */}
      {runningTools.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary-950/60 border-b border-primary-800/40 flex-shrink-0">
          <Loader2 size={12} className="text-primary-400 animate-spin flex-shrink-0" />
          <span className="text-xs text-primary-300 truncate">
            {toolLabel(runningTools[runningTools.length - 1].name, language)}…
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* History panel — slides over the chat area */}
      {historyOpen && (
        <div className="absolute inset-0 bg-surface-900 z-20 flex flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <History size={14} className="text-primary-400" />
              <span className="text-sm font-semibold text-slate-100">{t.aiSidebar.chatHistory}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={newChat}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
              >
                <Plus size={12} />
                {t.common.newChat}
              </button>
              <button
                onClick={() => setHistoryOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors ml-1"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto py-2">
            {!conversations || conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                <MessageSquare size={32} className="opacity-30" />
                <p className="text-sm">{t.aiSidebar.noSavedChats}</p>
              </div>
            ) : (
              <div className="space-y-0.5 px-2">
                {conversations.map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === currentConvId}
                    onLoad={() => loadConversation(conv.id)}
                    onDelete={async () => {
                      try {
                        await aiConversationApi.delete(conv.id)
                        if (conv.id === currentConvId) newChat()
                        refetchConversations()
                      } catch { /* ignore */ }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-800 flex-shrink-0">
        {/* Active template label */}
        {(() => {
          const builtinTmpl = selectedTemplate
            ? PROJECT_TEMPLATES.find((p) => p.id === selectedTemplate)
            : null
          const displayName = builtinTmpl
            ? (language === 'en' ? builtinTmpl.en : language === 'be' ? builtinTmpl.be : builtinTmpl.ru)
            : (selectedTemplate === 'custom' && customTemplateName)
              ? customTemplateName
              : null
          const label = displayName
            ? `${t.ai.templateLabel}: ${displayName}`
            : t.ai.templateNone
          return (
            <div className="mb-2 flex items-center gap-1.5">
              <span className={cn('text-[11px]', displayName ? 'text-primary-400' : 'text-slate-600')}>
                {label}
              </span>
              {displayName && (
                <button
                  onClick={() => { setSelectedTemplate(undefined); setCustomInstructions(undefined); setCustomTemplateName(undefined) }}
                  className="p-0.5 text-slate-600 hover:text-slate-400 transition-colors"
                  title={t.ai.clearTemplate}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })()}

        {/* Project scope toggle — only shown when inside a project */}
        {context.projectId && (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              onClick={() => setScopeLocked((v) => !v)}
              className={cn(
                'flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 transition-colors',
                scopeLocked
                  ? 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'
                  : 'text-slate-600 hover:text-slate-400',
              )}
              title={scopeLocked
                ? (language === 'en' ? 'Click to work across all projects' : language === 'be' ? 'Націснуць каб працаваць па ўсіх праектах' : 'Нажмите чтобы работать по всем проектам')
                : (language === 'en' ? 'Click to restrict AI to current project' : language === 'be' ? 'Націснуць каб абмежаваць AI бягучым праектам' : 'Нажмите чтобы ограничить AI текущим проектом')}
            >
              <FolderKanban size={10} />
              {scopeLocked
                ? (language === 'en' ? `Locked: ${context.projectName ?? 'project'}` : language === 'be' ? `Праект: ${context.projectName ?? 'праект'}` : `Проект: ${context.projectName ?? 'проект'}`)
                : (language === 'en' ? 'Work in current project' : language === 'be' ? 'Працаваць у бягучым праекце' : 'Работать в текущем проекте')}
            </button>
          </div>
        )}

        {context.pageName && (
          <div className="flex items-center gap-1 mb-2 text-xs text-slate-500">
            <ChevronRight size={11} />
            <span className="truncate">{language === 'en' ? 'Context' : language === 'be' ? 'Кантэкст' : 'Контекст'}: {context.pageName}</span>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={isRecording ? (language === 'en' ? 'Listening…' : language === 'be' ? 'Слухаю…' : 'Слушаю…') : `${t.ai.placeholder} (Enter)`}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-surface-950 border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 max-h-32 overflow-y-auto transition-colors',
              isRecording
                ? 'border-red-500/60 focus:ring-red-500/40'
                : 'border-slate-700 focus:ring-primary-500',
            )}
            style={{ minHeight: '38px' }}
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 128)}px`
            }}
          />
          {/* Mic button */}
          <button
            onClick={toggleMic}
            title={isRecording ? (language === 'en' ? 'Stop recording' : language === 'be' ? 'Спыніць запіс' : 'Остановить запись') : (language === 'en' ? 'Voice input' : language === 'be' ? 'Галасавы ўвод' : 'Голосовой ввод')}
            className={cn(
              'p-2 rounded-lg transition-all flex-shrink-0',
              isRecording
                ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30 animate-pulse'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            )}
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          {isLoading ? (
            <button
              onClick={stop}
              className="p-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-lg transition-colors flex-shrink-0"
              title={t.aiSidebar.stop}
            >
              <X size={16} />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="p-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const { language } = useLanguageStore()
  const tr = useT()
  const isUser = msg.role === 'user'
  const doneTools = msg.toolCalls?.filter((t) => t.status === 'done') ?? []
  const runningTools = msg.toolCalls?.filter((t) => t.status === 'running') ?? []
  const errorTools = msg.toolCalls?.filter((t) => t.status === 'error') ?? []

  return (
    <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      {/* Tool call activity log (only for assistant messages) */}
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="w-full max-w-[95%] rounded-xl bg-slate-800/50 border border-slate-700/50 px-3 py-2.5 space-y-1.5">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              {language === 'en' ? 'AI actions' : language === 'be' ? 'Дзеянні AI' : 'Действия AI'}
            </span>
            {msg.durationMs && (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-600">
                <Clock size={9} />
                {(msg.durationMs / 1000).toFixed(1)}с
              </span>
            )}
          </div>

          {/* Done tools */}
          {doneTools.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2">
              <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
              <span className="text-xs text-slate-400 flex-1 min-w-0 truncate">{toolLabel(tc.name, language)}</span>
              {tc.durationMs !== undefined && (
                <span className="text-[10px] text-slate-600 flex-shrink-0">{tc.durationMs}{tr.aiSidebar.ms}</span>
              )}
            </div>
          ))}

          {/* Running tools */}
          {runningTools.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2">
              <Loader2 size={12} className="text-primary-400 animate-spin flex-shrink-0" />
              <span className="text-xs text-primary-300 flex-1 min-w-0">
                {toolLabel(tc.name, language)}
                <span className="animate-ellipsis">…</span>
              </span>
              <RunningTimer startedAt={tc.startedAt} />
            </div>
          ))}

          {/* Error tools */}
          {errorTools.map((tc) => (
            <div key={tc.id} className="flex items-start gap-2">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-red-400">{toolLabel(tc.name, language)}</span>
                {tc.error && (
                  <p className="text-[10px] text-red-500/70 mt-0.5 truncate">{tc.error}</p>
                )}
              </div>
            </div>
          ))}

          {/* Summary line */}
          {(doneTools.length > 0 || errorTools.length > 0) && runningTools.length === 0 && !msg.isStreaming && (
            <div className="pt-1 mt-0.5 border-t border-slate-700/50 flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">
                {language === 'en'
                  ? `Done: ${doneTools.length} operations${errorTools.length > 0 ? `, ${errorTools.length} errors` : ''}`
                  : language === 'be'
                  ? `Выканана: ${doneTools.length} аперацый${errorTools.length > 0 ? `, ${errorTools.length} памылак` : ''}`
                  : `Выполнено: ${doneTools.length} операций${errorTools.length > 0 ? `, ${errorTools.length} ошибок` : ''}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Thinking placeholder — spinning wheel */}
      {!isUser && msg.isThinking && !msg.content && runningTools.length === 0 && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-800/60 rounded-xl">
          {/* Animated SVG spinner */}
          <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0">
            <circle cx="9" cy="9" r="7" fill="none" stroke="#334155" strokeWidth="2" />
            <circle
              cx="9" cy="9" r="7"
              fill="none"
              stroke="url(#spinGrad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="28"
              strokeDashoffset="20"
              style={{ transformOrigin: '9px 9px', animation: 'spin 0.9s linear infinite' }}
            />
            <defs>
              <linearGradient id="spinGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
          </svg>
          <span className="text-xs text-slate-400">{tr.aiSidebar.thinking}</span>
        </div>
      )}

      {/* Main message bubble */}
      {(msg.content || (!msg.isThinking && !isUser)) && (
        <div
          className={cn(
            'max-w-[90%] rounded-xl px-3 py-2 text-sm',
            isUser
              ? 'bg-primary-600 text-white'
              : 'bg-surface-800 text-slate-200',
          )}
        >
          <MarkdownText text={msg.content} />
          {/* Streaming cursor */}
          {msg.isStreaming && msg.content && (
            <span className="inline-block w-1.5 h-3.5 bg-current ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>
      )}
    </div>
  )
}

// ── Conversation row ──────────────────────────────────────────────────────────

function ConversationRow({
  conv, isActive, onLoad, onDelete,
}: {
  conv: AiConversationSummary
  isActive: boolean
  onLoad: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const t = useT()
  const date = new Date(conv.updatedAt)
  const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

  return (
    <div
      className={cn(
        'group flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
        isActive
          ? 'bg-primary-900/40 text-primary-200'
          : 'hover:bg-slate-800/60 text-slate-300',
      )}
      onClick={onLoad}
    >
      <MessageSquare size={13} className="flex-shrink-0 mt-0.5 opacity-50" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{conv.title}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{dateStr}</p>
      </div>
      {confirmDelete ? (
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-900/30 transition-colors"
          >
            {t.common.delete}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
            className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
          className="flex-shrink-0 p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded"
          title={t.common.delete}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

// ── Running timer ─────────────────────────────────────────────────────────────

function RunningTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100)
    return () => clearInterval(id)
  }, [startedAt])
  return (
    <span className="text-[10px] text-primary-500/60 flex-shrink-0 tabular-nums">
      {(elapsed / 1000).toFixed(1)}с
    </span>
  )
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────

function MarkdownText({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <InlineMd text={line} />
        </span>
      ))}
    </div>
  )
}

function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i}>{part.slice(1, -1)}</em>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="bg-black/30 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

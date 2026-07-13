import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { MobileInstallBanner } from '@/components/layout/MobileInstallBanner'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsCloud, useIsSolo } from '@/stores/instanceStore'
import { CommandPalette, useCommandPalette } from '@/components/layout/CommandPalette'
import { AiSidebar } from '@/components/ai/AiSidebar'
import type { ProjectTemplate } from '@/api/client'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useInstanceStore } from '@/stores/instanceStore'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { projectApi } from '@/api/client'
import { Sparkles, Timer } from 'lucide-react'
import { DashboardPage } from '@/pages/DashboardPage'
import { ProjectPage } from '@/pages/ProjectPage'
import { PageEditorPage } from '@/pages/PageEditorPage'
import { TasksPage } from '@/pages/TasksPage'
import { GraphPage } from '@/pages/GraphPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { BudgetPage } from '@/pages/BudgetPage'
import { NotesPage } from '@/pages/NotesPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { BillingPage } from '@/pages/BillingPage'
import { LoginPage } from '@/pages/LoginPage'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { DrawPage } from '@/pages/DrawPage'
import { FilesPage } from '@/pages/FilesPage'
import { ProjectMemoryPage } from '@/pages/ProjectMemoryPage'
import { ModulesPage } from '@/pages/ModulesPage'
import { CollectionPage } from '@/pages/CollectionPage'
import { ModuleOverviewPage } from '@/pages/ModuleOverviewPage'
import { BrowserPage } from '@/pages/BrowserPage'
import { GrowthPage } from '@/pages/GrowthPage'
import { CanvasPage } from '@/pages/CanvasPage'
import { PublicPagePage } from '@/pages/PublicPagePage'
import { BuyPage } from '@/pages/BuyPage'
import { AdminPage } from '@/pages/AdminPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { VerifyEmailPage } from '@/pages/VerifyEmailPage'
import { HelpPage } from '@/pages/HelpPage'
import { useState, useEffect, useRef } from 'react'
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useTaskReminders } from '@/hooks/useTaskReminders'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Toaster } from '@/components/common/Toaster'
import { QuickCapture } from '@/components/common/QuickCapture'
import { KeyboardShortcutsOverlay } from '@/components/common/KeyboardShortcutsOverlay'
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { PomodoroTimer } from '@/components/common/PomodoroTimer'
import { OnboardingModal } from '@/components/common/OnboardingModal'

import { initTheme } from '@/stores/themeStore'
import { initAccent } from '@/stores/accentStore'
import { useLanguageStore } from '@/stores/languageStore'
import { useBillingStore } from '@/stores/billingStore'
import { authApi } from '@/api/auth'
import { projectDisplayName } from '@/lib/projectName'

// Init theme and accent color before render
initTheme()
initAccent()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        const status = (error as { response?: { status?: number } })?.response?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 1
      },
      staleTime: 30_000,
    },
  },
})

function ProjectSourcesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  return <FilesPage projectId={projectId} />
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  const location = useLocation()
  if (!isAuthenticated) {
    // Remember a non-trivial target (e.g. a /modules?install=… deep-link from
    // the landing) so the user lands there after logging in.
    try {
      const target = location.pathname + location.search
      if (location.pathname !== '/') sessionStorage.setItem('redirectAfterLogin', target)
    } catch { /* sessionStorage unavailable */ }
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function useAiContext() {
  const { currentWorkspaceId, currentProjectId } = useWorkspaceStore()

  const { data: project } = useQuery({
    queryKey: ['project', currentProjectId],
    queryFn: () => projectApi.getById(currentProjectId!),
    enabled: !!currentProjectId,
    staleTime: 60_000,
  })

  const { language } = useLanguageStore()

  return {
    workspaceId: currentWorkspaceId ?? undefined,
    projectId: currentProjectId ?? undefined,
    // The system Inbox stores a Russian name; resolve it like everywhere else.
    projectName: projectDisplayName(project, language) || undefined,
  }
}

// A frozen account keeps working for reading; only writes are refused. The
// banner is permanent, not a toast: the user needs it on screen when he wonders
// why nothing saves, which may be several clicks after the rejected write.
function FrozenBanner() {
  const frozen = useBillingStore((s) => s.frozen)
  const navigate = useNavigate()
  const { language } = useLanguageStore()
  if (!frozen) return null

  // The same wall greets a brand-new account and one that fell behind: in both
  // cases the month is unpaid. Say it in a way that fits either.
  const text = language === 'en'
    ? 'Writing is on hold: the current month of cloud hosting is unpaid. Your data is safe — reading, search and export still work. Top up your balance and it resumes at once.'
    : language === 'be'
    ? 'Запіс прыпынены: бягучы месяц воблака не аплачаны. Даныя на месцы — чытанне, пошук і экспарт працуюць. Папоўніце баланс.'
    : 'Запись приостановлена: текущий месяц облака не оплачен. Данные на месте — чтение, поиск и экспорт работают. Пополните баланс, и запись сразу вернётся.'

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-sm text-amber-200">
      <span className="flex-1">{text}</span>
      <button
        onClick={() => navigate('/billing')}
        className="text-xs font-medium px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 transition-colors flex-shrink-0"
      >
        {language === 'en' ? 'Top up' : language === 'be' ? 'Папоўніць' : 'Пополнить'}
      </button>
    </div>
  )
}

function AppShell() {
  const { sidebarOpen, setSidebarOpen } = useUIStore()
  const isMobile = useIsMobile()
  const cloud = useIsCloud()
  const solo = useIsSolo()
  // The dedicated mobile app experience (bottom nav + full-screen chat) is our
  // cloud-only feature. Self-hosted on a phone keeps the regular drawer layout.
  const mobileApp = isMobile && cloud
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette()

  // On the phone the assistant IS the home screen — open it once when the mobile
  // app kicks in. Closing it (✕) drops to the dashboard; the bottom nav reopens it.
  const chatAutoOpened = useRef(false)
  const { currentWorkspaceId } = useWorkspaceStore()
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiSidebarWidth, setAiSidebarWidth] = useState(0)
  const [pomodoroOpen, setPomodoroOpen] = useState(false)
  const [aiInitialTemplate, setAiInitialTemplate] = useState<ProjectTemplate | undefined>()
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>()
  const [aiInitialInstructions, setAiInitialInstructions] = useState<string | undefined>()
  const [aiInitialTemplateName, setAiInitialTemplateName] = useState<string | undefined>()
  const [aiInitialGenTasks, setAiInitialGenTasks] = useState<boolean>(true)
  const [aiInitialGenNotes, setAiInitialGenNotes] = useState<boolean>(true)
  const aiContext = useAiContext()

  useEffect(() => {
    if (mobileApp && !chatAutoOpened.current) {
      chatAutoOpened.current = true
      setAiOpen(true)
    }
  }, [mobileApp])

  // Ask the server once per session: a freeze may predate this browser tab.
  useEffect(() => {
    authApi.me()
      .then((me) => useBillingStore.getState().setFrozen(!!me.frozenAt))
      .catch(() => {})
  }, [])

  useRealtimeUpdates(currentWorkspaceId)
  useKeyboardShortcuts({ onOpenSearch: () => setPaletteOpen(true) })
  useTaskReminders()

  // Ctrl+Shift+A — toggle AI sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setAiOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // F1 — open help page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        navigate('/help')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // ai:open event from slash command / templates page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ template?: ProjectTemplate; prompt?: string; instructions?: string; templateName?: string; genTasks?: boolean; genNotes?: boolean }>).detail
      if (detail?.template) setAiInitialTemplate(detail.template)
      if (detail?.prompt) setAiInitialPrompt(detail.prompt)
      if (detail?.instructions !== undefined) setAiInitialInstructions(detail.instructions)
      if (detail?.templateName !== undefined) setAiInitialTemplateName(detail.templateName)
      setAiInitialGenTasks(detail?.genTasks ?? true)
      setAiInitialGenNotes(detail?.genNotes ?? true)
      setAiOpen(true)
    }
    document.addEventListener('ai:open', handler)
    return () => document.removeEventListener('ai:open', handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && <Sidebar onOpenSearch={() => setPaletteOpen(true)} />}

      <main className="flex-1 flex flex-col min-w-0 overflow-auto" style={{ background: 'var(--bg-app)', paddingBottom: mobileApp ? 'calc(58px + env(safe-area-inset-bottom))' : undefined }}>
        <FrozenBanner />
        <Routes>
          <Route path="/" element={<DashboardPage />} />

          {/* Project routes */}
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/pages" element={<ProjectPage />} />
          <Route path="/projects/:projectId/tasks" element={<TasksPage />} />
          <Route path="/projects/:projectId/graph" element={<GraphPage />} />
          <Route path="/projects/:projectId/calendar" element={<CalendarPage />} />
          <Route path="/projects/:projectId/budget" element={<BudgetPage />} />
          <Route path="/projects/:projectId/notes" element={<NotesPage />} />
          <Route path="/projects/:projectId/sources" element={<ProjectSourcesPage />} />
          <Route path="/projects/:projectId/memory" element={<ProjectMemoryPage />} />
          <Route path="/projects/:projectId/overview" element={<ModuleOverviewPage />} />
          <Route path="/projects/:projectId/c/:collectionId" element={<CollectionPage />} />

          {/* Global routes */}
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/notes" element={<NotesPage />} />

          {/* Page editor */}
          <Route path="/pages/:pageId" element={<PageEditorPage />} />

          {/* Canvas */}
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/canvas/:canvasId" element={<CanvasPage />} />

          {/* Files */}
          <Route path="/files" element={<FilesPage />} />

          {/* Browser */}
          <Route path="/browser" element={<BrowserPage />} />

          <Route path="/growth" element={<GrowthPage />} />
          <Route path="/habits" element={<Navigate to="/growth?tab=habits" replace />} />
          <Route path="/journal" element={<Navigate to="/growth?tab=journal" replace />} />
          <Route path="/okr" element={<Navigate to="/growth?tab=goals" replace />} />

          {/* Settings & Templates */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/admin" element={solo ? <Navigate to="/" replace /> : <AdminPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/draw" element={<DrawPage />} />
          <Route path="/draw/:drawId" element={<DrawPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <AiSidebar
        open={aiOpen}
        fullScreen={mobileApp}
        onClose={() => { setAiOpen(false); setAiInitialTemplate(undefined); setAiInitialPrompt(undefined); setAiInitialInstructions(undefined); setAiInitialTemplateName(undefined); setAiInitialGenTasks(true); setAiInitialGenNotes(true) }}
        context={aiContext}
        initialTemplate={aiInitialTemplate}
        initialTemplateName={aiInitialTemplateName}
        initialPrompt={aiInitialPrompt}
        initialInstructions={aiInitialInstructions}
        initialGenTasks={aiInitialGenTasks}
        initialGenNotes={aiInitialGenNotes}
        onWidthChange={setAiSidebarWidth}
      />

      {/* Pomodoro timer */}
      {pomodoroOpen && <PomodoroTimer onClose={() => setPomodoroOpen(false)} />}

      {/* AI toggle button — hidden in the mobile app (the bottom nav owns chat). */}
      <div className={cn('fixed bottom-6 z-50 flex items-center gap-2 transition-[right] duration-300', mobileApp && 'hidden')} style={{ right: `${aiSidebarWidth + 24}px` }}>
        <button
          onClick={() => setPomodoroOpen((v) => !v)}
          title="Pomodoro Timer"
          className="flex items-center gap-1.5 px-3 py-2.5 text-white rounded-full shadow-xl transition-all hover:scale-105 bg-slate-700 hover:bg-slate-600"
        >
          <Timer size={16} />
        </button>
        {!aiOpen && (
          <button
            onClick={() => setAiOpen(true)}
            title="AI Assistant (Ctrl+Shift+A)"
            className="flex items-center gap-2 px-4 py-2.5 text-white rounded-full shadow-xl transition-all hover:scale-105 hover:shadow-primary-700/40"
            style={{ background: 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)', boxShadow: '0 4px 20px rgb(var(--color-primary-500) / 0.35)' }}
          >
            <Sparkles size={16} />
            <span className="text-sm font-medium">AI</span>
          </button>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickCapture />
      <KeyboardShortcutsOverlay />
      <OnboardingModal />

      {/* Phone bottom navigation (our cloud only) — chat / home / projects. The
          install nudge sits just above it; the chat covers both when open. */}
      {mobileApp && !aiOpen && <MobileInstallBanner bottomOffset={58} />}
      {mobileApp && (
        <MobileNav
          chatOpen={aiOpen}
          onOpenChat={() => setAiOpen(true)}
          onOpenProjects={() => setSidebarOpen(true)}
        />
      )}
    </div>
  )
}

export default function App() {
  const { isAuthenticated } = useAuthStore()

  // Read the instance kind (cloud vs self-hosted) once at boot — gates the
  // mobile app shell and PWA install.
  useEffect(() => { useInstanceStore.getState().load() }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={
            isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
          } />
          <Route path="/forgot-password" element={
            isAuthenticated ? <Navigate to="/" replace /> : <ForgotPasswordPage />
          } />
          <Route path="/reset-password" element={
            isAuthenticated ? <Navigate to="/" replace /> : <ResetPasswordPage />
          } />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {/* Public shared pages — no auth */}
          <Route path="/p/:token" element={<PublicPagePage />} />
          {/* Public checkout — no auth (buyer needs only an email) */}
          <Route path="/buy" element={<BuyPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
      <Toaster />
      <OfflineIndicator />
    </QueryClientProvider>
  )
}

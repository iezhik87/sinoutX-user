import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  sidebarWidth: number
  expandedProjects: Set<string>
  quickCaptureOpen: boolean
  shortcutsOverlayOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (w: number) => void
  toggleProject: (projectId: string) => void
  expandProject: (projectId: string) => void
  toggleQuickCapture: () => void
  setQuickCaptureOpen: (open: boolean) => void
  toggleShortcutsOverlay: () => void
  setShortcutsOverlayOpen: (open: boolean) => void
}

const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: !isMobile(),
  sidebarWidth: 260,
  expandedProjects: new Set(),
  quickCaptureOpen: false,
  shortcutsOverlayOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  toggleProject: (id) =>
    set((s) => {
      const next = new Set(s.expandedProjects)
      next.has(id) ? next.delete(id) : next.add(id)
      return { expandedProjects: next }
    }),
  expandProject: (id) =>
    set((s) => {
      const next = new Set(s.expandedProjects)
      next.add(id)
      return { expandedProjects: next }
    }),
  toggleQuickCapture: () => set((s) => ({ quickCaptureOpen: !s.quickCaptureOpen })),
  setQuickCaptureOpen: (open) => set({ quickCaptureOpen: open }),
  toggleShortcutsOverlay: () => set((s) => ({ shortcutsOverlayOpen: !s.shortcutsOverlayOpen })),
  setShortcutsOverlayOpen: (open) => set({ shortcutsOverlayOpen: open }),
}))

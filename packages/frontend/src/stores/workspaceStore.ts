import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Workspace, Project } from '@/api/client'

interface WorkspaceState {
  currentWorkspaceId: string | null
  currentProjectId: string | null
  workspaces: Workspace[]
  projects: Project[]

  setCurrentWorkspace: (id: string | null) => void
  setCurrentProject: (id: string | null) => void
  setWorkspaces: (workspaces: Workspace[]) => void
  setProjects: (projects: Project[]) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      currentProjectId: null,
      workspaces: [],
      projects: [],

      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
      setCurrentProject: (id) => set({ currentProjectId: id }),
      setWorkspaces: (workspaces) => set({ workspaces }),
      setProjects: (projects) => set({ projects }),
      reset: () => set({ currentWorkspaceId: null, currentProjectId: null, workspaces: [], projects: [] }),
    }),
    {
      name: 'sinoutx-workspace',
      partialize: (s) => ({
        currentWorkspaceId: s.currentWorkspaceId,
        currentProjectId: s.currentProjectId,
      }),
    },
  ),
)

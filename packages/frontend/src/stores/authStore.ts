import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/api/client'
import { useWorkspaceStore } from './workspaceStore'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  /** Set when a cloud bill went unpaid: reads work, writes are refused. */
  frozenAt?: string | null
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean

  setAuth: (token: string, user: AuthUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      setAuth: (token, user) => {
        // Reset workspace when switching users
        const prevUser = useAuthStore.getState().user
        if (prevUser && prevUser.id !== user.id) {
          useWorkspaceStore.getState().reset()
        }
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        set({ token, user, isAuthenticated: true })
      },

      logout: () => {
        delete api.defaults.headers.common['Authorization']
        useWorkspaceStore.getState().reset()
        set({ token: null, user: null, isAuthenticated: false })
      },
    }),
    {
      name: 'sinoutx-auth',
      onRehydrateStorage: () => (state) => {
        // Restore axios token after page reload
        if (state?.token) {
          api.defaults.headers.common['Authorization'] = `Bearer ${state.token}`
        }
      },
    },
  ),
)

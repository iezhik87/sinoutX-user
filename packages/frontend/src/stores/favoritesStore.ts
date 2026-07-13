import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FavoriteType = 'page' | 'project' | 'note'

export interface Favorite {
  id: string
  type: FavoriteType
  title: string
  url: string
  icon?: string
  addedAt: string
}

interface FavoritesState {
  favorites: Favorite[]
  add: (fav: Omit<Favorite, 'addedAt'>) => void
  remove: (id: string) => void
  has: (id: string) => boolean
  toggle: (fav: Omit<Favorite, 'addedAt'>) => void
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],

      add: (fav) => {
        if (get().has(fav.id)) return
        set((s) => ({
          favorites: [
            { ...fav, addedAt: new Date().toISOString() },
            ...s.favorites,
          ].slice(0, 20), // max 20 favorites
        }))
      },

      remove: (id) => set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) })),

      has: (id) => get().favorites.some((f) => f.id === id),

      toggle: (fav) => {
        if (get().has(fav.id)) get().remove(fav.id)
        else get().add(fav)
      },
    }),
    { name: 'sinoutx-favorites' },
  ),
)

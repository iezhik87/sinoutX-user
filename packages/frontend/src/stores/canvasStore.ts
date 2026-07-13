import { create } from 'zustand'
import type { CanvasNode } from '@/api/client'

interface PendingNode {
  node: Omit<CanvasNode, 'id' | 'position'>
  canvasId?: string
}

interface CanvasStore {
  pending: PendingNode | null
  setPending: (node: PendingNode | null) => void
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}))

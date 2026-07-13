import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'

interface Options {
  onOpenSearch?: () => void
}

/** Returns true if the event target is an editable field */
function isEditable(target: EventTarget | null): boolean {
  if (!target) return false
  const el = target as HTMLElement
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

export function useKeyboardShortcuts(options?: Options) {
  const navigate = useNavigate()
  const { toggleSidebar, toggleQuickCapture, toggleShortcutsOverlay } = useUIStore()

  // "g" prefix navigation — track if "g" was pressed within last 800ms
  const gPressedAt = useRef<number>(0)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // ── Ctrl/Cmd shortcuts (work everywhere) ──────────────────────────────
      if (ctrl) {
        // Ctrl+K — search / command palette
        if (e.key === 'k') {
          e.preventDefault()
          options?.onOpenSearch?.()
          return
        }
        // Ctrl+\ — toggle sidebar
        if (e.key === '\\') {
          e.preventDefault()
          toggleSidebar()
          return
        }
        // Ctrl+Shift+Space — quick capture
        if (e.shiftKey && e.code === 'Space') {
          e.preventDefault()
          toggleQuickCapture()
          return
        }
        return
      }

      // ── Non-input shortcuts ────────────────────────────────────────────────
      if (isEditable(e.target)) return

      // ? — keyboard shortcuts overlay
      if (e.key === '?') {
        e.preventDefault()
        toggleShortcutsOverlay()
        return
      }

      // ESC — close overlays
      if (e.key === 'Escape') {
        useUIStore.getState().setQuickCaptureOpen(false)
        useUIStore.getState().setShortcutsOverlayOpen(false)
        return
      }

      // "g" prefix navigation (like Gmail / GitHub)
      const now = Date.now()
      if (e.key === 'g') {
        gPressedAt.current = now
        return
      }
      if (now - gPressedAt.current < 800) {
        gPressedAt.current = 0
        switch (e.key) {
          case 'h': navigate('/'); break
          case 'n': navigate('/notes'); break
          case 'c': navigate('/calendar'); break
          case 'g': navigate('/graph'); break
          case 's': navigate('/settings'); break
          case 't': navigate('/templates'); break
        }
        return
      }
    },
    [navigate, options, toggleSidebar, toggleQuickCapture, toggleShortcutsOverlay],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

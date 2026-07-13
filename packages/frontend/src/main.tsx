import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'


class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#f87171', background: '#0f172a', minHeight: '100vh' }}>
          <h2 style={{ color: '#ef4444', fontSize: 18 }}>⛔ React Error</h2>
          <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {e.message}{'\n\n'}{e.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Remove the LEGACY cache-first worker (it pinned browsers to a stale bundle),
// but spare the new network-first /app-sw.js that lib/pwa registers on our cloud.
// That worker cleans old caches itself on activate, so no blanket cache wipe here
// (which would also drop the new worker's cache).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => {
      const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || ''
      if (!url.endsWith('/app-sw.js')) r.unregister().catch(() => {/* ignore */})
    }))
    .catch(() => {/* ignore */})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

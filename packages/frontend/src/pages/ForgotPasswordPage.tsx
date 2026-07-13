import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Brain, Loader2, ArrowLeft, Mail } from 'lucide-react'
import { api } from '@/api/client'
import { useT } from '@/i18n/useT'

export function ForgotPasswordPage() {
  const t = useT()
  const a = t.auth
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? a.forgotPasswordError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <Brain size={22} className="text-white" />
          </div>
          <span className="text-2xl font-bold text-slate-100 tracking-tight">SinoutX</span>
        </div>

        <div className="bg-surface-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-4">
                <Mail size={22} className="text-green-400" />
              </div>
              <h1 className="text-xl font-semibold text-slate-100 mb-2">{a.forgotPasswordSentTitle}</h1>
              <p className="text-sm text-slate-400 mb-6">
                {a.forgotPasswordSentDesc.replace('{email}', email).split(email).length > 1
                  ? <>{a.forgotPasswordSentDesc.split('{email}')[0]}<span className="text-slate-200">{email}</span>{a.forgotPasswordSentDesc.split('{email}')[1]}</>
                  : a.forgotPasswordSentDesc}
              </p>
              <Link to="/login" className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center justify-center gap-1.5">
                <ArrowLeft size={14} /> {a.backToLogin}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-slate-100 mb-1">{a.forgotPasswordTitle}</h1>
              <p className="text-sm text-slate-500 mb-6">{a.forgotPasswordDesc}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Email</label>
                  <input
                    autoFocus type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null) }}
                    placeholder="you@example.com" required
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? <><Loader2 size={14} className="animate-spin" /> {a.forgotPasswordSending}</> : a.forgotPasswordBtn}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-slate-800 text-center">
                <Link to="/login" className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center justify-center gap-1.5">
                  <ArrowLeft size={14} /> {a.backToLogin}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

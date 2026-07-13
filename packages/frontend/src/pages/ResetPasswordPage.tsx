import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Brain, Loader2, Eye, EyeOff, CheckCircle, ArrowLeft } from 'lucide-react'
import { api } from '@/api/client'
import { useT } from '@/i18n/useT'

export function ResetPasswordPage() {
  const t = useT()
  const a = t.auth
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">{a.resetPasswordInvalidLink}</p>
          <Link to="/login" className="text-primary-400 hover:text-primary-300 text-sm flex items-center justify-center gap-1.5">
            <ArrowLeft size={14} /> {a.backToLogin}
          </Link>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError(a.resetPasswordMismatch)
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? a.resetPasswordError)
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
          {done ? (
            <div className="text-center">
              <CheckCircle size={40} className="text-green-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-slate-100 mb-2">{a.resetPasswordDoneTitle}</h1>
              <p className="text-sm text-slate-400">{a.resetPasswordDoneDesc}</p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-slate-100 mb-1">{a.resetPasswordTitle}</h1>
              <p className="text-sm text-slate-500 mb-6">{a.resetPasswordDesc}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">{a.resetPasswordNewLabel}</label>
                  <div className="relative">
                    <input
                      autoFocus type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(null) }}
                      placeholder={a.resetPasswordNewPlaceholder} required minLength={8}
                      className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">{a.resetPasswordConfirmLabel}</label>
                  <input
                    type={showPassword ? 'text' : 'password'} value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setError(null) }}
                    placeholder={a.resetPasswordConfirmPlaceholder} required
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? <><Loader2 size={14} className="animate-spin" /> {a.resetPasswordSaving}</> : a.resetPasswordBtn}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

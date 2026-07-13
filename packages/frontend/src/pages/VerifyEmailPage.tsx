import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useT } from '@/i18n'

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const t = useT()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')

  useEffect(() => {
    if (!token) { setStatus('error'); return }
    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'))
  }, [token])

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="rounded-2xl bg-white p-1.5 shadow-md flex-shrink-0">
            <img src="/logo.png" alt="SinoutX" className="h-14 w-auto" />
          </div>
          <span className="text-2xl font-bold text-slate-100 tracking-tight">SinoutX</span>
        </div>

        <div className="bg-surface-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          {status === 'loading' && (
            <>
              <Loader2 size={40} className="text-primary-400 animate-spin mx-auto mb-4" />
              <p className="text-sm text-slate-400">{t.auth.verifyEmailLoading}</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle size={40} className="text-green-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-slate-100 mb-2">{t.auth.verifyEmailSuccess}</h1>
              <p className="text-sm text-slate-400 mb-6">{t.auth.verifyEmailSuccessDesc}</p>
              <Link to="/login"
                className="inline-block px-6 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium transition-colors">
                {t.auth.backToLogin}
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle size={40} className="text-red-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-slate-100 mb-2">{t.auth.verifyEmailTitle}</h1>
              <p className="text-sm text-slate-400 mb-6">{t.auth.verifyEmailError}</p>
              <Link to="/login"
                className="text-sm text-primary-400 hover:text-primary-300 transition-colors">
                {t.auth.backToLogin}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

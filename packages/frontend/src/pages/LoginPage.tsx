import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Loader2, ShieldCheck, Mail } from 'lucide-react'
import { authApi } from '@/api/auth'
import { twoFactorApi } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toastStore'

type Mode = 'login' | 'register'
type Step = 'credentials' | 'totp' | 'verify-sent'

// Where to go after a successful login: a deep-link saved by ProtectedRoute, else home.
function postLoginTarget(): string {
  try {
    const saved = sessionStorage.getItem('redirectAfterLogin')
    if (saved) { sessionStorage.removeItem('redirectAfterLogin'); return saved }
  } catch { /* sessionStorage unavailable */ }
  return '/'
}

export function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const t = useT()

  // Arriving from an invitation email: /register?invite=… or /login?invite=…
  // Open straight on the sign-up form — the visitor has no account yet, and
  // showing them a login box first is a small insult.
  const inviteToken = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [mode, setMode] = useState<Mode>(inviteToken ? 'register' : 'login')
  const [step, setStep] = useState<Step>('credentials')
  const [tempToken, setTempToken] = useState('')
  const [totpCode, setTotpCode] = useState('')

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsVerify, setNeedsVerify] = useState(false)

  const [form, setForm] = useState({ email: '', name: '', password: '', inviteCode: '' })

  function updateField(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      setError(null)
    }
  }

  async function handleResend() {
    try {
      await authApi.resendVerification(form.email)
      setStep('verify-sent')
      setError(null)
      setNeedsVerify(false)
    } catch { /* resend is best-effort */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNeedsVerify(false)
    try {
      let res
      if (mode === 'login') {
        res = await authApi.login(form.email, form.password)
        if ('requiresTOTP' in res && res.requiresTOTP) {
          setTempToken(res.tempToken)
          setStep('totp')
          return
        }
      } else {
        res = await authApi.register({
          email: form.email, name: form.name, password: form.password,
          inviteCode: form.inviteCode || undefined,
          invite: inviteToken || undefined,
        })
        if ('requiresVerification' in res && res.requiresVerification) {
          if (res.invites?.refused) {
            toast.error(res.invites.joined ? t.auth.invitePartlyRefused : t.auth.inviteRefused)
          }
          setStep('verify-sent')
          return
        }
      }
      if ('token' in res) {
        // Приглашение могло не сработать: мест по тарифу не осталось. Молчать
        // тут нельзя — человек заводит аккаунт ради доступа, не находит его и
        // считает, что сломался продукт.
        const inv = 'invites' in res ? res.invites : undefined
        if (inv?.refused) {
          toast.error(
            inv.joined
              ? t.auth.invitePartlyRefused
              : t.auth.inviteRefused,
          )
        }
        setAuth(res.token, res.user)
        navigate(postLoginTarget(), { replace: true })
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : t.auth.loginError
      const msg = /too_many_attempts/i.test(raw) ? t.auth.tooManyAttempts : raw
      setError(msg)
      if (/verif|verified|подтвержд|пацверд/i.test(msg)) setNeedsVerify(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await twoFactorApi.verifyLogin(tempToken, totpCode)
      setAuth(res.token, res.user)
      navigate(postLoginTarget(), { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid code'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="rounded-2xl bg-white p-1.5 shadow-md flex-shrink-0">
            <img src="/logo.png" alt="SinoutX" className="h-14 w-auto" />
          </div>
          <span className="text-2xl font-bold text-slate-100 tracking-tight">SinoutX</span>
        </div>

        <div className="bg-surface-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {step === 'verify-sent' ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center mx-auto mb-4">
                <Mail size={22} className="text-primary-400" />
              </div>
              <h1 className="text-xl font-semibold text-slate-100 mb-2">{t.auth.emailSent}</h1>
              <p className="text-sm text-slate-400 mb-6">{t.auth.emailSentDesc}</p>
              <button onClick={() => { setStep('credentials'); setMode('login'); setError(null) }}
                className="text-sm text-primary-400 hover:text-primary-300 transition-colors">
                {t.auth.backToLogin}
              </button>
            </div>
          ) : step === 'totp' ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={18} className="text-primary-400" />
                <h1 className="text-xl font-semibold text-slate-100">{t.settings.security.twoFactor.loginTitle}</h1>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                {t.settings.security.twoFactor.loginDesc}
              </p>
              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <input
                  autoFocus type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  value={totpCode} onChange={e => { setTotpCode(e.target.value); setError(null) }}
                  placeholder={t.settings.security.twoFactor.codePlaceholder} required
                  className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all tracking-widest text-center text-lg"
                />
                {error && (
                  <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
                )}
                <button type="submit" disabled={loading || totpCode.length < 6}
                  className="w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? <><Loader2 size={14} className="animate-spin" /> {t.common.loading}</> : t.settings.security.twoFactor.verifyLoginBtn}
                </button>
                <button type="button" onClick={() => { setStep('credentials'); setError(null); setTotpCode('') }}
                  className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  {t.settings.security.twoFactor.backToLogin}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-slate-100 mb-1">
                {mode === 'login' ? t.auth.signIn : t.auth.createAccount}
              </h1>
              <p className="text-sm text-slate-500 mb-6">
                {mode === 'login' ? t.auth.signInDesc : t.auth.createAccountDesc}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">{t.auth.name}</label>
                    <input
                      autoFocus type="text" value={form.name} onChange={updateField('name')}
                      placeholder={t.auth.namePlaceholder} required
                      className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">{t.auth.email}</label>
                  <input
                    autoFocus={mode === 'login'} type="email" value={form.email} onChange={updateField('email')}
                    placeholder="you@example.com" required
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-400">{t.auth.password}</label>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} value={form.password} onChange={updateField('password')}
                      placeholder={mode === 'register' ? t.auth.passwordPlaceholder : '••••••••'}
                      required minLength={mode === 'register' ? 8 : undefined}
                      className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">
                      {t.auth.inviteCode} <span className="text-slate-600">{t.auth.inviteCodeHint}</span>
                    </label>
                    <input
                      type="text" value={form.inviteCode} onChange={updateField('inviteCode')}
                      placeholder={t.auth.inviteCodePlaceholder}
                      className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                  </div>
                )}

                {error && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                    {error}
                    {needsVerify && (
                      <button type="button" onClick={handleResend}
                        className="block mt-1.5 text-primary-400 hover:text-primary-300 font-medium transition-colors">
                        {t.auth.resendVerification} →
                      </button>
                    )}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className={cn('w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed')}>
                  {loading ? (
                    <><Loader2 size={14} className="animate-spin" /> {t.common.loading}</>
                  ) : mode === 'login' ? t.auth.signInBtn : t.auth.createAccountBtn}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-slate-800 text-center space-y-2">
                <div>
                  <span className="text-sm text-slate-500">
                    {mode === 'login' ? t.auth.noAccount : t.auth.hasAccount}
                  </span>
                  <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
                    className="ml-2 text-sm text-primary-400 hover:text-primary-300 font-medium transition-colors">
                    {mode === 'login' ? t.auth.register : t.auth.signInBtn}
                  </button>
                </div>
                {mode === 'login' && (
                  <div>
                    <Link to="/forgot-password" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
                      {t.auth.forgotPassword}
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">{t.auth.tagline}</p>
      </div>
    </div>
  )
}

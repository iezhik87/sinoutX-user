import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, Sparkles, Check, ArrowLeft, ShieldCheck, Copy, CheckCheck, KeyRound } from 'lucide-react'
import { billingApi } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useLanguageStore } from '@/stores/languageStore'
import { useT } from '@/i18n'

// Team is the only licence sold. Solo work is free; the cloud is billed from
// the wallet, not from a licence key.
type Plan = 'team'

// After payment NOWPayments redirects back to /buy?order=<id>. We poll the order
// until the IPN webhook has issued the key, show it on screen (copy), and let the
// buyer activate it directly — so delivery never depends on email.
function OrderSuccess({ orderId }: { orderId: string }) {
  const { language } = useLanguageStore()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const { data } = useQuery({
    queryKey: ['billing-order', orderId],
    queryFn: () => billingApi.getOrder(orderId),
    refetchInterval: (q) => (q.state.data?.status === 'ready' ? false : 4000),
  })
  const ready = data?.status === 'ready'
  const key = ready ? data.key : ''

  const activateMut = useMutation({
    mutationFn: () => billingApi.activateLicense(key),
    onSuccess: () => navigate('/'),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  })
  const copy = () => { navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: 'var(--bg-app, #0b1120)' }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-surface-900 shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-600/20"><Check size={20} className="text-emerald-400" /></div>
          <p className="text-base font-semibold text-slate-100">{L('Payment received', 'Оплата получена', 'Аплата атрымана')}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!ready ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
              <Loader2 size={16} className="animate-spin" />
              {L('Confirming the payment — your key will appear here automatically.', 'Подтверждаем платёж — ключ появится здесь автоматически.', 'Пацвярджаем плацёж — ключ з\'явіцца тут аўтаматычна.')}
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm text-slate-300 mb-1.5">{L('Your license key', 'Ваш лицензионный ключ', 'Ваш ліцэнзійны ключ')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-emerald-300 font-mono break-all">{key}</code>
                  <button onClick={copy} className="btn-ghost p-2.5 flex-shrink-0" title={L('Copy', 'Копировать', 'Капіраваць')}>
                    {copied ? <CheckCheck size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
              {err && <p className="text-sm text-red-400">{err}</p>}
              {isAuthenticated ? (
                <button onClick={() => activateMut.mutate()} disabled={activateMut.isPending}
                  className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 transition-colors">
                  {activateMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  {L('Activate now', 'Активировать сейчас', 'Актываваць зараз')}
                </button>
              ) : (
                <button onClick={() => navigate(`/settings?key=${encodeURIComponent(key)}`)}
                  className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg px-4 py-2.5 transition-colors">
                  <KeyRound size={16} /> {L('Sign in & activate', 'Войти и активировать', 'Увайсці і актываваць')}
                </button>
              )}
              <p className="text-center text-xs text-slate-600">{L('The key is also in your email (check spam).', 'Ключ также в письме (проверьте спам).', 'Ключ таксама ў лісце (праверце спам).')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const PLAN_META: Record<Plan, { price: string }> = {
  team: { price: '$149' },
}

export function BuyPage() {
  const [params] = useSearchParams()
  const orderId = params.get('order')
  return orderId ? <OrderSuccess orderId={orderId} /> : <BuyForm />
}

function BuyForm() {
  const t = useT()
  const b = t.buy

  // ?plan= is kept for old links; there is nothing else to choose.
  const plan: Plan = 'team'
  const meta = PLAN_META[plan]

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function handlePay() {
    if (!emailValid || loading) return
    setLoading(true)
    setError('')
    try {
      const { invoiceUrl } = await billingApi.createInvoice(plan, email.trim())
      window.location.href = invoiceUrl
    } catch (err) {
      const e = err as { response?: { status?: number } }
      setError(e?.response?.status === 503 ? b.unavailable : b.error)
      setLoading(false)
    }
  }

  const features = (b.features[plan] as string[]) ?? []

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: 'var(--bg-app, #0b1120)' }}>
      <div className="w-full max-w-md">
        <a
          href="https://sinout.dasp.top/#pricing"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 mb-4 transition-colors"
        >
          <ArrowLeft size={13} /> {b.backToPricing}
        </a>

        <div className="rounded-2xl border border-slate-700 bg-surface-900 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)' }}
            >
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-100">
                {b.teamTitle}
              </p>
              <p className="text-sm text-slate-400">
                <span className="text-lg font-bold text-slate-100">{meta.price}</span>
                {' '}
                {b.oneTime}
              </p>
            </div>
          </div>

          {/* Features */}
          <ul className="px-6 py-4 space-y-2 border-b border-slate-800">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <Check size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                {f}
              </li>
            ))}
          </ul>

          {/* Email + pay */}
          <div className="px-6 py-5 space-y-3">
            <label className="block">
              <span className="text-sm text-slate-300">{b.emailLabel}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePay() }}
                placeholder="you@example.com"
                autoFocus
                className="mt-1.5 w-full bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-primary-500"
              />
            </label>
            <p className="text-xs text-slate-500 leading-relaxed">{b.emailHint}</p>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={handlePay}
              disabled={!emailValid || loading}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {b.payButton}
            </button>
            <p className="text-center text-xs text-slate-600">{b.cryptoNote}</p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          <Link to="/" className="hover:text-slate-400 transition-colors">{b.haveAccount}</Link>
        </p>
      </div>
    </div>
  )
}

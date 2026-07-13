import { useToastStore, type Toast } from '@/stores/toastStore'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = {
  success: <CheckCircle size={15} className="text-green-400 flex-shrink-0" />,
  error: <AlertCircle size={15} className="text-red-400 flex-shrink-0" />,
  warning: <AlertTriangle size={15} className="text-yellow-400 flex-shrink-0" />,
  info: <Info size={15} className="text-primary-400 flex-shrink-0" />,
}

const STYLES = {
  success: 'border-green-600/30 bg-green-600/10',
  error: 'border-red-600/30 bg-red-600/10',
  warning: 'border-yellow-600/30 bg-yellow-600/10',
  info: 'border-primary-600/30 bg-primary-600/10',
}

function ToastItem({ toast }: { toast: Toast }) {
  const { remove } = useToastStore()

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl',
        'animate-in slide-in-from-right-full duration-300',
        'max-w-sm w-full backdrop-blur-sm',
        STYLES[toast.type],
      )}
    >
      {ICONS[toast.type]}
      <p className="text-sm text-slate-200 flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => remove(toast.id)}
        className="text-slate-500 hover:text-slate-200 transition-colors flex-shrink-0 mt-0.5"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function Toaster() {
  const { toasts } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}

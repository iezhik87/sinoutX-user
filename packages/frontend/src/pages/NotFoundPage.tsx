import { Link } from 'react-router-dom'
import { useT } from '@/i18n'

export function NotFoundPage() {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <p className="text-5xl">404</p>
      <p className="text-slate-400">{t.notFound.title}</p>
      <Link to="/" className="btn-primary mt-2">{t.notFound.goHome}</Link>
    </div>
  )
}

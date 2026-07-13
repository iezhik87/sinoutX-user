import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, FileText } from 'lucide-react'
import { pageApi } from '@/api/client'
import { renderIcon } from '@/components/common/EmojiPicker'
import { BlockEditor } from '@/components/editor/BlockEditor'

export function PublicPagePage() {
  const { token } = useParams<{ token: string }>()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-page', token],
    queryFn: () => pageApi.getPublic(token!),
    enabled: !!token,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-950">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-surface-950 gap-3 text-slate-400">
        <FileText size={40} />
        <p className="text-sm">Страница не найдена или доступ закрыт</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-xs text-slate-600 mb-6">{data.project.name}</p>
        <h1 className="flex items-center gap-2.5 text-3xl font-bold text-slate-100 mb-8">
          {data.icon && <span className="text-primary-400 flex-shrink-0">{renderIcon(data.icon, 26, 'text-primary-400', 'FileText')}</span>}
          {data.title}
        </h1>
        <div className="prose prose-invert max-w-none">
          <BlockEditor
            content={data.content ?? { type: 'doc', content: [] }}
            editable={false}
            showToolbar={false}
          />
        </div>
        <p className="mt-12 text-xs text-slate-700">
          Обновлено: {new Date(data.updatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  )
}

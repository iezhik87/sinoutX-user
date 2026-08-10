import React from 'react'
import { useLanguageStore } from '@/stores/languageStore'

// Граница ошибок на уровне контента роутов.
//
// Раньше единственная граница висела вокруг всего <App/>, поэтому краш ОДНОГО
// вида (например, Gantt) заменял экраном ошибки ВЕСЬ интерфейс — сайдбар, Home,
// всё — и вернуться можно было только перезагрузкой. Здесь ошибка остаётся
// внутри области страницы: навигация и остальное приложение живут, а смена
// маршрута сбрасывает ошибку (resetKey), так что перезагрузка не нужна.
interface Props {
  resetKey: string
  children: React.ReactNode
}
interface State {
  error: Error | null
}

const TEXT = {
  ru: {
    title: 'Что-то пошло не так на этой странице',
    body: 'Остальное приложение работает. Вернитесь на главную или попробуйте снова.',
    retry: 'Попробовать снова',
  },
  en: {
    title: 'Something went wrong on this page',
    body: 'The rest of the app is fine. Go back home or try again.',
    retry: 'Try again',
  },
  be: {
    title: 'Нешта пайшло не так на гэтай старонцы',
    body: 'Астатняе прыкладанне працуе. Вярніцеся на галоўную або паспрабуйце зноў.',
    retry: 'Паспрабаваць зноў',
  },
} as const

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    // Ушли на другой маршрут — это свежая попытка, гасим прошлую ошибку.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      // Класс не может звать хук — язык берём из стора напрямую.
      const lang = (useLanguageStore.getState().language ?? 'en') as keyof typeof TEXT
      const t = TEXT[lang] ?? TEXT.en
      return (
        <div className="flex items-center justify-center p-8 h-full">
          <div
            className="max-w-lg w-full rounded-xl border p-6"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t.title}
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              {t.body}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="btn-primary mt-4 text-sm"
            >
              {t.retry}
            </button>
            <pre
              className="mt-4 whitespace-pre-wrap text-xs overflow-x-auto rounded-lg p-3"
              style={{ background: 'var(--bg-app)', color: 'var(--text-muted)' }}
            >
              {this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

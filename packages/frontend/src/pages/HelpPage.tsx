import { useState } from 'react'
import { useLanguageStore } from '@/stores/languageStore'
import type { Localized } from '@/i18n'
import { Header } from '@/components/layout/Header'
import {
  BookOpen, Folder, FileText, CheckSquare, Brain, Layout, Upload,
  Keyboard, Settings, ChevronDown, ChevronRight, Zap, Target,
  Layers, StickyNote, Globe, Search, MessageSquare, Star,
  HelpCircle, Terminal, Image, Link,
  BarChart2, Mic, Timer, Share2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface HelpSection {
  id: string
  icon: React.ReactNode
  color: string
  title: Localized<string>
  content: Localized<React.ReactNode>
}

const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    icon: <Zap size={18} />,
    color: 'text-yellow-400 bg-yellow-400/10',
    title: {
      ru: 'Начало работы',
      en: 'Getting Started',
      be: 'Пачатак працы',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={15} className="text-blue-400" />
                <span className="text-sm font-semibold text-slate-200">Рабочее пространство</span>
              </div>
              <p className="text-xs text-slate-400">Общая область для команды или личного использования. Все проекты, файлы и настройки живут внутри рабочего пространства.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Folder size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Проекты</span>
              </div>
              <p className="text-xs text-slate-400">Контейнеры для задач, страниц, заметок и файлов. Создавай проекты через «+» в боковой панели или с помощью AI.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-purple-400" />
                <span className="text-sm font-semibold text-slate-200">Страницы</span>
              </div>
              <p className="text-xs text-slate-400">Rich-text документы с поддержкой таблиц, изображений, формул LaTeX, диаграмм Mermaid и встроенных карт.</p>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Навигация</p>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Боковая панель слева — доступ ко всем разделам</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Переключение рабочих пространств — кнопка в верхнем левом углу</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Быстрый поиск — <kbd className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">Ctrl+K</kbd></li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Избранное — звёздочка рядом с любым элементом</li>
            </ul>
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={15} className="text-blue-400" />
                <span className="text-sm font-semibold text-slate-200">Workspace</span>
              </div>
              <p className="text-xs text-slate-400">A shared area for your team or personal use. All projects, files and settings live inside a workspace.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Folder size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Projects</span>
              </div>
              <p className="text-xs text-slate-400">Containers for tasks, pages, notes and files. Create projects via the «+» in the sidebar or with AI.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-purple-400" />
                <span className="text-sm font-semibold text-slate-200">Pages</span>
              </div>
              <p className="text-xs text-slate-400">Rich-text documents with tables, images, LaTeX formulas, Mermaid diagrams and embedded maps.</p>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Navigation</p>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Left sidebar — access all sections</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Switch workspaces — button in the top left corner</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Quick search — <kbd className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">Ctrl+K</kbd></li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Favorites — star icon next to any item</li>
            </ul>
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={15} className="text-blue-400" />
                <span className="text-sm font-semibold text-slate-200">Працоўная прастора</span>
              </div>
              <p className="text-xs text-slate-400">Агульная вобласць для каманды або асабістага выкарыстання. Усе праекты, файлы і налады жывуць унутры працоўнай прасторы.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Folder size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Праекты</span>
              </div>
              <p className="text-xs text-slate-400">Кантэйнеры для задач, старонак, нататак і файлаў. Стварай праекты праз «+» у бакавой панэлі або з дапамогай AI.</p>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-purple-400" />
                <span className="text-sm font-semibold text-slate-200">Старонкі</span>
              </div>
              <p className="text-xs text-slate-400">Rich-text дакументы з падтрымкай табліц, малюнкаў, формул LaTeX, дыяграм Mermaid і ўкладзеных карт.</p>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Навігацыя</p>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Бакавая панэль злева — доступ да ўсіх раздзелаў</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Пераключэнне працоўных прастор — кнопка ў верхнім левым куце</li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Хуткі пошук — <kbd className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">Ctrl+K</kbd></li>
              <li className="flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-primary-400 flex-shrink-0" />Абраныя — зорачка побач з любым элементам</li>
            </ul>
          </div>
        </div>
      ),
    },
  },
  {
    id: 'tasks',
    icon: <CheckSquare size={18} />,
    color: 'text-green-400 bg-green-400/10',
    title: {
      ru: 'Задачи и OKR',
      en: 'Tasks & OKR',
      be: 'Задачы і OKR',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <CheckSquare size={15} className="text-green-400" />
                <span className="text-sm font-semibold text-slate-200">Задачи</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Создавай задачи в разделе проекта</li>
                <li>• Устанавливай статус, приоритет и дедлайн</li>
                <li>• Назначай ответственных</li>
                <li>• Дедлайны видны на главной странице</li>
                <li>• Вставляй задачи в страницы через <kbd className="bg-slate-700 px-1 rounded">/</kbd></li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Target size={15} className="text-red-400" />
                <span className="text-sm font-semibold text-slate-200">OKR (Цели)</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• OKR — цели и ключевые результаты</li>
                <li>• Отслеживай прогресс в разделе «Рост»</li>
                <li>• Связывай задачи с целями</li>
                <li>• Просматривай аналитику по задачам</li>
                <li>• Журнал — дневник с датированными записями</li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Статусы задач</p>
            <div className="flex flex-wrap gap-2">
              {['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'].map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">{s}</span>
              ))}
            </div>
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <CheckSquare size={15} className="text-green-400" />
                <span className="text-sm font-semibold text-slate-200">Tasks</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Create tasks in the project section</li>
                <li>• Set status, priority and deadline</li>
                <li>• Assign team members</li>
                <li>• Deadlines are visible on the dashboard</li>
                <li>• Embed tasks in pages via <kbd className="bg-slate-700 px-1 rounded">/</kbd></li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Target size={15} className="text-red-400" />
                <span className="text-sm font-semibold text-slate-200">OKR (Goals)</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• OKR — objectives and key results</li>
                <li>• Track progress in the Growth section</li>
                <li>• Link tasks to objectives</li>
                <li>• View task analytics</li>
                <li>• Journal — dated diary entries</li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Task statuses</p>
            <div className="flex flex-wrap gap-2">
              {['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'].map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">{s}</span>
              ))}
            </div>
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <CheckSquare size={15} className="text-green-400" />
                <span className="text-sm font-semibold text-slate-200">Задачы</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Стварай задачы ў раздзеле праекта</li>
                <li>• Устанаўлівай статус, прыярытэт і тэрмін</li>
                <li>• Прызначай адказных</li>
                <li>• Тэрміны бачны на галоўнай старонцы</li>
                <li>• Уставляй задачы ў старонкі праз <kbd className="bg-slate-700 px-1 rounded">/</kbd></li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Target size={15} className="text-red-400" />
                <span className="text-sm font-semibold text-slate-200">OKR (Мэты)</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• OKR — мэты і ключавыя вынікі</li>
                <li>• Адсочвай прагрэс у раздзеле «Рост»</li>
                <li>• Звязвай задачы з мэтамі</li>
                <li>• Прагляд аналітыкі па задачах</li>
                <li>• Дзённік — датаваныя запісы</li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Статусы задач</p>
            <div className="flex flex-wrap gap-2">
              {['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'].map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">{s}</span>
              ))}
            </div>
          </div>
        </div>
      ),
    },
  },
  {
    id: 'ai',
    icon: <Brain size={18} />,
    color: 'text-primary-400 bg-primary-400/10',
    title: {
      ru: 'Ассистент AI',
      en: 'AI Assistant',
      be: 'Асістэнт AI',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-primary-400" />
                <span className="text-sm font-semibold text-slate-200">Чат с AI</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Кнопка AI в правом нижнем углу</li>
                <li>• Горячая клавиша: <kbd className="bg-slate-700 px-1 rounded text-[10px]">Ctrl+Shift+A</kbd></li>
                <li>• Поиск в интернете и анализ сайтов</li>
                <li>• Создание проекта по шаблону</li>
                <li>• Генерация задач, заметок, страниц</li>
                <li>• Привычки, цели (OKR) и записи в дневник</li>
                <li>• Узлы на доску идей (включая картинки)</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={15} className="text-emerald-400" />
                <span className="text-sm font-semibold text-slate-200">AI в редакторе</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Набери <kbd className="bg-slate-700 px-1 rounded">/</kbd> и выбери «AI: Продолжить»</li>
                <li>• Выдели текст → нажми AI кнопку на тулбаре</li>
                <li>• Улучшить, сократить, расширить, перевести</li>
                <li>• Генерация изображений и видео по тексту</li>
                <li>• Транскрипция аудио через кнопку <Mic size={11} className="inline" /></li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Настройка AI</p>
            <p className="text-xs text-slate-400">Перейди в <strong className="text-slate-300">Настройки → AI</strong> чтобы выбрать провайдера (OpenAI, Anthropic, Groq и др.), указать API ключ и настроить параметры модели.</p>
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-primary-400" />
                <span className="text-sm font-semibold text-slate-200">AI Chat</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• AI button in the bottom right corner</li>
                <li>• Shortcut: <kbd className="bg-slate-700 px-1 rounded text-[10px]">Ctrl+Shift+A</kbd></li>
                <li>• Web search and site analysis</li>
                <li>• Create project from template</li>
                <li>• Generate tasks, notes, pages</li>
                <li>• Habits, goals (OKR) and journal entries</li>
                <li>• Idea-canvas nodes (incl. images)</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={15} className="text-emerald-400" />
                <span className="text-sm font-semibold text-slate-200">AI in Editor</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Type <kbd className="bg-slate-700 px-1 rounded">/</kbd> and select «AI: Continue»</li>
                <li>• Select text → click AI button in the toolbar</li>
                <li>• Improve, shorten, expand, translate</li>
                <li>• Generate images and video from text</li>
                <li>• Audio transcription via <Mic size={11} className="inline" /> button</li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AI Configuration</p>
            <p className="text-xs text-slate-400">Go to <strong className="text-slate-300">Settings → AI</strong> to choose a provider (OpenAI, Anthropic, Groq, etc.), enter your API key and configure model parameters.</p>
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-primary-400" />
                <span className="text-sm font-semibold text-slate-200">Чат з AI</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Кнопка AI ў правым ніжнім куце</li>
                <li>• Гарачая клавіша: <kbd className="bg-slate-700 px-1 rounded text-[10px]">Ctrl+Shift+A</kbd></li>
                <li>• Пошук у інтэрнэце і аналіз сайтаў</li>
                <li>• Стварэнне праекта па шаблоне</li>
                <li>• Генерацыя задач, нататак, старонак</li>
                <li>• Прывычкі, мэты (OKR) і запісы ў дзённік</li>
                <li>• Вузлы на дошку ідэй (у т.л. выявы)</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={15} className="text-emerald-400" />
                <span className="text-sm font-semibold text-slate-200">AI ў рэдактары</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• Набяры <kbd className="bg-slate-700 px-1 rounded">/</kbd> і выбяры «AI: Працягнуць»</li>
                <li>• Выдзелі тэкст → націсні кнопку AI на тулбары</li>
                <li>• Паляпшыць, скараціць, пашырыць, перакласці</li>
                <li>• Генерацыя малюнкаў і відэа па тэксце</li>
                <li>• Транскрыпцыя аўдыё праз кнопку <Mic size={11} className="inline" /></li>
              </ul>
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Налада AI</p>
            <p className="text-xs text-slate-400">Перайдзі ў <strong className="text-slate-300">Налады → AI</strong> каб выбраць правайдэра (OpenAI, Anthropic, Groq і інш.), указаць API ключ і наладзіць параметры мадэлі.</p>
          </div>
        </div>
      ),
    },
  },
  {
    id: 'canvas',
    icon: <Layout size={18} />,
    color: 'text-cyan-400 bg-cyan-400/10',
    title: {
      ru: 'Доска идей (Canvas)',
      en: 'Idea Board (Canvas)',
      be: 'Дошка ідэй (Canvas)',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Типы узлов</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { icon: <StickyNote size={12} />, label: 'Заметки' },
                { icon: <FileText size={12} />, label: 'Страницы' },
                { icon: <CheckSquare size={12} />, label: 'Задачи' },
                { icon: <Upload size={12} />, label: 'Файлы' },
                { icon: <Link size={12} />, label: 'Ссылки' },
                { icon: <Image size={12} />, label: 'Изображения' },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="text-slate-500">{icon}</span> {label}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Управление</p>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>• Добавляй узлы через правую кнопку мыши или панель инструментов</li>
              <li>• Связывай узлы — тяни из кружочка на краю узла</li>
              <li>• Двойной клик на узле — открыть/редактировать</li>
              <li>• Масштаб — колесо мыши или жесты тачпада</li>
              <li>• <kbd className="bg-slate-700 px-1 rounded">Delete</kbd> — удалить выбранный узел</li>
              <li>• Отправка из страницы на доску — кнопка «Canvas» в тулбаре</li>
            </ul>
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Node types</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { icon: <StickyNote size={12} />, label: 'Notes' },
                { icon: <FileText size={12} />, label: 'Pages' },
                { icon: <CheckSquare size={12} />, label: 'Tasks' },
                { icon: <Upload size={12} />, label: 'Files' },
                { icon: <Link size={12} />, label: 'Links' },
                { icon: <Image size={12} />, label: 'Images' },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="text-slate-500">{icon}</span> {label}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Controls</p>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>• Add nodes via right-click or the toolbar</li>
              <li>• Connect nodes — drag from the circle on the node edge</li>
              <li>• Double-click a node to open/edit</li>
              <li>• Zoom — mouse wheel or touchpad gestures</li>
              <li>• <kbd className="bg-slate-700 px-1 rounded">Delete</kbd> — remove selected node</li>
              <li>• Send page to canvas — «Canvas» button in page toolbar</li>
            </ul>
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Тыпы вузлоў</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { icon: <StickyNote size={12} />, label: 'Нататкі' },
                { icon: <FileText size={12} />, label: 'Старонкі' },
                { icon: <CheckSquare size={12} />, label: 'Задачы' },
                { icon: <Upload size={12} />, label: 'Файлы' },
                { icon: <Link size={12} />, label: 'Спасылкі' },
                { icon: <Image size={12} />, label: 'Малюнкі' },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="text-slate-500">{icon}</span> {label}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Кіраванне</p>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>• Дадавай вузлы праз правую кнопку мышы або панэль інструментаў</li>
              <li>• Звязвай вузлы — цягні з кружочка на краі вузла</li>
              <li>• Двайны клік на вузле — адкрыць/рэдагаваць</li>
              <li>• Маштаб — кола мышы або жэсты тачпада</li>
              <li>• <kbd className="bg-slate-700 px-1 rounded">Delete</kbd> — выдаліць выбраны вузел</li>
              <li>• Адпраўка са старонкі на дошку — кнопка «Canvas» у тулбары</li>
            </ul>
          </div>
        </div>
      ),
    },
  },
  {
    id: 'files',
    icon: <Upload size={18} />,
    color: 'text-orange-400 bg-orange-400/10',
    title: {
      ru: 'Файлы и заметки',
      en: 'Files & Notes',
      be: 'Файлы і нататкі',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Upload size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Файлы</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Загружай через вкладку Файлы</li>
                <li>• Поддержка PDF, изображений, видео, аудио</li>
                <li>• Вставляй в страницы как источники</li>
                <li>• AI может анализировать содержимое</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <StickyNote size={15} className="text-yellow-400" />
                <span className="text-sm font-semibold text-slate-200">Заметки</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Быстрые записи без структуры</li>
                <li>• Markdown поддерживается</li>
                <li>• Теги для организации</li>
                <li>• Вставка в страницы через /</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={15} className="text-pink-400" />
                <span className="text-sm font-semibold text-slate-200">Журнал</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Дневник с датированными записями</li>
                <li>• Раздел «Рост → Журнал»</li>
                <li>• Хранит историю мыслей и идей</li>
                <li>• Поддержка форматирования</li>
              </ul>
            </div>
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Upload size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Files</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Upload via the Files tab</li>
                <li>• Supports PDF, images, video, audio</li>
                <li>• Embed in pages as sources</li>
                <li>• AI can analyze content</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <StickyNote size={15} className="text-yellow-400" />
                <span className="text-sm font-semibold text-slate-200">Notes</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Quick notes without structure</li>
                <li>• Markdown is supported</li>
                <li>• Tags for organization</li>
                <li>• Embed in pages via /</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={15} className="text-pink-400" />
                <span className="text-sm font-semibold text-slate-200">Journal</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Dated diary entries</li>
                <li>• Growth → Journal section</li>
                <li>• History of thoughts and ideas</li>
                <li>• Rich formatting support</li>
              </ul>
            </div>
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Upload size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Файлы</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Загружай праз укладку Файлы</li>
                <li>• Падтрымка PDF, малюнкаў, відэа, аўдыё</li>
                <li>• Уставляй у старонкі як крыніцы</li>
                <li>• AI можа аналізаваць змест</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <StickyNote size={15} className="text-yellow-400" />
                <span className="text-sm font-semibold text-slate-200">Нататкі</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Хуткія запісы без структуры</li>
                <li>• Markdown падтрымліваецца</li>
                <li>• Тэгі для арганізацыі</li>
                <li>• Устаўка ў старонкі праз /</li>
              </ul>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={15} className="text-pink-400" />
                <span className="text-sm font-semibold text-slate-200">Дзённік</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>• Датаваныя запісы дзённіка</li>
                <li>• Раздзел «Рост → Дзённік»</li>
                <li>• Гісторыя думак і ідэй</li>
                <li>• Падтрымка фарматавання</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
  },
  {
    id: 'shortcuts',
    icon: <Keyboard size={18} />,
    color: 'text-slate-300 bg-slate-700/40',
    title: {
      ru: 'Горячие клавиши',
      en: 'Keyboard Shortcuts',
      be: 'Гарачыя клавішы',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                group: 'Навигация',
                items: [
                  { keys: ['g', 'h'], desc: 'Главная страница' },
                  { keys: ['g', 'n'], desc: 'Заметки' },
                  { keys: ['g', 's'], desc: 'Настройки' },
                  { keys: ['g', 'g'], desc: 'Граф' },
                  { keys: ['F1'], desc: 'Эта справка' },
                ],
              },
              {
                group: 'Действия',
                items: [
                  { keys: ['Ctrl', 'K'], desc: 'Поиск по проекту' },
                  { keys: ['Ctrl', '⇧', 'A'], desc: 'AI-ассистент' },
                  { keys: ['Ctrl', '⇧', 'Space'], desc: 'Быстрая заметка' },
                  { keys: ['Ctrl', '\\'], desc: 'Боковая панель' },
                  { keys: ['Delete'], desc: 'Удалить узел на доске' },
                ],
              },
              {
                group: 'Редактор',
                items: [
                  { keys: ['/'], desc: 'Команды' },
                  { keys: ['**текст**'], desc: 'Жирный' },
                  { keys: ['_текст_'], desc: 'Курсив' },
                  { keys: ['`код`'], desc: 'Код' },
                  { keys: ['Tab'], desc: 'Вложить' },
                ],
              },
              {
                group: 'Экспорт страницы',
                items: [
                  { keys: ['DOCX'], desc: 'Word документ' },
                  { keys: ['PDF'], desc: 'PDF файл' },
                  { keys: ['MD'], desc: 'Markdown' },
                  { keys: ['Print'], desc: 'Печать' },
                ],
              },
            ].map((g) => (
              <div key={g.group} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{g.group}</p>
                <div className="space-y-1.5">
                  {g.items.map((item) => (
                    <div key={item.desc} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">{item.desc}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.keys.map((k, i) => (
                          <kbd key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded font-mono text-slate-300">{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                group: 'Navigation',
                items: [
                  { keys: ['g', 'h'], desc: 'Dashboard' },
                  { keys: ['g', 'n'], desc: 'Notes' },
                  { keys: ['g', 's'], desc: 'Settings' },
                  { keys: ['g', 'g'], desc: 'Graph' },
                  { keys: ['F1'], desc: 'This help' },
                ],
              },
              {
                group: 'Actions',
                items: [
                  { keys: ['Ctrl', 'K'], desc: 'Search' },
                  { keys: ['Ctrl', '⇧', 'A'], desc: 'AI assistant' },
                  { keys: ['Ctrl', '⇧', 'Space'], desc: 'Quick note' },
                  { keys: ['Ctrl', '\\'], desc: 'Sidebar' },
                  { keys: ['Delete'], desc: 'Remove canvas node' },
                ],
              },
              {
                group: 'Editor',
                items: [
                  { keys: ['/'], desc: 'Commands' },
                  { keys: ['**text**'], desc: 'Bold' },
                  { keys: ['_text_'], desc: 'Italic' },
                  { keys: ['`code`'], desc: 'Code' },
                  { keys: ['Tab'], desc: 'Indent' },
                ],
              },
              {
                group: 'Page export',
                items: [
                  { keys: ['DOCX'], desc: 'Word document' },
                  { keys: ['PDF'], desc: 'PDF file' },
                  { keys: ['MD'], desc: 'Markdown' },
                  { keys: ['Print'], desc: 'Print' },
                ],
              },
            ].map((g) => (
              <div key={g.group} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{g.group}</p>
                <div className="space-y-1.5">
                  {g.items.map((item) => (
                    <div key={item.desc} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">{item.desc}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.keys.map((k, i) => (
                          <kbd key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded font-mono text-slate-300">{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                group: 'Навігацыя',
                items: [
                  { keys: ['g', 'h'], desc: 'Галоўная старонка' },
                  { keys: ['g', 'n'], desc: 'Нататкі' },
                  { keys: ['g', 's'], desc: 'Налады' },
                  { keys: ['g', 'g'], desc: 'Граф' },
                  { keys: ['F1'], desc: 'Гэтая даведка' },
                ],
              },
              {
                group: 'Дзеянні',
                items: [
                  { keys: ['Ctrl', 'K'], desc: 'Пошук' },
                  { keys: ['Ctrl', '⇧', 'A'], desc: 'AI-асістэнт' },
                  { keys: ['Ctrl', '⇧', 'Space'], desc: 'Хуткая нататка' },
                  { keys: ['Ctrl', '\\'], desc: 'Бакавая панэль' },
                  { keys: ['Delete'], desc: 'Выдаліць вузел на дошцы' },
                ],
              },
              {
                group: 'Рэдактар',
                items: [
                  { keys: ['/'], desc: 'Каманды' },
                  { keys: ['**тэкст**'], desc: 'Тоўсты' },
                  { keys: ['_тэкст_'], desc: 'Курсіў' },
                  { keys: ['`код`'], desc: 'Код' },
                  { keys: ['Tab'], desc: 'Укласці' },
                ],
              },
              {
                group: 'Экспарт старонкі',
                items: [
                  { keys: ['DOCX'], desc: 'Дакумент Word' },
                  { keys: ['PDF'], desc: 'PDF файл' },
                  { keys: ['MD'], desc: 'Markdown' },
                  { keys: ['Print'], desc: 'Друк' },
                ],
              },
            ].map((g) => (
              <div key={g.group} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{g.group}</p>
                <div className="space-y-1.5">
                  {g.items.map((item) => (
                    <div key={item.desc} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">{item.desc}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.keys.map((k, i) => (
                          <kbd key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded font-mono text-slate-300">{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  },
  {
    id: 'settings',
    icon: <Settings size={18} />,
    color: 'text-slate-400 bg-slate-700/40',
    title: {
      ru: 'Настройки',
      en: 'Settings',
      be: 'Налады',
    },
    content: {
      ru: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: <Star size={14} className="text-yellow-400" />, title: 'Темы', desc: 'Тёмная, светлая, стеклянная (Glass), HUD, Latte, Dawn — выбери в Настройках → Общие' },
              { icon: <Globe size={14} className="text-blue-400" />, title: 'Язык', desc: 'Русский, English, Беларуская — переключай в Настройках → Общие' },
              { icon: <Brain size={14} className="text-primary-400" />, title: 'AI провайдер', desc: 'OpenAI, Anthropic, Groq, Mistral, Google и другие. Настрой в Настройках → AI' },
              { icon: <MessageSquare size={14} className="text-green-400" />, title: 'Интеграции', desc: 'Telegram, Slack, Discord — настрой уведомления в Настройках → Интеграции' },
              { icon: <Timer size={14} className="text-orange-400" />, title: 'Pomodoro', desc: 'Таймер помодоро — кнопка в правом нижнем углу интерфейса' },
              { icon: <Share2 size={14} className="text-cyan-400" />, title: 'Публичные страницы', desc: 'Поделись страницей — кнопка Share в редакторе. Ссылка /p/токен доступна без авторизации' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1.5">
                  {icon}
                  <span className="text-sm font-semibold text-slate-200">{title}</span>
                </div>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
      en: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: <Star size={14} className="text-yellow-400" />, title: 'Themes', desc: 'Dark, Light, Glass, HUD, Latte, Dawn — choose in Settings → General' },
              { icon: <Globe size={14} className="text-blue-400" />, title: 'Language', desc: 'Russian, English, Belarusian — switch in Settings → General' },
              { icon: <Brain size={14} className="text-primary-400" />, title: 'AI Provider', desc: 'OpenAI, Anthropic, Groq, Mistral, Google and more. Configure in Settings → AI' },
              { icon: <MessageSquare size={14} className="text-green-400" />, title: 'Integrations', desc: 'Telegram, Slack, Discord — set up notifications in Settings → Integrations' },
              { icon: <Timer size={14} className="text-orange-400" />, title: 'Pomodoro', desc: 'Pomodoro timer — button in the bottom right corner' },
              { icon: <Share2 size={14} className="text-cyan-400" />, title: 'Public Pages', desc: 'Share a page — Share button in the editor. Link /p/token is accessible without login' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1.5">
                  {icon}
                  <span className="text-sm font-semibold text-slate-200">{title}</span>
                </div>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
      be: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: <Star size={14} className="text-yellow-400" />, title: 'Тэмы', desc: 'Цёмная, светлая, шкляная (Glass), HUD, Latte, Dawn — выберы ў Налады → Агульныя' },
              { icon: <Globe size={14} className="text-blue-400" />, title: 'Мова', desc: 'Руская, English, Беларуская — пераключай у Налады → Агульныя' },
              { icon: <Brain size={14} className="text-primary-400" />, title: 'AI правайдэр', desc: 'OpenAI, Anthropic, Groq, Mistral, Google і іншыя. Наладзь у Налады → AI' },
              { icon: <MessageSquare size={14} className="text-green-400" />, title: 'Інтэграцыі', desc: 'Telegram, Slack, Discord — наладзь апавяшчэнні ў Налады → Інтэграцыі' },
              { icon: <Timer size={14} className="text-orange-400" />, title: 'Pomodoro', desc: 'Таймер помадора — кнопка ў правым ніжнім куце інтэрфейсу' },
              { icon: <Share2 size={14} className="text-cyan-400" />, title: 'Публічныя старонкі', desc: 'Падзяліся старонкай — кнопка Share у рэдактары. Спасылка /p/токен даступная без аўтарызацыі' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-surface-800 rounded-xl p-4 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1.5">
                  {icon}
                  <span className="text-sm font-semibold text-slate-200">{title}</span>
                </div>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  },
]

function SectionAccordion({ section, lang }: { section: HelpSection; lang: 'ru' | 'en' | 'be' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn(
      'rounded-2xl border transition-all duration-200',
      open ? 'border-slate-600 bg-surface-900' : 'border-slate-800 bg-surface-900/60 hover:border-slate-700',
    )}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', section.color)}>
            {section.icon}
          </span>
          <span className="text-sm font-semibold text-slate-200">{section.title[lang]}</span>
        </div>
        {open
          ? <ChevronDown size={16} className="text-slate-500 flex-shrink-0" />
          : <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5">
          {section.content[lang]}
        </div>
      )}
    </div>
  )
}

export function HelpPage() {
  const { language } = useLanguageStore()
  const lang = (language === 'be' ? 'be' : language === 'en' ? 'en' : 'ru') as 'ru' | 'en' | 'be'

  const pageTitle = lang === 'be' ? 'Даведка' : lang === 'en' ? 'Help' : 'Справка'
  const subtitle = lang === 'be'
    ? 'Усё, што трэба ведаць для эфектыўнай працы з SinoutX'
    : lang === 'en'
    ? 'Everything you need to work effectively with SinoutX'
    : 'Всё, что нужно знать для эффективной работы с SinoutX'

  return (
    <div className="flex flex-col h-full">
      <Header title={pageTitle} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4">
              <HelpCircle size={28} className="text-primary-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-100 mb-2">{pageTitle}</h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto">{subtitle}</p>
            <a href="https://sinout.dasp.top/guide.html" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium transition-colors">
              <BookOpen size={15} />
              {lang === 'be' ? 'Поўнае кіраўніцтва (анлайн)' : lang === 'en' ? 'Full user guide (online)' : 'Полное руководство (онлайн)'}
            </a>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { icon: <Layers size={16} className="text-cyan-400" />, label: lang === 'be' ? 'Дошка ідэй' : lang === 'en' ? 'Idea Board' : 'Доска идей' },
              { icon: <Brain size={16} className="text-primary-400" />, label: lang === 'be' ? 'AI асістэнт' : lang === 'en' ? 'AI Assistant' : 'AI ассистент' },
              { icon: <BarChart2 size={16} className="text-green-400" />, label: lang === 'be' ? 'OKR і задачы' : lang === 'en' ? 'OKR & Tasks' : 'OKR и задачи' },
              { icon: <Search size={16} className="text-yellow-400" />, label: lang === 'be' ? 'Хуткі пошук' : lang === 'en' ? 'Quick Search' : 'Быстрый поиск' },
            ].map(({ icon, label }) => (
              <div key={label} className="bg-surface-900 border border-slate-800 rounded-xl p-3 flex items-center gap-2.5">
                {icon}
                <span className="text-xs text-slate-300 font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* Sections */}
          <div className="space-y-3">
            {SECTIONS.map((section) => (
              <SectionAccordion key={section.id} section={section} lang={lang} />
            ))}
          </div>

          {/* Footer tip */}
          <div className="mt-8 p-4 bg-primary-500/5 border border-primary-500/20 rounded-xl text-center">
            <p className="text-xs text-slate-400">
              {lang === 'be'
                ? 'Адкрый гэту даведку ў любы момант — '
                : lang === 'en'
                ? 'Open this help at any time — '
                : 'Открой эту справку в любой момент — '}
              <kbd className="text-[10px] px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded font-mono text-slate-300 mx-1">F1</kbd>
              {lang === 'be'
                ? 'або праз Налады → Даведка'
                : lang === 'en'
                ? 'or via Settings → Help'
                : 'или через Настройки → Справка'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

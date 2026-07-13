import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Send, ChevronDown, ChevronUp, Pencil, Trash2, CornerDownRight } from 'lucide-react'
import { pageCommentApi, type PageComment } from '@/api/client'
import { useT } from '@/i18n'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/i18n/dateLocale'
import { useLanguageStore } from '@/stores/languageStore'
import { cn } from '@/lib/utils'

const AUTHOR_KEY = 'page-comment-author'

function getStoredAuthor(): string {
  return localStorage.getItem(AUTHOR_KEY) ?? ''
}

function setStoredAuthor(name: string) {
  localStorage.setItem(AUTHOR_KEY, name)
}

function CommentForm({
  pageId,
  parentId,
  onDone,
  placeholder,
}: {
  pageId: string
  parentId?: string
  onDone?: () => void
  placeholder?: string
}) {
  const t = useT()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(getStoredAuthor)

  const create = useMutation({
    mutationFn: () => pageCommentApi.create(pageId, { text: text.trim(), author: author.trim() || undefined, parentId }),
    onSuccess: () => {
      setText('')
      setStoredAuthor(author)
      qc.invalidateQueries({ queryKey: ['page-comments', pageId] })
      onDone?.()
    },
  })

  const canSubmit = text.trim().length > 0

  return (
    <div className="space-y-2">
      {!parentId && (
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder={t.comments.anonymous}
          className="w-full bg-transparent text-xs text-slate-400 placeholder-slate-600 border-b border-slate-800 focus:outline-none focus:border-slate-600 pb-1"
        />
      )}
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? t.comments.placeholder}
          rows={2}
          className="flex-1 bg-surface-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmit) {
              e.preventDefault()
              create.mutate()
            }
          }}
        />
        <button
          onClick={() => canSubmit && create.mutate()}
          disabled={!canSubmit || create.isPending}
          className="btn-primary p-2 self-end flex-shrink-0"
          title="Ctrl+Enter"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

function CommentItem({
  comment,
  pageId,
  depth = 0,
}: {
  comment: PageComment
  pageId: string
  depth?: number
}) {
  const t = useT()
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(comment.text)
  const [showReplies, setShowReplies] = useState(true)

  const update = useMutation({
    mutationFn: () => pageCommentApi.update(comment.id, editText.trim()),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['page-comments', pageId] })
    },
  })

  const remove = useMutation({
    mutationFn: () => pageCommentApi.delete(comment.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['page-comments', pageId] }),
  })

  return (
    <div className={cn('group', depth > 0 && 'ml-6 border-l border-slate-800 pl-3')}>
      <div className="flex gap-2 py-2">
        {/* Avatar placeholder */}
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-300">
          {(comment.author ?? t.comments.anonymous).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-300">
              {comment.author ?? t.comments.anonymous}
            </span>
            <span className="text-[11px] text-slate-600">
              {formatDistanceToNow(new Date(comment.createdAt), { locale: getDateLocale(language), addSuffix: true })}
            </span>
            {comment.createdAt !== comment.updatedAt && (
              <span className="text-[11px] text-slate-700">{t.comments.edited}</span>
            )}
          </div>

          {editing ? (
            <div className="mt-1 space-y-1">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                autoFocus
                className="w-full bg-surface-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={() => update.mutate()} disabled={update.isPending || !editText.trim()} className="btn-primary text-xs">{t.comments.save}</button>
                <button onClick={() => { setEditing(false); setEditText(comment.text) }} className="btn-ghost text-xs">{t.comments.cancel}</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-300 mt-0.5 whitespace-pre-wrap break-words">{comment.text}</p>
          )}

          {!editing && (
            <div className="flex items-center gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {depth === 0 && (
                <button onClick={() => setReplying((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-0.5">
                  <CornerDownRight size={10} /> {t.comments.reply}
                </button>
              )}
              <button onClick={() => setEditing(true)} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-0.5">
                <Pencil size={10} /> {t.comments.edit}
              </button>
              <button onClick={() => remove.mutate()} className="text-[11px] text-slate-500 hover:text-red-400 flex items-center gap-0.5">
                <Trash2 size={10} /> {t.comments.delete}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies.length > 0 && depth === 0 && (
        <div className="ml-9">
          <button
            onClick={() => setShowReplies((v) => !v)}
            className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 mb-1"
          >
            {showReplies ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {showReplies ? t.comments.hideReplies : `${t.comments.showReplies} (${comment.replies.length})`}
          </button>
          {showReplies && comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} pageId={pageId} depth={1} />
          ))}
        </div>
      )}

      {replying && depth === 0 && (
        <div className="ml-9 mb-2">
          <CommentForm
            pageId={pageId}
            parentId={comment.id}
            placeholder={t.comments.replyPlaceholder}
            onDone={() => setReplying(false)}
          />
        </div>
      )}
    </div>
  )
}

export function CommentsPanel({ pageId }: { pageId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['page-comments', pageId],
    queryFn: () => pageCommentApi.list(pageId),
    enabled: open,
    staleTime: 30_000,
  })

  const total = comments.reduce((acc, c) => acc + 1 + (c.replies?.length ?? 0), 0)

  return (
    <div className="mt-12 border-t border-slate-800/60 pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors w-full mb-3"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <MessageSquare size={12} />
        <span>{t.comments.title}</span>
        {total > 0 && <span className="text-slate-700">{total}</span>}
      </button>

      {open && (
        <div className="space-y-1">
          {isLoading && (
            <p className="text-xs text-slate-600 py-2 pl-1">...</p>
          )}
          {!isLoading && comments.length === 0 && (
            <p className="text-xs text-slate-600 py-2 pl-1">{t.comments.noComments}</p>
          )}
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} pageId={pageId} />
          ))}

          <div className="mt-4 pt-3 border-t border-slate-800/60">
            <CommentForm pageId={pageId} />
          </div>
        </div>
      )}
    </div>
  )
}

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Bold, Italic, List, ListOrdered, Heading2, CheckSquare, Code } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'

interface Props {
  content: Record<string, unknown> | null
  onChange: (json: Record<string, unknown> | null) => void
  placeholder?: string
}

const EMPTY_DOC = { type: 'doc', content: [] }

function isEmpty(doc: Record<string, unknown> | null): boolean {
  if (!doc) return true
  const content = doc.content as unknown[]
  return !content || content.length === 0
}

export function TaskDescriptionEditor({ content, onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Описание...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: isEmpty(content) ? EMPTY_DOC : content,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as Record<string, unknown>
      const hasContent = editor.getText().trim().length > 0
      onChange(hasContent ? json : null)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[40px] max-h-[120px] overflow-y-auto px-3 py-2 text-sm text-slate-300',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const incoming = isEmpty(content) ? EMPTY_DOC : content
    const current = editor.getJSON()
    if (JSON.stringify(incoming) !== JSON.stringify(current)) {
      editor.commands.setContent(incoming as never)
    }
  }, [content, editor])

  if (!editor) return null

  const ToolBtn = ({
    active,
    onClick,
    children,
  }: {
    active?: boolean
    onClick: () => void
    children: React.ReactNode
  }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={cn(
        'p-1 rounded hover:bg-slate-700 transition-colors',
        active ? 'text-primary-400 bg-slate-700' : 'text-slate-500',
      )}
    >
      {children}
    </button>
  )

  return (
    <div className="border border-slate-700 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-primary-500">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-700/60 bg-surface-900">
        <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <CheckSquare size={12} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={12} />
        </ToolBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

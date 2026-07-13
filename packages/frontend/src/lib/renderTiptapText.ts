type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
}

export function renderTiptapText(doc: Record<string, unknown> | null | undefined, maxLength = 600): string {
  if (!doc) return ''
  const lines: string[] = []
  function walk(node: TiptapNode) {
    if (node.type === 'text' && node.text) {
      lines.push(node.text)
    }
    if (node.content) {
      node.content.forEach(walk)
      if (['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem', 'codeBlock'].includes(node.type ?? '')) {
        lines.push('\n')
      }
    }
  }
  walk(doc as TiptapNode)
  return lines.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength)
}

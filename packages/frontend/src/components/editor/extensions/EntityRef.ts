import { Node, mergeAttributes } from '@tiptap/core'

// Inline node that represents a created entity (task / note / budget)
// Rendered as a clickable chip inside the page content.
export const EntityRefExtension = Node.create({
  name: 'entityRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entityType: { default: 'task' },   // 'task' | 'note' | 'budget'
      entityId:   { default: '' },
      label:      { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const icons: Record<string, string> = { task: '☑', note: '🗒', budget: '💰' }
    const icon = icons[HTMLAttributes.entityType] ?? '🔗'
    return [
      'span',
      mergeAttributes(
        {
          'data-entity-id':   HTMLAttributes.entityId,
          'data-entity-type': HTMLAttributes.entityType,
          class: 'entity-ref',
        },
      ),
      `${icon} ${HTMLAttributes.label}`,
    ]
  },

  addCommands() {
    return {
      insertEntityRef:
        (attrs: { entityType: string; entityId: string; label: string }) =>
        (props: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) =>
          props.commands.insertContent({ type: this.name, attrs }),
    } as Record<string, unknown>
  },
})

import { useRef, useState, type DragEvent, type HTMLAttributes } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { IconButton } from './IconButton'

export function useCourseDrag(
  ordered: string[],
  move: (from: string, to: string, after: boolean) => void,
  gallery: boolean
) {
  const source = useRef('')
  const [dragged, drag] = useState('')
  const [marker, mark] = useState<{ id: string; after: boolean }>()
  function finish() {
    source.current = ''
    drag('')
    mark(undefined)
  }
  function position(e: DragEvent<HTMLElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    return gallery
      ? e.clientX >= box.left + box.width / 2
      : e.clientY >= box.top + box.height / 2
  }
  function card(
    id: string
  ): HTMLAttributes<HTMLElement> & {
    'data-drop'?: string
    'data-dragging'?: string
  } {
    return {
      'data-drop':
        marker?.id === id ? (marker.after ? 'after' : 'before') : undefined,
      'data-dragging': dragged === id ? '' : undefined,
      onDragOver(e) {
        if (!source.current || source.current === id) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const after = position(e)
        if (marker?.id !== id || marker.after !== after) mark({ id, after })
      },
      onDragLeave(e) {
        if (
          marker?.id === id &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          mark(undefined)
      },
      onDrop(e) {
        if (!source.current) return
        e.preventDefault()
        if (source.current !== id) move(source.current, id, position(e))
        finish()
      },
    }
  }
  function controls(id: string, name: string) {
    const index = ordered.indexOf(id)
    return (
      <div className="course-order-controls">
        <span
          draggable
          aria-hidden="true"
          title="Перетащить"
          className="course-grip"
          onDragStart={(e) => {
            source.current = id
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', id)
            drag(id)
          }}
          onDragEnd={finish}
        >
          <GripVertical size={16} />
        </span>
        <IconButton
          label={'Выше: ' + name}
          disabled={index <= 0}
          onClick={() => move(id, ordered[index - 1], false)}
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          label={'Ниже: ' + name}
          disabled={index < 0 || index >= ordered.length - 1}
          onClick={() => move(id, ordered[index + 1], true)}
        >
          <ArrowDown />
        </IconButton>
      </div>
    )
  }
  return { card, controls }
}

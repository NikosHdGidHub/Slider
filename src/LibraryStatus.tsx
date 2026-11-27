import {
  useEffect,
  useId,
  useSyncExternalStore,
  useCallback,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type Level = 'error' | 'warning' | 'busy'
type Item = { id: string; level: Level; title: string }
const entries = new Map<string, Item>()
const listeners = new Set<() => void>()
let snapshot: Item[] = []
let target: HTMLDivElement | null = null
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const emit = () => {
  for (const fn of listeners) fn()
}
const update = () => {
  snapshot = [...entries.values()]
  emit()
}
export function useLibraryStatus() {
  return useSyncExternalStore(subscribe, () => snapshot)
}
export function LibraryStatus({
  level,
  title,
  children,
}: {
  level: Level
  title: string
  children?: ReactNode
}) {
  const id = useId()
  const host = useSyncExternalStore(subscribe, () => target)
  useEffect(() => {
    entries.set(id, { id, level, title })
    update()
    return () => {
      entries.delete(id)
      update()
    }
  }, [id, level, title])
  return host
    ? createPortal(
        <section
          className="atlas-status-entry"
          data-level={level}
          role={level === 'error' ? 'alert' : 'status'}
        >
          <strong>{title}</strong>
          {children}
        </section>,
        host
      )
    : null
}
export function LibraryStatusDetails() {
  const ref = useCallback((node: HTMLDivElement | null) => {
    target = node
    emit()
  }, [])
  const items = useLibraryStatus()
  return (
    <section
      className="atlas-status-details"
      hidden={!items.length}
      aria-label="Состояние библиотек"
    >
      <h3>Состояние библиотек</h3>
      <div ref={ref} className="atlas-status-entries" />
    </section>
  )
}

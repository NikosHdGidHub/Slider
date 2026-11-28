import { useEffect, useRef, useState, type MouseEvent } from 'react'
export type Action = { name: string; run: () => void; key?: string }
export function isTyping(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],.text-style-manager'
    )
  )
}

export function useHistory<T>(value: T, write: (v: T) => void, key?: string) {
  const current = useRef(value)
  const stacks = useRef({
    past: [] as T[],
    future: [] as T[],
  })

  const gesture = useRef(false)
  const recorded = useRef(false)
  const scope = useRef(key)

  current.current = value

  // Новый документ — новая история.
  if (scope.current !== key) {
    scope.current = key
    stacks.current = { past: [], future: [] }
    gesture.current = false
    recorded.current = false
  }

  useEffect(() => {
    const start = () => {
      gesture.current = true
      recorded.current = false
    }

    const end = () => {
      gesture.current = false
      recorded.current = false
    }

    window.addEventListener('pointerdown', start, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)

    return () => {
      window.removeEventListener('pointerdown', start, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
  }, [])

  function set(next: T) {
    const previous = current.current

    if (next === previous) return

    if (!gesture.current || !recorded.current) {
      stacks.current.past.push(previous)

      if (stacks.current.past.length > 60) {
        stacks.current.past.shift()
      }

      recorded.current = true
    }

    // После нового действия повтор старой отмены невозможен.
    stacks.current.future = []

    current.current = next
    write(next)
  }

  function step(redo: boolean) {
    const { past, future } = stacks.current
    const source = redo ? future : past
    const destination = redo ? past : future

    if (source.length === 0) return

    const previous = source.pop()!
    destination.push(current.current)

    // Синхронизируем историю до обновления React.
    current.current = previous
    recorded.current = false

    write(previous)
  }

  const actions: Action[] = [
    ...(stacks.current.past.length
      ? [
          {
            name: 'Отменить',
            key: 'z',
            run: () => step(false),
          },
        ]
      : []),
    ...(stacks.current.future.length
      ? [
          {
            name: 'Повторить',
            key: 'shift+z',
            run: () => step(true),
          },
        ]
      : []),
  ]

  return {
    set,
    update: (fn: (v: T) => T) => set(fn(current.current)),
    actions,
  }
}

export function useCommands(actions: Action[]) {
  const [point, show] = useState<{
    x: number
    y: number
    actions: Action[]
  } | null>(null)
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (document.querySelector('dialog.atlas-confirm[open]')) return
      if (e.key === 'Escape') {
        show(null)
        return
      }
      if (isTyping(e.target) || !(e.ctrlKey || e.metaKey)) return
      // ВАЖНО ДЛЯ ВСЕХ БУДУЩИХ ИНСТРУМЕНТОВ РЕДАКТОРА:
      //
      // Горячие клавиши определяем по физическому коду (KeyboardEvent.code),
      // а не по символу (KeyboardEvent.key).
      //
      // Причина: русская и английская раскладки возвращают разные e.key.
      // Например, Ctrl+Z в русской раскладке даёт e.key = "я",
      // но e.code = "KeyZ" в обеих раскладках.
      //
      // Это правило обязательно для всех редакторов и конструкторов:
      // отмена, повтор, копирование, вставка, вырезание и будущие инструменты.

      const physicalKey = e.code.startsWith('Key')
        ? e.code.slice(3).toLowerCase()
        : e.key.toLowerCase()

      const shortcut = (e.shiftKey ? 'shift+' : '') + physicalKey
      const action = actions.find((a) => a.key === shortcut)
      if (action) {
        e.preventDefault()
        action.run()
      }
    }
    function close(e: PointerEvent) {
      if (!(e.target as Element).closest('.studio-menu')) show(null)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', close)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', close)
    }
  }, [actions])
  return {
    open: (e: MouseEvent, list: Action[]) => {
      e.preventDefault()
      e.stopPropagation()
      show({
        x: Math.max(0, Math.min(e.clientX, innerWidth - 215)),
        y: Math.max(
          0,
          Math.min(
            e.clientY,
            innerHeight - Math.min(innerHeight, list.length * 40 + 12)
          )
        ),
        actions: list,
      })
    },
    menu: point && (
      <div
        role="menu"
        className="studio-menu"
        style={{ left: point.x, top: point.y }}
      >
        {point.actions.map((a) => (
          <button
            role="menuitem"
            key={a.name}
            onClick={() => {
              show(null)
              a.run()
            }}
          >
            {a.name}
          </button>
        ))}
      </div>
    ),
  }
}

export type HistoryControls = Pick<ReturnType<typeof useHistory>, 'actions'>

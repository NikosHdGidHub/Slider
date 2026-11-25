import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, Ellipsis, type LucideIcon } from 'lucide-react'
import { IconButton } from './IconButton'

export type MenuAction = {
  label: string
  icon?: LucideIcon
  run: () => void | Promise<void>
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  reason?: string
}
export type MenuItem = MenuAction | 'separator'

const OpenMenu = createContext<{
  id: string | null
  select: Dispatch<SetStateAction<string | null>>
} | null>(null)

export function ActionMenus({ children }: { children: ReactNode }) {
  const [id, select] = useState<string | null>(null)
  return (
    <OpenMenu.Provider value={{ id, select }}>{children}</OpenMenu.Provider>
  )
}

export function ActionMenu({
  label,
  items,
  icon: Trigger = Ellipsis,
  primary,
  children,
  disabled,
  onError,
}: {
  label: string
  items: MenuItem[]
  icon?: LucideIcon
  primary?: boolean
  children?: ReactNode
  disabled?: boolean
  onError?: (message: string) => void
}) {
  const context = useContext(OpenMenu)!
  const menuId = useId()
  const open = context.id === menuId
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const last = useRef(false)
  const running = useRef(false)
  const anyEnabled = items.some(
    (item) => item !== 'separator' && !item.disabled
  )
  const inactive = disabled || !anyEnabled

  function close(restore: boolean) {
    context.select((current) => (current === menuId ? null : current))
    if (restore) trigger.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) return
    const panel = menu.current!
    const anchor = trigger.current!
    function position() {
      const rect = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth)
      const bottom = top + (viewport?.height ?? innerHeight)
      const gap = 7
      if (
        !rect.width ||
        rect.bottom < top ||
        rect.top > bottom ||
        rect.right < left ||
        rect.left > right
      ) {
        close(false)
        return
      }
      const above = rect.top - top - gap * 2
      const below = bottom - rect.bottom - gap * 2
      panel.style.maxWidth = Math.max(24, right - left - gap * 2) + 'px'
      const height = panel.scrollHeight + 2
      const upward = below < height && above > below
      panel.style.maxHeight = Math.max(24, upward ? above : below) + 'px'
      panel.style.left =
        Math.max(
          left + gap,
          Math.min(
            right - panel.offsetWidth - gap,
            rect.right - panel.offsetWidth
          )
        ) + 'px'
      panel.style.top =
        (upward
          ? Math.max(top + gap, rect.top - panel.offsetHeight - gap)
          : rect.bottom + gap) + 'px'
      panel.style.visibility = 'visible'
    }
    function outside(e: PointerEvent) {
      const target = e.target as Node
      if (!panel.contains(target) && !anchor.contains(target)) close(false)
    }
    position()
    const enabled = panel.querySelectorAll<HTMLElement>('button:not(:disabled)')
    enabled[last.current ? enabled.length - 1 : 0]?.focus({
      preventScroll: true,
    })
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open])

  function toggle(fromLast = false) {
    if (inactive || running.current) return
    if (open) return close(true)
    last.current = fromLast
    context.select(menuId)
  }

  async function run(action: MenuAction) {
    if (running.current || action.disabled) return
    running.current = true
    close(true)
    try {
      await action.run()
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.'
      )
    } finally {
      running.current = false
    }
  }

  const triggerProps = {
    ref: trigger,
    disabled: inactive,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => toggle(),
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!open) toggle(e.key === 'ArrowUp')
      }
    },
  }

  return (
    <>
      {primary ? (
        <button
          type="button"
          className="lib-button lib-primary"
          aria-label={label}
          {...triggerProps}
        >
          <Trigger size={18} aria-hidden="true" />
          {children}
        </button>
      ) : (
        <IconButton
          className="lib-button lib-icon"
          label={label}
          {...triggerProps}
        >
          <Trigger />
        </IconButton>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            className="lib-menu"
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Tab') {
                e.stopPropagation()
                if (e.key === 'Escape') e.preventDefault()
                close(true)
                return
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key))
                return
              e.preventDefault()
              const options = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)'
                ),
              ]
              if (!options.length) return
              const index = options.indexOf(
                document.activeElement as HTMLButtonElement
              )
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? options.length - 1
                    : (index +
                        (e.key === 'ArrowDown' ? 1 : -1) +
                        options.length) %
                      options.length
              options[next].focus()
            }}
          >
            {items.map((item, index) =>
              item === 'separator' ? (
                <div role="separator" key={index} />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role={
                    item.checked === undefined ? 'menuitem' : 'menuitemradio'
                  }
                  tabIndex={-1}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  data-danger={item.danger || undefined}
                  title={item.reason}
                  onClick={() => void run(item)}
                >
                  {item.icon && <item.icon aria-hidden="true" />}
                  <span>{item.label}</span>
                  {item.checked && (
                    <Check className="lib-menu-check" aria-hidden="true" />
                  )}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  )
}

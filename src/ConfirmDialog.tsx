import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import './confirmDialog.css'

export type ConfirmVariant = 'primary' | 'secondary' | 'danger' | 'warning'
export type ConfirmAction = {
  id: string
  label: string
  description?: string
  variant?: ConfirmVariant
  icon?: ReactNode
  disabled?: boolean
  // Reject/throw to keep the dialog open. Return false to keep it open without an error.
  onClick?: () => void | boolean | Promise<void | boolean>
}
export type ConfirmOptions = {
  title: string
  description?: ReactNode
  icon?: ReactNode
  actions: ConfirmAction[]
  dismissible?: boolean
}
type Request = {
  key: number
  options: ConfirmOptions
  resolve: (id: string | null) => void
}
let sequence = 0
let requests: Request[] = []
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const snapshot = () => requests
function notify() {
  listeners.forEach((fn) => fn())
}

/** One host, typed configuration, no business logic in the visual component. */
export function openConfirm(options: ConfirmOptions): Promise<string | null> {
  return new Promise((resolve) => {
    requests = [...requests, { key: ++sequence, options, resolve }]
    notify()
  })
}
export async function askConfirm(
  description: string,
  options: {
    title?: string
    label?: string
    variant?: ConfirmVariant
  } = {}
): Promise<boolean> {
  const result = await openConfirm({
    title: options.title ?? 'Подтверждение действия',
    description,
    actions: [
      {
        id: 'accept',
        label: options.label ?? 'Подтвердить',
        variant: options.variant ?? 'primary',
      },
      { id: 'cancel', label: 'Отмена', variant: 'secondary' },
    ],
  })
  return result === 'accept'
}
function settle(request: Request, result: string | null) {
  if (!requests.includes(request)) return
  requests = requests.filter((item) => item !== request)
  notify()
  request.resolve(result)
}
function ConfirmDialog({ request }: { request: Request }) {
  const { options } = request
  const ref = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [running, setRunning] = useState('')
  const [error, setError] = useState('')
  const titleId = useId(),
    descId = useId()
  useEffect(() => {
    const el = ref.current!
    const previous = document.activeElement as HTMLElement | null
    el.showModal()
    el.querySelector<HTMLElement>('[data-safe-focus]')?.focus()
    return () => {
      if (el.open) el.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  function dismiss() {
    if (!lock.current && options.dismissible !== false) settle(request, null)
  }
  async function execute(action: ConfirmAction) {
    if (lock.current || action.disabled) return
    lock.current = true
    setRunning(action.id)
    setError('')
    try {
      if ((await action.onClick?.()) !== false) settle(request, action.id)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось выполнить действие.'
      )
    } finally {
      lock.current = false
      setRunning('')
    }
  }
  return (
    <dialog
      ref={ref}
      className="atlas-confirm"
      aria-labelledby={titleId}
      aria-describedby={options.description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        dismiss()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="atlas-confirm-head">
        <div className="atlas-confirm-icon">
          {options.icon ?? <AlertTriangle size={23} />}
        </div>
        {options.dismissible !== false && (
          <button
            type="button"
            className="atlas-confirm-close"
            aria-label="Закрыть"
            disabled={!!running}
            onClick={dismiss}
            data-safe-focus
          >
            <X size={20} />
          </button>
        )}
      </div>
      <h2 id={titleId}>{options.title}</h2>
      {options.description && (
        <div id={descId} className="atlas-confirm-description">
          {options.description}
        </div>
      )}
      {error && (
        <p className="atlas-confirm-error" role="alert">
          {error}
        </p>
      )}
      <div className="atlas-confirm-actions" aria-busy={!!running}>
        {options.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={
              'atlas-confirm-action atlas-confirm-' +
              (action.variant ?? 'secondary')
            }
            disabled={!!running || action.disabled}
            onClick={() => void execute(action)}
          >
            {running === action.id ? (
              <LoaderCircle className="atlas-confirm-spin" size={20} />
            ) : (
              action.icon
            )}
            <span>
              <strong>{action.label}</strong>
              {action.description && <small>{action.description}</small>}
            </span>
          </button>
        ))}
      </div>
    </dialog>
  )
}
export function ConfirmDialogHost() {
  const stack = useSyncExternalStore(subscribe, snapshot, snapshot)
  // Native modal top-layer isolates keyboard and pointer input. Nested confirmations
  // (e.g. publication licence) can open above an action that is awaiting them.
  return createPortal(
    stack.map((request) => (
      <ConfirmDialog key={request.key} request={request} />
    )),
    document.body
  )
}

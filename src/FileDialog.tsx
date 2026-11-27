import { useEffect, useRef, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
export function FileDialog({
  title,
  close,
  locked = false,
  children,
}: {
  title: string
  close: () => void
  locked?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      previous?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className="dialog atlas-file-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!locked) close()
      }}
    >
      <header className="atlas-file-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="lib-button lib-icon"
          aria-label="Закрыть"
          disabled={locked}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body
  )
}

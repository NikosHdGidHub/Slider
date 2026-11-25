import type { ComponentPropsWithRef } from 'react'

export function IconButton({
  label,
  shortcut,
  title,
  children,
  ...props
}: ComponentPropsWithRef<'button'> & {
  label: string
  shortcut?: string
}) {
  return (
    <button
      {...props}
      type="button"
      className={['icon-button', props.className].filter(Boolean).join(' ')}
      aria-label={label}
      title={title ?? (shortcut ? label + ' (' + shortcut + ')' : label)}
    >
      {children}
    </button>
  )
}

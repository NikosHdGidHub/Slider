import { useRef, useState, useEffect, useId, type ReactNode } from 'react'

import {
  Monitor,
  MonitorCheck,
  Cloud,
  CloudCheck,
  CloudUpload,
  CloudOff,
  Globe2,
  Settings2,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'

import './availability.css'

export type AvailabilityState = {
  local: boolean
  cloud: boolean | null
  published?: boolean | null

  pending?: boolean
  syncing?: boolean
  conflict?: boolean
  offline?: boolean
  error?: boolean
  publicationOutdated?: boolean
  localSaving?: boolean
  localError?: boolean
}

export type AvailabilityProps = {
  state: AvailabilityState
  disabled?: boolean
  cloudDisabled?: boolean

  onLocal: (enabled: boolean) => Promise<void>
  onCloud: (enabled: boolean) => Promise<void>
  onPublished?: (enabled: boolean) => Promise<void>

  onSync?: () => void | Promise<void>
  onConflict?: () => void | Promise<void>
  onUpdatePublication?: () => void | Promise<void>
  onError: (message: string) => void
}

function AvailabilityIndicator({
  children,
  label,
  tone,
}: {
  children: ReactNode
  label: string
  tone: string
}) {
  return (
    <span
      className="availability-indicator"
      data-tone={tone}
      title={label}
      aria-label={label}
      role="img"
      tabIndex={0}
    >
      {children}
    </span>
  )
}

function AvailabilitySwitch({
  title,
  description,
  enabled,
  disabled,
  icon,
  onChange,
}: {
  title: string
  description: string
  enabled: boolean | null
  disabled?: boolean
  icon: ReactNode
  onChange: () => void
}) {
  const descriptionId = useId()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled === true}
      aria-label={title}
      aria-describedby={descriptionId}
      disabled={disabled || enabled === null}
      className="availability-option"
      onClick={onChange}
    >
      <span className="availability-option-icon">{icon}</span>

      <span className="availability-option-text">
        <strong>{title}</strong>
        <small id={descriptionId}>{description}</small>
      </span>

      <span
        className="availability-switch"
        data-enabled={enabled === true}
        data-unknown={enabled === null}
        aria-hidden="true"
      >
        <span />
      </span>
    </button>
  )
}

export function AvailabilityControl({
  state,
  disabled,
  cloudDisabled,
  onLocal,
  onCloud,
  onPublished,
  onSync,
  onConflict,
  onUpdatePublication,
  onError,
}: AvailabilityProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const running = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const panelId = useId()

  useEffect(() => {
    if (!open) return

    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)

    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [open])

  async function execute(action: () => void | Promise<void>) {
    if (running.current || disabled) return

    running.current = true
    setBusy(true)

    try {
      await action()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.'
      )
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const locked = !!disabled || busy

  const remoteLocked = locked || !!cloudDisabled || !!state.offline

  const localLabel = state.localError
    ? 'Ошибка локального сохранения'
    : state.localSaving
      ? 'Локальное сохранение…'
      : state.local
        ? 'Сохранено на устройстве'
        : 'Локальной копии нет'

  const cloudLabel = state.conflict
    ? 'Конфликт версий'
    : state.error
      ? 'Ошибка синхронизации'
      : state.syncing
        ? 'Синхронизация…'
        : state.pending
          ? 'Ожидает синхронизации'
          : state.cloud === null
            ? 'Состояние облака неизвестно'
            : state.offline
              ? state.cloud
                ? 'В облаке по последней проверке. Офлайн'
                : 'Облачной копии не было. Офлайн'
              : state.cloud
                ? 'В облаке'
                : 'Облачной копии нет'

  const publicationLabel =
    state.published === null
      ? 'Статус публикации неизвестен'
      : state.publicationOutdated
        ? 'Публикация отличается от рабочей версии'
        : state.published
          ? 'Опубликовано'
          : 'Не опубликовано'

  const LocalIcon = state.localError
    ? AlertTriangle
    : state.localSaving
      ? RefreshCw
      : state.local
        ? MonitorCheck
        : Monitor

  const CloudIcon =
    state.conflict || state.error
      ? AlertTriangle
      : state.syncing
        ? RefreshCw
        : state.pending
          ? CloudUpload
          : state.offline
            ? CloudOff
            : state.cloud
              ? CloudCheck
              : Cloud

  const localTone = state.localError
    ? 'error'
    : state.localSaving
      ? 'pending'
      : state.local
        ? 'active'
        : 'inactive'

  const cloudTone = state.conflict
    ? 'warning'
    : state.error
      ? 'error'
      : state.pending || state.syncing
        ? 'pending'
        : state.cloud === null || state.offline
          ? 'unknown'
          : state.cloud
            ? 'active'
            : 'inactive'

  return (
    <div className="availability-control" ref={root} aria-busy={busy}>
      <div className="availability-indicators">
        <AvailabilityIndicator label={localLabel} tone={localTone}>
          <LocalIcon
            size={19}
            aria-hidden="true"
            className={state.localSaving ? 'availability-spinning' : undefined}
          />
        </AvailabilityIndicator>

        <AvailabilityIndicator label={cloudLabel} tone={cloudTone}>
          <CloudIcon
            size={19}
            aria-hidden="true"
            className={state.syncing ? 'availability-spinning' : undefined}
          />
        </AvailabilityIndicator>

        {state.published !== undefined && (
          <AvailabilityIndicator
            label={publicationLabel}
            tone={
              state.published === null
                ? 'unknown'
                : state.publicationOutdated
                  ? 'warning'
                  : state.published
                    ? 'active'
                    : 'inactive'
            }
          >
            <Globe2 size={19} aria-hidden="true" />
          </AvailabilityIndicator>
        )}
      </div>

      <button
        ref={trigger}
        type="button"
        className="availability-trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Управление доступностью"
        title="Управление доступностью"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 size={17} />
        <span>Управление доступностью</span>
        <ChevronDown
          size={14}
          className={open ? 'availability-chevron-open' : ''}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="availability-panel"
          role="group"
          aria-label="Управление доступностью"
        >
          <div className="availability-heading">Управление доступностью</div>

          <AvailabilitySwitch
            title="На устройстве"
            description={localLabel}
            enabled={state.local}
            disabled={
              locked ||
              state.localSaving ||
              state.localError ||
              (state.local &&
                (state.pending || state.syncing || state.conflict))
            }
            icon={<Monitor size={21} />}
            onChange={() => void execute(() => onLocal(!state.local))}
          />

          <AvailabilitySwitch
            title="В личном облаке"
            description={cloudLabel}
            enabled={state.cloud}
            disabled={
              remoteLocked ||
              state.syncing ||
              state.pending ||
              state.conflict ||
              state.localSaving ||
              state.localError
            }
            icon={<Cloud size={21} />}
            onChange={() => void execute(() => onCloud(!state.cloud))}
          />

          {state.published !== undefined && onPublished && (
            <AvailabilitySwitch
              title="Публичный доступ"
              description={publicationLabel}
              enabled={state.published}
              disabled={remoteLocked || state.localSaving || state.localError}
              icon={<Globe2 size={21} />}
              onChange={() => void execute(() => onPublished(!state.published))}
            />
          )}

          {state.conflict && onConflict && (
            <button
              type="button"
              className="availability-action conflict"
              disabled={remoteLocked}
              onClick={() => {
                setOpen(false)
                void execute(onConflict)
              }}
            >
              <AlertTriangle size={17} />
              Разрешить конфликт
            </button>
          )}

          {state.cloud && !state.conflict && onSync && (
            <button
              type="button"
              className="availability-action"
              disabled={remoteLocked || state.syncing}
              onClick={() => void execute(onSync)}
            >
              <RefreshCw size={17} />
              Синхронизировать сейчас
            </button>
          )}

          {state.published &&
            state.publicationOutdated &&
            onUpdatePublication && (
              <button
                type="button"
                className="availability-action"
                disabled={remoteLocked || state.localSaving || state.localError}
                onClick={() => void execute(onUpdatePublication)}
              >
                <Globe2 size={17} />
                Обновить публикацию
              </button>
            )}

          {busy && (
            <div className="availability-progress" role="status">
              <RefreshCw size={15} className="availability-spinning" />
              Выполняется операция…
            </div>
          )}

          {state.offline && (
            <div className="availability-note">
              Нет подключения к интернету. Облачные операции недоступны.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

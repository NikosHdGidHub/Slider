import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ChevronDown,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  Undo2,
} from 'lucide-react'
import { clamp, usePreference } from './workspacePreferences'
import type { HistoryControls } from './StudioTools'
import './workspace.css'

type ResizeProps = {
  label: string
  value: number
  min: number
  max: number
  change: (value: number) => void
  side: 'left' | 'right' | 'top'
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  change,
  side,
}: ResizeProps) {
  const drag = useRef<{ id: number; start: number; value: number } | null>(null)
  const horizontal = side === 'top'
  const direction = side === 'left' ? 1 : -1

  return (
    <div
      className={'workspace-resize resize-' + side}
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0 || !e.isPrimary) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = {
          id: e.pointerId,
          start: horizontal ? e.clientY : e.clientX,
          value,
        }
      }}
      onPointerMove={(e) => {
        const current = drag.current
        if (!current || e.pointerId !== current.id) return
        const position = horizontal ? e.clientY : e.clientX
        change(
          clamp(
            current.value + (position - current.start) * direction,
            min,
            max
          )
        )
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
      onKeyDown={(e) => {
        const decrease = horizontal ? 'ArrowUp' : 'ArrowLeft'
        const increase = horizontal ? 'ArrowDown' : 'ArrowRight'
        if (![decrease, increase, 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Home') change(min)
        else if (e.key === 'End') change(max)
        else
          change(
            clamp(
              value + (e.key === increase ? 1 : -1) * direction * 12,
              min,
              max
            )
          )
      }}
    />
  )
}

export function IconButton({
  label,
  shortcut,
  title,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  shortcut?: string
}) {
  return (
    <button
      {...props}
      type="button"
      className={['workspace-icon', props.className].filter(Boolean).join(' ')}
      aria-label={label}
      title={title ?? (shortcut ? label + ' (' + shortcut + ')' : label)}
    >
      {children}
    </button>
  )
}

export function HistoryButtons({ history }: { history: HistoryControls }) {
  const undo = history.actions.find((action) => action.key === 'z')
  const redo = history.actions.find((action) => action.key === 'shift+z')
  return (
    <div
      className="workspace-tool-group"
      role="group"
      aria-label="История изменений"
    >
      <IconButton
        label="Отменить"
        shortcut="Ctrl/⌘+Z"
        disabled={!undo}
        onClick={undo?.run}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        label="Повторить"
        shortcut="Ctrl/⌘+Shift+Z"
        disabled={!redo}
        onClick={redo?.run}
      >
        <Redo2 />
      </IconButton>
    </div>
  )
}

export function PropertySection({
  id,
  title,
  initial = false,
  children,
}: {
  id: string
  title: string
  initial?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = usePreference('properties.' + id, initial)
  return (
    <details
      className="property-section"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ChevronDown aria-hidden="true" />
        {title}
      </summary>
      <div className="property-body">{children}</div>
    </details>
  )
}

export function Workspace({
  scope,
  header,
  tools,
  navigation,
  navigationLabel,
  navigationActions,
  properties,
  notes,
  children,
  inspectorRequest,
}: {
  scope: string
  header: ReactNode
  tools?: ReactNode
  navigation?: ReactNode
  navigationLabel?: string
  navigationActions?: ReactNode
  properties: ReactNode
  notes?: ReactNode
  children: ReactNode
  inspectorRequest?: number
}) {
  const uid = useId()
  const narrowQuery = '(max-width: 720px)'
  const [narrow, setNarrow] = useState(() => matchMedia(narrowQuery).matches)
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null)
  const [left, setLeft] = usePreference(scope + '.left', true)
  const [right, setRight] = usePreference(scope + '.right', true)
  const [showNotes, setShowNotes] = usePreference(scope + '.notes', true)
  const [leftWidth, setLeftWidth] = usePreference(
    scope + '.left-width',
    178,
    [138, 330]
  )
  const [rightWidth, setRightWidth] = usePreference(
    scope + '.right-width',
    294,
    [224, 500]
  )
  const [notesHeight, setNotesHeight] = usePreference(
    scope + '.notes-height',
    96,
    [56, 320]
  )
  const leftVisible = !!navigation && (narrow ? drawer === 'left' : left)
  const rightVisible = narrow ? drawer === 'right' : right
  const navId = uid + '-navigation'
  const propsId = uid + '-properties'

  useEffect(() => {
    const media = matchMedia(narrowQuery)
    const update = () => {
      setNarrow(media.matches)
      setDrawer(null)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const lastRequest = useRef(0)
  useEffect(() => {
    if (!inspectorRequest || lastRequest.current === inspectorRequest) return
    lastRequest.current = inspectorRequest
    if (narrow) setDrawer('right')
    else setRight(true)
  }, [inspectorRequest, narrow, setRight])

  return (
    <div
      className={'workspace ' + (scope === 'grid' ? 'grid-designer' : 'editor')}
    >
      <header className="edit-head">{header}</header>
      <div
        className="edit-grid"
        data-narrow={narrow || undefined}
        style={
          {
            '--left': leftVisible && !narrow ? leftWidth + 'px' : '0px',
            '--right': rightVisible && !narrow ? rightWidth + 'px' : '0px',
            '--drawer-left': leftWidth + 'px',
            '--drawer-right': rightWidth + 'px',
            '--notes': notesHeight + 'px',
          } as CSSProperties
        }
      >
        {!!navigation && (
          <aside
            className="workspace-side workspace-left"
            id={navId}
            hidden={!leftVisible}
            aria-label={navigationLabel}
          >
            <div className="workspace-panel-head">
              <strong>{navigationLabel}</strong>
              {navigationActions}
            </div>
            <div className="strip workspace-scroll">{navigation}</div>
            {!narrow && (
              <ResizeHandle
                side="left"
                label="Ширина левой панели"
                value={leftWidth}
                min={138}
                max={330}
                change={setLeftWidth}
              />
            )}
          </aside>
        )}
        <main className="bench">
          <div className="workspace-toolbar">
            {!!navigation && (
              <IconButton
                label={
                  (leftVisible ? 'Свернуть' : 'Показать') + ' левую панель'
                }
                aria-expanded={leftVisible}
                aria-controls={navId}
                onClick={() =>
                  narrow
                    ? setDrawer(leftVisible ? null : 'left')
                    : setLeft(!left)
                }
              >
                <PanelLeft />
              </IconButton>
            )}
            <div
              className="tools"
              role="toolbar"
              aria-label="Инструменты редактора"
            >
              {tools}
            </div>
            <IconButton
              label={(rightVisible ? 'Свернуть' : 'Показать') + ' свойства'}
              aria-expanded={rightVisible}
              aria-controls={propsId}
              onClick={() =>
                narrow
                  ? setDrawer(rightVisible ? null : 'right')
                  : setRight(!right)
              }
            >
              <PanelRight />
            </IconButton>
          </div>
          {children}
          {!!notes && (
            <div className="workspace-notes">
              {showNotes && (
                <ResizeHandle
                  side="top"
                  label="Высота заметок"
                  value={notesHeight}
                  min={56}
                  max={320}
                  change={setNotesHeight}
                />
              )}
              <button
                type="button"
                className="notes-toggle"
                aria-expanded={showNotes}
                aria-controls={uid + '-notes'}
                onClick={() => setShowNotes(!showNotes)}
              >
                <PanelBottom /> Заметки преподавателя <ChevronDown />
              </button>
              <div className="notes" id={uid + '-notes'} hidden={!showNotes}>
                {notes}
              </div>
            </div>
          )}
        </main>
        <aside
          className="workspace-side workspace-right"
          id={propsId}
          hidden={!rightVisible}
          aria-label="Свойства"
        >
          <div className="workspace-panel-head">
            <strong>Свойства</strong>
          </div>
          <div className="inspector workspace-scroll">{properties}</div>
          {!narrow && (
            <ResizeHandle
              side="right"
              label="Ширина панели свойств"
              value={rightWidth}
              min={224}
              max={500}
              change={setRightWidth}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

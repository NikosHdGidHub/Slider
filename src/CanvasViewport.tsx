import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Minus, Plus, Maximize, Hand } from 'lucide-react'
import { clamp } from './workspacePreferences'
import { isTyping } from './StudioTools'

const WIDTH = 1280
const HEIGHT = 720
const MIN = 10
const MAX = 300
const PADDING = 16
type Point = { x: number; y: number }
type Size = { w: number; h: number }
type Camera = Point & { zoom: number }
type Pan = { id: number; start: Point; camera: Camera; space: boolean }

function constrain(position: Camera, area: Size, bleed = false): Camera {
  const x = Math.max(0, ((WIDTH * position.zoom) / 100 - area.w) / 2 + PADDING)
  const y = Math.max(0, ((HEIGHT * position.zoom) / 100 - area.h) / 2 + PADDING)
  return {
    zoom: position.zoom,
    x: clamp(
      position.x,
      -x - (bleed ? (16384 * position.zoom) / 100 : 0),
      x + (bleed ? (16384 * position.zoom) / 100 : 0)
    ),
    y: clamp(
      position.y,
      -y - (bleed ? (16384 * position.zoom) / 100 : 0),
      y + (bleed ? (16384 * position.zoom) / 100 : 0)
    ),
  }
}

function fitScale({ w, h }: Size, bleed = false) {
  return (
    100 *
    Math.min(
      Math.max(0, w - 2 * PADDING) / WIDTH,
      Math.max(0, h - 2 * PADDING) / HEIGHT
    ) *
    (bleed ? 0.78 : 1)
  )
}

export function CanvasViewport({
  children,
  onContextMenu,
  editable = false,
  bleed = false,
}: {
  children: ReactNode
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  editable?: boolean
  bleed?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [manual, setManual] = useState<Camera | null>(null)
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const pan = useRef<Pan | null>(null)
  const hovering = useRef(false)
  const spacePressed = useRef(false)
  const suppressClick = useRef(false)

  const fit = fitScale(size, bleed)
  const camera = manual ?? { zoom: fit, x: 0, y: 0 }

  useLayoutEffect(() => {
    const el = host.current!
    const measure = () => {
      const area = { w: el.clientWidth, h: el.clientHeight }
      setSize(area)
      setManual((value) => (value ? constrain(value, area, bleed) : value))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function end(pointerId?: number) {
    const current = pan.current
    if (!current || (pointerId !== undefined && pointerId !== current.id))
      return
    pan.current = null
    const el = host.current
    if (el?.hasPointerCapture(current.id)) el.releasePointerCapture(current.id)
    setPanning(false)
  }

  useEffect(() => {
    if (!editable) return
    const el = host.current!
    function wheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - rect.width / 2
      const y = e.clientY - rect.top - rect.height / 2
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1
      setManual((existing) => {
        const area = { w: el.clientWidth, h: el.clientHeight }
        const previous = existing ?? {
          zoom: fitScale(area, bleed),
          x: 0,
          y: 0,
        }
        const zoom = clamp(
          previous.zoom * Math.exp(-e.deltaY * unit * 0.002),
          MIN,
          MAX
        )
        const factor = previous.zoom > 0 ? zoom / previous.zoom : 1
        return constrain(
          {
            zoom,
            x: x - (x - previous.x) * factor,
            y: y - (y - previous.y) * factor,
          },
          area,
          bleed
        )
      })
    }
    function keyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') {
        spacePressed.current = false
        setSpace(false)
        end()
      }
      if (
        e.code !== 'Space' ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        isTyping(e.target) ||
        (e.target instanceof Element &&
          e.target.closest(
            'button:focus-visible,summary:focus-visible,a:focus-visible,[role="button"]:focus-visible'
          )) ||
        !(hovering.current || el.contains(document.activeElement))
      )
        return
      e.preventDefault()
      spacePressed.current = true
      setSpace(true)
    }
    function keyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      spacePressed.current = false
      setSpace(false)
      if (pan.current?.space) end()
    }
    function blur() {
      spacePressed.current = false
      setSpace(false)
      end()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [editable, bleed])

  function start(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('[data-text-controls]')) return
    const withSpace = spacePressed.current && e.button === 0
    suppressClick.current = withSpace || e.button === 1
    if (!suppressClick.current) {
      if (
        e.button === 0 &&
        !(e.target as Element).closest(
          'button,input,textarea,[contenteditable],[data-text-editing]'
        )
      )
        e.currentTarget.focus({ preventScroll: true })
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus({ preventScroll: true })
    if ((!manual && !bleed) || pan.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = {
      id: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      camera,
      space: withSpace,
    }
    setPanning(true)
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const current = pan.current
    if (!current || current.id !== e.pointerId) return
    setManual(
      constrain(
        {
          zoom: current.camera.zoom,
          x: current.camera.x + e.clientX - current.start.x,
          y: current.camera.y + e.clientY - current.start.y,
        },
        size,
        bleed
      )
    )
  }

  function setZoom(zoom: number) {
    setManual(
      constrain({ ...camera, zoom: clamp(zoom, MIN, MAX) }, size, bleed)
    )
  }

  return (
    <>
      <div
        ref={host}
        className={'canvas-viewport' + (editable ? ' canvas-editable' : '')}
        role={editable ? 'region' : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? 'Рабочая область холста' : undefined}
        data-pan={
          panning
            ? 'dragging'
            : space && (manual || bleed)
              ? 'ready'
              : undefined
        }
        onPointerEnter={
          editable
            ? () => {
                hovering.current = true
              }
            : undefined
        }
        onPointerLeave={
          editable
            ? () => {
                hovering.current = false
              }
            : undefined
        }
        onPointerDownCapture={editable ? start : undefined}
        onClickCapture={
          editable
            ? (e) => {
                if (
                  (e.target as Element).closest('[data-text-controls]') ||
                  !suppressClick.current ||
                  e.detail === 0
                )
                  return
                suppressClick.current = false
                e.preventDefault()
                e.stopPropagation()
              }
            : undefined
        }
        onPointerMove={editable ? move : undefined}
        onPointerUp={editable ? (e) => end(e.pointerId) : undefined}
        onPointerCancel={editable ? (e) => end(e.pointerId) : undefined}
        onLostPointerCapture={editable ? (e) => end(e.pointerId) : undefined}
        onAuxClick={
          editable
            ? (e) => {
                if (e.button === 1) e.preventDefault()
              }
            : undefined
        }
        onContextMenu={onContextMenu}
      >
        <div
          className="canvas"
          style={{
            width: (WIDTH * camera.zoom) / 100,
            height: (HEIGHT * camera.zoom) / 100,
            left: 'calc(50% + ' + camera.x + 'px)',
            top: 'calc(50% + ' + camera.y + 'px)',
          }}
        >
          {children}
        </div>
      </div>
      {editable && (
        <div className="zoom-bar" role="group" aria-label="Масштаб холста">
          <Hand
            size={16}
            className="pan-hint"
            aria-label="Перемещение холста"
            role="img"
          >
            <title>Пробел + перетаскивание или средняя кнопка мыши</title>
          </Hand>
          <button
            type="button"
            title="Уменьшить масштаб"
            aria-label="Уменьшить масштаб"
            disabled={!!manual && camera.zoom <= MIN}
            onClick={() => setZoom(Math.round(camera.zoom / 1.2))}
          >
            <Minus />
          </button>
          <input
            type="range"
            aria-label="Масштаб, проценты"
            min={MIN}
            max={MAX}
            value={clamp(Math.round(camera.zoom), MIN, MAX)}
            onChange={(e) => setZoom(+e.target.value)}
          />
          <button
            type="button"
            title="Увеличить масштаб"
            aria-label="Увеличить масштаб"
            disabled={!!manual && camera.zoom >= MAX}
            onClick={() => setZoom(Math.max(1, Math.ceil(camera.zoom * 1.2)))}
          >
            <Plus />
          </button>
          <output aria-label="Текущий масштаб">
            {Math.round(camera.zoom)}%
          </output>
          <button
            type="button"
            title="Фактический размер холста"
            onClick={() => setZoom(100)}
          >
            100%
          </button>
          <button
            type="button"
            aria-pressed={!manual}
            onClick={() => {
              end()
              setManual(null)
            }}
          >
            <Maximize />
            Вписать
          </button>
        </div>
      )}
    </>
  )
}

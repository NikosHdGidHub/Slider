import { defaultMaster, slots, pose, target } from './grid'
import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { sourceText, type Item, type Slide, type Deck } from './model'
import { isTextType } from './textTypes'
import type { TextSelectionControls } from './VisualText'
import './viewer.css'
import { PathHandles } from './PathHandles'
import { TextBlock, VectorShape, useFonts } from './Artwork'

interface StageProps {
  slide: Slide
  deck?: Deck
  onText?: (id: string, fields: Partial<Item>) => void
  onNodes?: (id: string, nodes: NonNullable<Item['nodes']>) => void
  onEditText?: (id: string) => void
  diagnostics?: boolean
  design?: boolean
  onSlot?: (id: string) => void
  onSlotEdit?: (id: string) => void
  editItem?: string
  registerText?: (controls: TextSelectionControls | null) => void
  undo?: (redo: boolean) => void
  showSource?: boolean
  selected?: string
  onSelect?: (id: string) => void
  onMove?: (id: string, x: number, y: number) => void
  onResize?: (id: string, w: number, h: number, x: number, y: number) => void
}

function SlideImage({
  src,
  background = false,
  effects,
  item,
}: {
  src: string
  background?: boolean
  effects?: Slide['effects']
  item?: Item
}) {
  const [failed, setFailed] = useState('')
  if (failed === src) {
    return (
      <span
        className={background ? 'atlas-background-error' : 'atlas-media-error'}
      >
        {background ? 'Фон недоступен' : 'Изображение недоступно'}
      </span>
    )
  }
  return (
    <img
      style={
        background
          ? {
              objectFit: effects?.fit ?? 'cover',
              objectPosition:
                (effects?.x ?? 50) + '% ' + (effects?.y ?? 50) + '%',
            }
          : item
            ? {
                objectFit: item.imageFit ?? 'contain',
                objectPosition:
                  (item.focusX ?? 50) + '% ' + (item.focusY ?? 50) + '%',
              }
            : undefined
      }
      draggable={false}
      className={background ? 'atlas-background-image' : 'atlas-object-image'}
      src={src}
      onError={() => setFailed(src)}
      alt={background ? '' : 'Изображение слайда'}
    />
  )
}

export function Stage({
  slide,
  deck,
  onEditText,
  diagnostics,
  design,
  onSlot,
  onSlotEdit,
  editItem,
  registerText,
  undo,
  showSource,
  onNodes,
  onText,
  selected,
  onSelect,
  onMove,
  onResize,
}: StageProps) {
  const locations = slots(deck?.master ?? defaultMaster(), slide)
  const host = useRef<HTMLDivElement>(null)
  const fontError = useFonts(host, deck)
  const [scale, setScale] = useState(0)
  const drag = useRef<{
    item: Item
    x: number
    y: number
    scale: number
    pointer: number
    bounds: { w: number; h: number }
    resize: boolean
  } | null>(null)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setScale(el.getBoundingClientRect().width / 1280)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function start(
    e: ReactPointerEvent<HTMLDivElement | HTMLSpanElement>,
    item: Item,
    resize = false,
    localScale = 1,
    locked = false
  ) {
    if (!onSelect || e.button !== 0 || !e.isPrimary) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(item.id)
    if (locked) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = {
      item,
      x: e.clientX,
      y: e.clientY,
      scale: (host.current!.getBoundingClientRect().width / 1280) * localScale,
      bounds: locations
        .filter(
          (v) => v.id === target(item) && v.cell.type === 'free' && !item.fixed
        )
        .map((v) => ({ w: v.box.w / v.scale, h: v.box.h / v.scale }))[0] ?? {
        w: 1280,
        h: 720,
      },
      pointer: e.pointerId,
      resize,
    }
  }
  function move(e: ReactPointerEvent) {
    const run = drag.current
    if (!run || run.pointer !== e.pointerId) return
    const dx = (e.clientX - run.x) / run.scale
    const dy = (e.clientY - run.y) / run.scale
    const item = run.item
    if (run.resize) {
      const angle = ((item.rotation ?? 0) * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const fx = item.flipX ? -1 : 1,
        fy = item.flipY ? -1 : 1
      const localX = (c * dx + s * dy) * fx,
        localY = (-s * dx + c * dy) * fy
      const transformed = !!(item.rotation || item.flipX || item.flipY)
      const maxW = transformed ? 8192 : Math.max(1, run.bounds.w - item.x),
        maxH = transformed ? 8192 : Math.max(1, run.bounds.h - item.y)
      let w = Math.min(maxW, Math.max(Math.min(24, item.w), item.w + localX))
      let h = Math.min(maxH, Math.max(Math.min(24, item.h), item.h + localY))
      if (item.type === 'image') {
        const ratio = item.w / item.h,
          target = Math.abs(localX) >= Math.abs(localY) ? w : h * ratio
        w = Math.min(maxW, maxH * ratio, target)
        h = w / ratio
      }
      const dw = w - item.w,
        dh = h - item.h
      onResize?.(
        item.id,
        w,
        h,
        item.x + (dw * fx * c - dh * fy * s - dw) / 2,
        item.y + (dw * fx * s + dh * fy * c - dh) / 2
      )
    } else {
      onMove?.(
        item.id,
        Math.round(Math.max(0, Math.min(run.bounds.w - item.w, item.x + dx))),
        Math.round(Math.max(0, Math.min(run.bounds.h - item.h, item.y + dy)))
      )
    }
  }
  function end(e: ReactPointerEvent) {
    if (drag.current?.pointer === e.pointerId) drag.current = null
  }
  return (
    <div
      ref={host}
      className={'atlas-stage' + (onSelect ? ' atlas-editable' : '')}
      onPointerMove={move}
      onPointerCancel={end}
      onPointerUp={end}
      onLostPointerCapture={end}
      onPointerDown={() => onSelect?.('')}
    >
      <div
        className="atlas-stage-space"
        style={{
          backgroundColor: slide.color,
          transform: 'scale(' + scale + ')',
        }}
      >
        {slide.background && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                filter:
                  'brightness(' +
                  (slide.effects?.brightness ?? 100) +
                  '%) blur(' +
                  (slide.effects?.blur ?? 0) +
                  'px)',
                transform: 'scale(' + (slide.effects?.zoom ?? 100) / 100 + ')',
                transformOrigin:
                  (slide.effects?.x ?? 50) +
                  '% ' +
                  (slide.effects?.y ?? 50) +
                  '%',
              }}
            >
              <SlideImage
                src={slide.background}
                background
                effects={slide.effects}
              />
            </div>
          </div>
        )}
        {fontError && <span className="overflow-badge">{fontError}</span>}
        {locations.map((v) => {
          const c = v.cell
          const show =
            isTextType(c.type) &&
            (showSource || !slide.items.some((o) => target(o) === v.id))
          const value = show ? sourceText(c) : ''
          return (
            <div
              key={v.id}
              data-slot={v.id}
              onPointerDown={(e) => {
                if (!onSlot || ['area', 'empty'].includes(c.type)) return
                e.stopPropagation()
                onSlot(v.id)
              }}
              onDoubleClick={(event) => {
                if (!show || !onSlotEdit) return
                event.stopPropagation()
                onSlotEdit(v.id)
              }}
              style={{
                position: 'absolute',
                left: v.outer.x,
                top: v.outer.y,
                width: v.outer.w,
                height: v.outer.h,
                background: c.fill,
                boxShadow: c.width
                  ? 'inset 0 0 0 ' +
                    c.width * v.scale +
                    'px ' +
                    (c.border ?? '#333333')
                  : undefined,
                outline:
                  onSelect && c.type === 'free'
                    ? '2px dashed #74918d'
                    : undefined,
                pointerEvents:
                  onSlot && !['area', 'empty'].includes(c.type)
                    ? 'auto'
                    : 'none',
              }}
            >
              {show && (
                <div
                  style={{
                    position: 'absolute',
                    left: v.box.x - v.outer.x,
                    top: v.box.y - v.outer.y,
                    width: v.box.w / v.scale,
                    height: v.box.h / v.scale,
                    transformOrigin: 'top left',
                    transform: 'scale(' + v.scale + ')',
                  }}
                >
                  <TextBlock
                    deck={deck}
                    editing={!!onSelect || !!diagnostics}
                    cell={c}
                    item={{
                      id: v.id,
                      type: 'text',
                      x: 0,
                      y: 0,
                      w: v.box.w / v.scale,
                      h: v.box.h / v.scale,
                      text: value,
                      src: '',
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
        {slide.items.map((original) => {
          if (
            original.hidden ||
            (showSource &&
              !original.fixed &&
              isTextType(
                locations.find((v) => v.id === target(original))?.cell.type
              ))
          )
            return null
          const p = pose(original, locations)
          if (!p) return null
          const factor = original.contentScale ?? 1
          const item = {
            ...p.item,
            w: p.item.w / factor,
            h: p.item.h / factor,
          }
          const hostSlot = !original.fixed
            ? locations.find((v) => v.id === target(original))
            : undefined
          const clip = hostSlot?.cell.type === 'free' ? hostSlot.box : undefined
          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                clipPath: clip
                  ? 'inset(' +
                    clip.y +
                    'px ' +
                    (1280 - clip.x - clip.w) +
                    'px ' +
                    (720 - clip.y - clip.h) +
                    'px ' +
                    clip.x +
                    'px)'
                  : undefined,
              }}
            >
              <div
                data-item={item.id}
                style={{
                  position: 'absolute',
                  left: p.x + p.item.x * p.k,
                  top: p.y + p.item.y * p.k,
                  transformOrigin: '0 0',
                  transform: 'scale(' + p.k * factor + ')',
                  pointerEvents: onSelect ? 'auto' : 'none',
                }}
              >
                <div
                  key={item.id}
                  className={
                    'atlas-item' +
                    (selected === item.id ? ' atlas-selected' : '')
                  }
                  style={{
                    left: 0,
                    top: 0,
                    width: item.w,
                    height: item.h,
                    opacity: item.opacity,
                    transform: `rotate(${item.rotation ?? 0}deg) scale(${item.flipX ? -1 : 1},${item.flipY ? -1 : 1})`,
                    filter: item.shadow
                      ? `drop-shadow(${item.shadow.x}px ${item.shadow.y}px ${item.shadow.blur}px ${item.shadow.color})`
                      : undefined,
                  }}
                  onDoubleClick={() =>
                    !original.locked &&
                    (!original.fixed || design) &&
                    item.type !== 'image' &&
                    onEditText?.(item.id)
                  }
                  onPointerDown={(e) =>
                    start(
                      e,
                      original,
                      false,
                      p.k,
                      original.locked || (p.fixed && !design)
                    )
                  }
                >
                  {item.type === 'image' ? (
                    <SlideImage src={item.src} item={item} />
                  ) : (
                    <>
                      {item.type === 'shape' && <VectorShape item={item} />}
                      {(item.type === 'text' ||
                        item.text ||
                        item.paragraphs) && (
                        <TextBlock
                          onText={
                            onText &&
                            !original.locked &&
                            (!original.fixed || design)
                              ? (fields) => onText(item.id, fields)
                              : undefined
                          }
                          item={item}
                          cell={hostSlot?.cell}
                          autoEdit={editItem === item.id}
                          registerText={registerText}
                          undo={undo}
                          onEdit={() => onEditText?.(item.id)}
                          deck={deck}
                          editing={!!onSelect || !!diagnostics}
                        />
                      )}
                    </>
                  )}
                  {!original.locked &&
                    (!original.fixed || design) &&
                    selected === item.id &&
                    onNodes &&
                    item.nodes && (
                      <PathHandles
                        item={item}
                        change={(nodes) => onNodes(item.id, nodes)}
                      />
                    )}
                  {!original.locked &&
                    (!p.fixed || design) &&
                    selected === item.id &&
                    onResize && (
                      <span
                        className="atlas-resize"
                        aria-label="Изменить размер"
                        onPointerDown={(e) => start(e, original, true, p.k)}
                      />
                    )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

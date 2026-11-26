import { useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  Bold,
  Ellipsis,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react'
import { IconButton } from './IconButton'
import { fontCatalog } from './fontCatalog'
import type { Characters, Deck, TextStyle } from './model'
import type { TextSelectionControls } from './VisualText'

const margin = 8
const gap = 10

export function TextEditToolbar({
  anchor,
  toolbar,
  deck,
  style,
  controls,
  systemLabel,
  change,
  focusText,
  finish,
}: {
  anchor: HTMLElement
  toolbar: RefObject<HTMLDivElement | null>
  deck: Deck
  style: TextStyle
  controls: TextSelectionControls | null
  systemLabel?: string
  change: (fields: Characters, returnFocus?: boolean) => void
  focusText: () => void
  finish: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [sizeDraft, setSizeDraft] = useState<string>()
  const values = { ...style, ...controls?.values }
  const font = values.font ?? 'sans'
  const variants = Object.hasOwn(fontCatalog, font)
    ? fontCatalog[font]
    : undefined
  const fonts = [
    ...Object.entries(fontCatalog).map(([id, face]) => ({
      id,
      label: face.label,
    })),
    ...deck.resources.fonts,
  ]

  useLayoutEffect(() => {
    const bar = toolbar.current!
    const browser = anchor.ownerDocument.defaultView!
    const canvas = anchor.closest('.canvas')
    const stage = anchor.closest('.atlas-stage-space')
    const viewport = anchor.closest('.canvas-viewport')
    const position = () => {
      const rect = anchor.getBoundingClientRect()
      const clip = viewport?.getBoundingClientRect()
      const { innerHeight, innerWidth } = browser
      const topEdge = Math.max(rect.top, clip?.top ?? 0, 0)
      const bottomEdge = Math.min(
        rect.bottom,
        clip?.bottom ?? innerHeight,
        innerHeight
      )
      const leftEdge = Math.max(rect.left, clip?.left ?? 0, 0)
      const width = bar.offsetWidth
      const height = bar.offsetHeight
      const above = topEdge - gap - height
      const below = bottomEdge + gap
      const top =
        above >= margin || below + height > innerHeight - margin ? above : below
      bar.style.left =
        Math.max(margin, Math.min(leftEdge, innerWidth - width - margin)) + 'px'
      bar.style.top =
        Math.max(margin, Math.min(top, innerHeight - height - margin)) + 'px'
    }
    position()
    const resize = new ResizeObserver(position)
    resize.observe(anchor)
    resize.observe(bar)
    if (viewport) resize.observe(viewport)
    const camera = new MutationObserver(position)
    for (const element of [canvas, stage]) {
      if (element)
        camera.observe(element, {
          attributes: true,
          attributeFilter: ['style'],
        })
    }
    browser.addEventListener('resize', position)
    browser.addEventListener('scroll', position, true)
    return () => {
      resize.disconnect()
      camera.disconnect()
      browser.removeEventListener('resize', position)
      browser.removeEventListener('scroll', position, true)
    }
  }, [anchor, toolbar])

  return createPortal(
    <div
      className="atlas-text-toolbar"
      role="group"
      aria-label="Форматирование текста"
      data-text-controls
      ref={toolbar}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if ((event.target as Element).closest('button')) event.preventDefault()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish()
        }
      }}
    >
      {systemLabel && (
        <span
          className="atlas-text-toolbar-type"
          title="Изменения применяются ко всем полям этого типа"
        >
          {systemLabel}
        </span>
      )}
      <div className="atlas-text-toolbar-row">
        <select
          aria-label="Гарнитура"
          title="Гарнитура"
          value={font}
          onChange={(event) => change({ font: event.target.value })}
        >
          {fonts.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="atlas-text-toolbar-size"
          type="number"
          aria-label="Размер шрифта"
          title="Размер шрифта"
          value={sizeDraft ?? values.size ?? 32}
          min={1}
          max={1024}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setSizeDraft(undefined)}
          onChange={(event) => {
            const { value, valueAsNumber } = event.currentTarget
            setSizeDraft(value)
            if (
              Number.isFinite(valueAsNumber) &&
              valueAsNumber >= 1 &&
              valueAsNumber <= 1024
            )
              change({ size: valueAsNumber }, false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              focusText()
            }
          }}
        />
        <span className="atlas-text-toolbar-divider" aria-hidden="true" />
        <IconButton
          label="Полужирный"
          disabled={!variants?.weights.includes(700)}
          aria-pressed={Number(values.weight ?? 400) >= 700}
          onClick={() =>
            change({
              weight: Number(values.weight ?? 400) >= 700 ? '400' : '700',
            })
          }
        >
          <Bold />
        </IconButton>
        <IconButton
          label="Курсив"
          disabled={!variants?.italic}
          aria-pressed={!!values.italic}
          onClick={() => change({ italic: !values.italic })}
        >
          <Italic />
        </IconButton>
        <IconButton
          label="Подчёркивание"
          aria-pressed={!!values.underline}
          onClick={() => change({ underline: !values.underline })}
        >
          <Underline />
        </IconButton>
        <IconButton
          label="Зачёркивание"
          aria-pressed={!!values.strike}
          onClick={() => change({ strike: !values.strike })}
        >
          <Strikethrough />
        </IconButton>
        <label className="atlas-text-toolbar-color" title="Цвет текста">
          <Type />
          <input
            type="color"
            aria-label="Цвет текста"
            value={values.color ?? '#183e45'}
            onChange={(event) => change({ color: event.target.value }, false)}
          />
          <span style={{ backgroundColor: values.color ?? '#183e45' }} />
        </label>
        {controls && (
          <IconButton
            label="Дополнительное форматирование"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Ellipsis />
          </IconButton>
        )}
      </div>
      {controls && expanded && (
        <div className="atlas-text-toolbar-row atlas-text-toolbar-more">
          <IconButton
            label="Маркированный список"
            aria-pressed={controls.listKind === 'bullet'}
            onClick={() => controls.list('bullet')}
          >
            <List />
          </IconButton>
          <IconButton
            label="Нумерованный список"
            aria-pressed={controls.listKind === 'number'}
            onClick={() => controls.list('number')}
          >
            <ListOrdered />
          </IconButton>
          <IconButton
            label="Уменьшить отступ"
            onClick={() => controls.indent(-24)}
          >
            <IndentDecrease />
          </IconButton>
          <IconButton
            label="Увеличить отступ"
            onClick={() => controls.indent(24)}
          >
            <IndentIncrease />
          </IconButton>
          <label
            className="atlas-text-toolbar-color"
            title="Выделение маркером"
          >
            <Highlighter />
            <input
              type="color"
              aria-label="Выделение маркером"
              value={values.highlight ?? '#fff4aa'}
              onChange={(event) =>
                change({ highlight: event.target.value }, false)
              }
            />
            <span style={{ backgroundColor: values.highlight ?? '#fff4aa' }} />
          </label>
          <input
            type="number"
            aria-label="Интервал после абзаца"
            title="Интервал после абзаца"
            min={0}
            max={256}
            value={controls.paragraphAfter ?? style.paragraphSpacing ?? 0}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              if (Number.isFinite(value) && value >= 0 && value <= 256)
                controls.spacing(value)
            }}
          />
          <IconButton
            label="Сбросить форматирование"
            onClick={() => controls.appearance(null)}
          >
            <RemoveFormatting />
          </IconButton>
        </div>
      )}
    </div>,
    anchor.ownerDocument.body
  )
}

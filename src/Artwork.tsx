import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  paragraphs,
  typography,
  itemTextType,
  type Characters,
  type Deck,
  type FontAsset,
  type Item,
  type PathNode,
} from './model'
import { fontCatalog, fontPath } from './fontCatalog'
import type { Cell } from './grid'
import { VisualText, type TextSelectionControls } from './VisualText'

const builtinDocuments = new WeakSet<Document>()
function installBuiltins(doc: Document) {
  if (builtinDocuments.has(doc)) return
  builtinDocuments.add(doc)
  for (const [id, font] of Object.entries(fontCatalog)) {
    for (const [file, weight, style, unicodeRange] of font.faces) {
      doc.fonts.add(
        new FontFace(
          'Atlas-' + id,
          'url(' + new URL(fontPath(id, file), doc.baseURI).href + ')',
          {
            weight,
            style,
            ...(unicodeRange ? { unicodeRange } : {}),
            display: 'swap',
          }
        )
      )
    }
  }
}
const assets = new WeakMap<FontAsset, string>()
export function fontFamily(id: string | undefined, deck?: Deck) {
  const font = deck?.resources.fonts.find((f) => f.id === id)
  if (!font)
    return (
      (id === 'legacy'
        ? 'Arial'
        : 'Atlas-' + (id && Object.hasOwn(fontCatalog, id) ? id : 'sans')) +
      ', Atlas-sans, Arial, sans-serif'
    )
  if (!assets.has(font)) assets.set(font, 'AtlasUser' + crypto.randomUUID())
  return assets.get(font) + ', Atlas-sans, sans-serif'
}
const registered = new WeakMap<
  Document,
  Map<string, { face: FontFace; count: number }>
>()
export function useFonts(
  host: React.RefObject<HTMLDivElement | null>,
  deck?: Deck
) {
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    const doc = host.current?.ownerDocument
    if (!doc) return
    installBuiltins(doc)
    if (!deck) return
    let active = true
    setError('')
    const cache = registered.get(doc) ?? new Map()
    registered.set(doc, cache)
    const keys = deck.resources.fonts.map((f) => {
      const key = fontFamily(f.id, deck).split(',')[0]
      if (!cache.has(key)) {
        const face = new FontFace(
          key,
          'url(data:font/' + f.format + ';base64,' + f.data + ')'
        )
        doc.fonts.add(face)
        cache.set(key, { face, count: 0 })
      }
      const entry = cache.get(key)!
      entry.count++
      entry.face.load().catch(() => {
        if (active)
          setError(
            'Шрифт «' + f.label + '» недоступен. Используется DejaVu Sans.'
          )
      })
      return key
    })
    return () => {
      active = false
      for (const key of keys) {
        const e = cache.get(key)!
        if (!--e.count) {
          doc.fonts.delete(e.face)
          cache.delete(key)
        }
      }
    }
  }, [deck?.resources.fonts, host])
  return error
}
function chars(s: Characters, deck?: Deck): CSSProperties {
  const font =
    s.font && Object.hasOwn(fontCatalog, s.font)
      ? fontCatalog[s.font]
      : undefined
  const requested = Number(s.weight ?? 400)
  const weight =
    font?.weights.reduce(
      (near, n) =>
        Math.abs(n - requested) < Math.abs(near - requested) ? n : near,
      font.weights[0]
    ) ?? requested
  return {
    fontFamily: s.font ? fontFamily(s.font, deck) : undefined,
    color: s.color,
    fontWeight: weight,
    fontStyle: s.italic && (font?.italic ?? false) ? 'italic' : 'normal',
    textDecoration:
      [s.underline ? 'underline' : '', s.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ') || 'none',
    backgroundColor: s.highlight,
    letterSpacing: s.tracking,
  }
}
function effectColor(color: string, opacity: number) {
  return (
    color +
    Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0')
  )
}
export function TextBlock({
  item,
  deck,
  cell,
  editing,
  autoEdit,
  onEdit,
  onText,
  registerText,
  undo,
}: {
  item: Item
  deck?: Deck
  cell?: Cell
  editing: boolean
  autoEdit?: boolean
  onEdit?: () => void
  undo?: (redo: boolean) => void
  onText?: (fields: Partial<Item>) => void
  registerText?: (controls: TextSelectionControls | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const style = typography(item, deck, cell)
  const flexible = itemTextType(item, cell) === 'text'
  const [active, setActive] = useState(!!autoEdit)
  const [overflow, setOverflow] = useState(false)
  const padding = Array.isArray(style.padding)
    ? style.padding
    : Array(4).fill(style.padding)
  const [top, right, bottom, left] = padding
  useLayoutEffect(() => {
    const el = box.current!
    const content = el.firstElementChild as HTMLElement
    let live = true
    function measure() {
      if (!live) return
      function fits(size: number) {
        content.style.fontSize = size + 'px'
        return (
          content.scrollHeight <= el.clientHeight - top - bottom + 1 &&
          content.scrollWidth <= el.clientWidth - left - right + 1
        )
      }
      let ok = fits(style.size)
      if (!ok && style.fit) {
        let low = Math.min(style.minSize, style.size),
          high = style.size
        ok = fits(low)
        if (ok) {
          for (let i = 0; i < 10; i++) {
            const mid = (low + high) / 2
            if (fits(mid)) low = mid
            else high = mid
          }
          fits(low)
        }
      }
      setOverflow(!ok)
    }
    measure()
    const fonts = el.ownerDocument.fonts
    void fonts.ready.then(measure)
    fonts.addEventListener('loadingdone', measure)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', measure)
    }
  }, [item, deck?.theme, deck?.resources, cell, active])
  let number = 0
  const { textShadow: shadow, textGlow: glow, textStroke: stroke } = style
  const runStyle = (run: Characters): CSSProperties => {
    const applied = chars({ ...style, ...run }, deck)
    if (run.size !== undefined) applied.fontSize = run.size / style.size + 'em'
    return applied
  }
  return (
    <>
      <div
        ref={box}
        className="atlas-slide-text"
        data-overflow={overflow || undefined}
        onDoubleClick={(event) => {
          if (!onText) return
          event.preventDefault()
          event.stopPropagation()
          onEdit?.()
          setActive(true)
        }}
        style={{
          padding: padding.map((n) => n + 'px').join(' '),
          boxSizing: 'border-box',
          textAlign: style.align,
          lineHeight: style.leading,
          justifyContent:
            style.verticalAlign === 'bottom'
              ? 'safe end'
              : style.verticalAlign === 'middle'
                ? 'safe center'
                : 'start',
        }}
      >
        <div
          style={
            {
              ...chars(style, deck),
              backgroundColor: undefined,
              textDecoration: undefined,
              fontSize: style.size,
              fontFamily: fontFamily(style.font, deck),
              textShadow:
                [
                  shadow &&
                    `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${effectColor(shadow.color, shadow.opacity)}`,
                  glow &&
                    `0 0 ${glow.radius}px ${effectColor(glow.color, glow.intensity)}`,
                ]
                  .filter(Boolean)
                  .join(', ') || undefined,
              WebkitTextStroke: stroke
                ? `${stroke.width}px ${effectColor(stroke.color, stroke.opacity)}`
                : undefined,
              '--atlas-paragraph-spacing': (style.paragraphSpacing ?? 0) + 'px',
            } as CSSProperties
          }
        >
          {active && onText ? (
            <VisualText
              item={item}
              flexible={flexible}
              onText={onText}
              finish={() => setActive(false)}
              register={registerText}
              undo={undo}
              runStyle={runStyle}
            />
          ) : (
            paragraphs(
              flexible ? item : { ...item, paragraphs: undefined }
            ).map((p, i, parts) => {
              number = p.list === 'number' ? number + 1 : 0
              return (
                <div
                  key={i}
                  style={{
                    paddingLeft: p.indent,
                    marginBottom:
                      p.after ??
                      (i + 1 < parts.length
                        ? style.paragraphSpacing
                        : undefined),
                    display: 'flex',
                    justifyContent:
                      style.align === 'center'
                        ? 'center'
                        : style.align === 'right'
                          ? 'flex-end'
                          : 'flex-start',
                  }}
                >
                  {p.list && (
                    <span style={{ marginRight: '.35em' }}>
                      {p.list === 'bullet' ? '•' : number + '.'}
                    </span>
                  )}
                  <div
                    style={{
                      minWidth: 0,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {p.runs.map((run, j) => (
                      <span key={j} style={runStyle(run)}>
                        {run.text || '​'}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      {overflow && editing && (
        <span className="overflow-badge">Текст не помещается</span>
      )}
    </>
  )
}
export function pathData(
  nodes: PathNode[],
  w: number,
  h: number,
  closed = false
) {
  const point = (p: PathNode) => (p.x * w) / 100 + ' ' + (p.y * h) / 100
  const edge = (a: PathNode, b: PathNode) =>
    a.out || b.in
      ? 'C' + point(a.out ?? a) + ' ' + point(b.in ?? b) + ' ' + point(b)
      : 'L' + point(b)
  return (
    'M' +
    point(nodes[0]) +
    nodes
      .slice(1)
      .map((p, i) => edge(nodes[i], p))
      .join('') +
    (closed ? edge(nodes[nodes.length - 1], nodes[0]) + 'Z' : '')
  )
}
export function VectorShape({ item }: { item: Item }) {
  const gid = 'g' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { w, h, shape, fill } = item
  const open =
    ['line', 'polyline', 'curve'].includes(shape!) ||
    (shape === 'path' && !item.closed)
  const points = (v: number[][]) =>
    v.map(([x, y]) => x * w + ',' + y * h).join(' ')
  const rotation =
    ((fill?.type === 'linear' ? (fill.angle ?? 0) : 0) * Math.PI) / 180
  const gradient = fill && 'stops' in fill
  const stops = gradient
    ? fill.stops.map((s, i) => (
        <stop key={i} offset={s.offset} stopColor={s.color} />
      ))
    : null
  let body
  switch (shape) {
    case 'circle':
      body = <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2} />
      break
    case 'ellipse':
      body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
      break
    case 'triangle':
      body = (
        <polygon
          points={points([
            [0.5, 0],
            [1, 1],
            [0, 1],
          ])}
        />
      )
      break
    case 'polygon':
      body = (
        <polygon
          points={points([
            [0.25, 0],
            [0.75, 0],
            [1, 0.5],
            [0.75, 1],
            [0.25, 1],
            [0, 0.5],
          ])}
        />
      )
      break
    case 'star':
      body = (
        <polygon
          points={points(
            Array.from({ length: 10 }, (_, i) => {
              const a = (i * Math.PI) / 5 - Math.PI / 2,
                r = i % 2 ? 0.22 : 0.5
              return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]
            })
          )}
        />
      )
      break
    case 'arrow':
      body = (
        <polygon
          points={points([
            [0, 0.33],
            [0.63, 0.33],
            [0.63, 0],
            [1, 0.5],
            [0.63, 1],
            [0.63, 0.67],
            [0, 0.67],
          ])}
        />
      )
      break
    case 'line':
      body = <line x1={0} y1={h / 2} x2={w} y2={h / 2} />
      break
    case 'polyline':
      body = (
        <polyline
          points={points([
            [0, 0.8],
            [0.32, 0.25],
            [0.65, 0.65],
            [1, 0.12],
          ])}
        />
      )
      break
    case 'curve':
      body = (
        <path
          d={pathData(
            [
              { x: 0, y: 80, out: { x: 25, y: -40 } },
              { x: 100, y: 20, in: { x: 75, y: 140 } },
            ],
            w,
            h
          )}
        />
      )
      break
    case 'path':
      body = <path d={pathData(item.nodes!, w, h, item.closed)} />
      break
    default:
      body = (
        <rect
          width={w}
          height={h}
          rx={item.radius ?? (shape === 'rounded' ? 24 : 0)}
        />
      )
  }
  return (
    <svg className="atlas-shape" width={w} height={h} aria-hidden="true">
      <defs>
        {gradient &&
          (fill.type === 'linear' ? (
            <linearGradient
              id={gid}
              x1={0.5 - Math.cos(rotation) / 2}
              y1={0.5 - Math.sin(rotation) / 2}
              x2={0.5 + Math.cos(rotation) / 2}
              y2={0.5 + Math.sin(rotation) / 2}
            >
              {stops}
            </linearGradient>
          ) : (
            <radialGradient id={gid}>{stops}</radialGradient>
          ))}
      </defs>
      <g
        fill={
          open || fill?.type === 'none'
            ? 'none'
            : gradient
              ? 'url(#' + gid + ')'
              : fill?.type === 'solid'
                ? fill.color
                : '#bde6dd'
        }
        stroke={item.stroke ?? '#275b68'}
        strokeWidth={item.strokeWidth ?? 0}
        strokeDasharray={item.dash?.join(' ')}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {body}
      </g>
    </svg>
  )
}

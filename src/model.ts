import {
  defaultMaster,
  mediaSlides,
  validateGrid,
  checkBindings,
  type Master,
  type Grid,
  type Insets,
  type Cell,
  slots,
} from './grid.ts'
import {
  builtinFonts,
  check,
  definitions,
  legacyDefinitions,
  FORMAT_VERSION,
  type shapes,
} from './schema.ts'
import {
  defaultSystemStyles,
  isTextType,
  textTypes as textTypeLabels,
  textTypeIds,
  type SystemStyles,
  type TextType,
} from './textTypes.ts'
import { fontCatalog } from './fontCatalog.ts'
import { migrateTypography } from './migrateTypography.ts'
export const CANVAS_WIDTH = 1280,
  CANVAS_HEIGHT = 720
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}
export interface PathNode extends Point {
  in?: Point
  out?: Point
}
export type Shape = keyof typeof shapes
export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | {
      type: 'linear' | 'radial'
      angle?: number
      stops: { offset: number; color: string }[]
    }
export interface Characters {
  font?: string
  size?: number
  color?: string
  weight?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  highlight?: string
  tracking?: number
}
export interface TextStyle extends Characters {
  align?: 'left' | 'center' | 'right'
  leading?: number
  padding?: Insets | number
  verticalAlign?: 'top' | 'middle' | 'bottom'
  paragraphSpacing?: number
  textShadow?: {
    color: string
    opacity: number
    x: number
    y: number
    blur: number
  }
  textStroke?: { color: string; opacity: number; width: number }
  textGlow?: { color: string; intensity: number; radius: number }
  fit?: boolean
  minSize?: number
}
export interface Paragraph {
  runs: (Characters & { text: string })[]
  list?: 'bullet' | 'number'
  indent?: number
  after?: number
}
export interface Item extends Box {
  layerName?: string
  hidden?: boolean
  locked?: boolean
  imageFit?: 'contain' | 'cover'
  focusX?: number
  focusY?: number
  priorSlot?: string
  slot?: string
  group?: string
  relation?: string
  fixed?: boolean
  contentScale?: number
  id: string
  type: 'text' | 'image' | 'shape'
  text: string
  src: string
  size?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  textType?: TextType
  role?: 'content' | 'decoration'
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  style?: string
  overrides?: TextStyle
  paragraphs?: Paragraph[]
  shape?: Shape
  fill?: Fill
  stroke?: string
  strokeWidth?: number
  dash?: number[]
  radius?: number
  shadow?: { x: number; y: number; blur: number; color: string }
  nodes?: PathNode[]
  closed?: boolean
}
export interface Slide {
  structure?: Grid
  header?: string
  footer?: string
  id: string
  color: string
  ownBackground?: boolean
  effects?: {
    brightness?: number
    blur?: number
    zoom?: number
    x?: number
    y?: number
    fit?: 'cover' | 'contain'
  }
  background: string | null
  notes: string
  items: Item[]
  area?: Box
  kind?: 'title' | 'normal' | 'end'
}
export interface FontAsset {
  id: string
  label: string
  format: 'woff2' | 'woff' | 'ttf' | 'otf'
  data: string
}
export interface NamedStyle {
  id: string
  label: string
  values: TextStyle
}
export interface Deck {
  version: 4
  master: Master
  migrated?: boolean
  header?: string
  footer?: string
  id: string
  title: string
  canvas: { width: 1280; height: 720 }
  theme: { systemStyles: SystemStyles; styles: NamedStyle[]; palette: string[] }
  resources: { fonts: FontAsset[] }
  slides: Slide[]
}
export function newSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    color: '#ffffff',
    background: null,
    notes: '',
    items: [],
  }
}
export function newDeck(title: string): Deck {
  return {
    version: FORMAT_VERSION,
    master: defaultMaster(),
    id: crypto.randomUUID(),
    title: title.trim() || 'Без названия',
    canvas: { width: 1280, height: 720 },
    theme: {
      palette: ['#163e49', '#e5f4ef', '#f8bd56'],
      systemStyles: defaultSystemStyles(),
      styles: [],
    },
    resources: { fonts: [] },
    slides: [newSlide()],
  }
}
export function newText(): Item {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x: 80,
    y: 80,
    w: 560,
    h: 140,
    text: 'Новый текст',
    src: '',
  }
}
export function newShape(shape: Shape = 'rounded'): Item {
  const open = ['line', 'polyline', 'curve', 'path'].includes(shape)
  return {
    ...newText(),
    type: 'shape',
    shape,
    w: 320,
    h: 180,
    text: '',
    fill: { type: 'solid', color: '#bde6dd' },
    stroke: '#275b68',
    strokeWidth: open ? 5 : 0,
    ...(shape === 'path'
      ? {
          nodes: [
            { x: 0, y: 90 },
            { x: 45, y: 10 },
            { x: 100, y: 85 },
          ],
          closed: false,
        }
      : {}),
  }
}
export function itemTextType(item: Item, cell?: Cell): TextType {
  return isTextType(cell?.type) ? cell.type : (item.textType ?? 'text')
}
export function activeTextStyleId(item?: Item, cell?: Cell): string {
  const type = isTextType(cell?.type) ? cell.type : (item?.textType ?? 'text')

  if (type !== 'text') return type

  return cell?.textStyle ?? item?.style ?? 'text'
}

export function typography(item: Item, deck?: Deck, cell?: Cell) {
  const type = itemTextType(item, cell)
  const defaults = defaultSystemStyles()
  const system = deck?.theme.systemStyles[type] ?? defaults[type]
  const id = cell?.textStyle ?? item.style
  return {
    font: 'sans',
    color: '#183e45',
    align: 'left' as NonNullable<TextStyle['align']>,
    size: 32,
    leading: 1.18,
    fit: true,
    minSize: 16,
    padding: 0,
    ...system,
    ...(type === 'text'
      ? {
          ...deck?.theme.styles.find((s) => s.id === id)?.values,
          ...item.overrides,
        }
      : {}),
  }
}

export function sourceText(cell: Cell): string {
  return cell.value ?? (isTextType(cell.type) ? textTypeLabels[cell.type] : '')
}
export function replaceStyle(deck: Deck, id: string, next?: string): Deck {
  const copy = structuredClone(deck)
  copy.theme.styles = copy.theme.styles.filter((s) => s.id !== id)
  const slides = mediaSlides(copy)
  const grids = [
    ...Object.values(copy.master.schemes),
    ...slides.flatMap((s) => (s.structure ? [s.structure] : [])),
  ]
  for (const grid of grids)
    for (const cell of grid.cells) {
      if (cell.textStyle !== id) continue
      if (next) cell.textStyle = next
      else delete cell.textStyle
    }
  for (const slide of slides)
    for (const item of slide.items) {
      if (item.style !== id) continue
      if (next) item.style = next
      else delete item.style
    }
  return copy
}

export function paragraphs(item: Item): Paragraph[] {
  return (
    item.paragraphs ??
    item.text.split('\n').map((text) => ({ runs: [{ text }] }))
  )
}
export function richText(parts: Paragraph[]): Partial<Item> {
  return {
    paragraphs: parts,
    text: parts.map((p) => p.runs.map((r) => r.text).join('')).join('\n'),
  }
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function imageSource(value: unknown): string {
  requireValue(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 24 * 1024 * 1024,
    'Некорректная ссылка или слишком большое изображение.'
  )
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',')
    requireValue(
      comma > 0 && comma < 32,
      'Некорректное встроенное изображение.'
    )
    const mime = value.slice(0, comma)
    const data = value.slice(comma + 1)
    requireValue(
      data.length > 0 &&
        data.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+=*$/.test(data) &&
        !data.endsWith('==='),
      'Некорректные данные изображения.'
    )
    const signature = atob(data.slice(0, 16))
    const ok =
      (mime === 'data:image/png;base64' &&
        signature.startsWith('\x89PNG\r\n\x1a\n')) ||
      (mime === 'data:image/jpeg;base64' &&
        signature.startsWith('\xff\xd8\xff')) ||
      (mime === 'data:image/webp;base64' &&
        signature.startsWith('RIFF') &&
        signature.slice(8, 12) === 'WEBP')
    requireValue(ok, 'Поддерживаются встроенные PNG, JPEG и WebP.')
    return value
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Не удалось прочитать ссылку на изображение.')
  }
  requireValue(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      value.length <= 8192,
    'Для внешних изображений требуется публичный HTTPS-адрес.'
  )
  return url.href
}

const signatures = {
  woff: 'wOFF',
  woff2: 'wOF2',
  ttf: '\x00\x01\x00\x00',
  otf: 'OTTO',
}
export function verifyFont(font: FontAsset) {
  requireValue(
    !Object.hasOwn(builtinFonts, font.id),
    'Идентификатор шрифта занят.'
  )
  requireValue(
    font.data.length <= 5592408 &&
      font.data.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(font.data) &&
      atob(font.data.slice(0, 8)).startsWith(signatures[font.format]),
    'Некорректный шрифт ' + font.label + ' (до 4 МиБ).'
  )
}
export function readJSON(raw: string): unknown {
  requireValue(
    raw.length <= MAX_DOCUMENT_BYTES &&
      new Blob([raw]).size <= MAX_DOCUMENT_BYTES,
    'Файл превышает 64 МБ.'
  )
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Не удалось прочитать JSON. Проверьте синтаксис.')
  }
}
export function validateDeck(
  input: unknown,
  recoveryFonts: FontAsset[] = []
): Deck {
  const raw = typeof input === 'string' ? readJSON(input) : input
  requireValue(
    raw &&
      typeof raw === 'object' &&
      'version' in raw &&
      [1, 2, 3, FORMAT_VERSION].includes(Number(raw.version)),
    'Неизвестная версия презентации.'
  )
  const legacy = raw.version === 1
  if (raw.version === 2) {
    requireValue(
      !['master', 'header', 'footer', 'migrated'].some((k) => k in raw),
      'Поля сеточной модели требуют version=3.'
    )
    if ('slides' in raw && Array.isArray(raw.slides))
      for (const s of raw.slides) {
        if (s && typeof s === 'object') {
          requireValue(
            !['structure', 'header', 'footer'].some((k) => k in s),
            'Размещение в сетке требует version=3.'
          )
          if (Array.isArray(s.items))
            for (const o of s.items)
              if (o && typeof o === 'object')
                requireValue(
                  ![
                    'slot',
                    'priorSlot',
                    'fixed',
                    'group',
                    'relation',
                    'contentScale',
                    'imageFit',
                    'focusX',
                    'focusY',
                  ].some((k) => k in o),
                  'Свойства размещения требуют version=3.'
                )
        }
      }
  }
  const normalized =
    raw.version === 2
      ? { ...raw, version: 3, master: defaultMaster(), migrated: true }
      : raw
  const current = raw.version === FORMAT_VERSION
  const rules = current ? definitions : legacyDefinitions
  check(
    rules[legacy ? 'Legacy' : 'Presentation'],
    normalized,
    'Презентация',
    rules
  )
  const source = structuredClone(normalized) as Deck
  const d = current
    ? source
    : migrateTypography(
        legacy
          ? {
              ...newDeck(source.title),
              migrated: true,
              id: source.id,
              slides: source.slides,
            }
          : source,
        legacy,
        recoveryFonts
      )
  if (!current) check(definitions.Presentation, d, 'Презентация')
  for (const g of Object.values(d.master.schemes)) validateGrid(g, false)
  requireValue(d.title.trim(), 'Введите название.')
  const ids = new Set<string>()
  function unique(id: string, group: Set<string>, path: string) {
    requireValue(!group.has(id), path + ' — повторяется идентификатор ' + id)
    group.add(id)
  }
  unique(d.id.toLowerCase(), ids, 'Презентация')
  const styles = new Set<string>(),
    fonts = new Set<string>()
  for (const f of d.resources.fonts) {
    unique(f.id, fonts, 'Шрифт')
    verifyFont(f)
  }
  for (const s of d.theme.styles) {
    requireValue(
      !isTextType(s.id) && s.label.trim(),
      'Некорректное имя пользовательского стиля.'
    )
    unique(s.id, styles, 'Стиль')
  }
  const grids = [
    ...Object.values(d.master.schemes),
    ...d.slides.flatMap((s) => (s.structure ? [s.structure] : [])),
  ]
  for (const g of grids)
    for (const c of g.cells) {
      requireValue(
        isTextType(c.type) === (typeof c.value === 'string'),
        'Исходный текст обязателен для текстовой ячейки ' + c.id + '.'
      )
      requireValue(
        !c.textStyle || (c.type === 'text' && styles.has(c.textStyle)),
        'Не определён стиль ячейки ' + c.id
      )
      requireValue(
        !c.bindingType || c.type === 'text',
        'Некорректный тип привязки ячейки ' + c.id
      )
    }
  const checkFont = (style: Characters) => {
    requireValue(
      !style.font ||
        Object.hasOwn(builtinFonts, style.font) ||
        fonts.has(style.font),
      'Не определён шрифт ' + style.font + '. Добавьте файл шрифта в документ.'
    )
    if (!style.font || !Object.hasOwn(fontCatalog, style.font)) return
    const font = fontCatalog[style.font]
    requireValue(
      !style.italic || font.italic,
      'У гарнитуры ' + font.label + ' нет курсива.'
    )
    requireValue(
      !style.weight || font.weights.includes(Number(style.weight)),
      'У гарнитуры ' + font.label + ' нет этой насыщенности.'
    )
  }
  for (const type of textTypeIds) checkFont(d.theme.systemStyles[type])
  for (const s of d.theme.styles) checkFont(s.values)
  for (const [kind, layer] of Object.entries(d.master.art ?? {})) {
    requireValue(
      layer.kind === kind &&
        layer.notes === '' &&
        !layer.structure &&
        layer.items.every((o) => o.fixed && o.slot !== 'tray'),
      'Слой оформления должен содержать закреплённый декор своей схемы.'
    )
  }
  for (const [i, s] of mediaSlides(d).entries()) {
    const path = 'Слайд ' + (i + 1)
    try {
      if (s.structure) validateGrid(s.structure, true)
      checkBindings(d, s)
    } catch (e) {
      throw Error(path + ' — ' + (e as Error).message)
    }
    unique(s.id.toLowerCase(), ids, path)
    if (s.background !== null) {
      try {
        imageSource(s.background)
      } catch (e) {
        throw new Error(path + ' — ' + (e as Error).message)
      }
    }
    const locations = new Map(slots(d.master, s).map((v) => [v.id, v.cell]))
    for (const [j, it] of s.items.entries()) {
      const where = path + ', объект ' + (j + 1)
      try {
        unique(it.id.toLowerCase(), ids, where)
        if (it.type === 'image') imageSource(it.src)
        const host = it.fixed ? undefined : locations.get(it.slot ?? 'free')
        if (itemTextType(it, host) !== 'text')
          requireValue(
            !it.style && !it.overrides && !it.paragraphs,
            'Системный тип допускает только простой текст.'
          )
        if (it.overrides) checkFont(it.overrides)
        it.paragraphs?.forEach((p) => p.runs.forEach(checkFont))
        if (it.style)
          requireValue(styles.has(it.style), 'Не определён стиль ' + it.style)
        if (it.paragraphs)
          requireValue(
            richText(it.paragraphs).text === it.text,
            'Поле text должно совпадать с текстом абзацев.'
          )
        requireValue(
          it.shape === 'path'
            ? !!it.nodes
            : !it.nodes && it.closed === undefined,
          'Укажите узлы только для произвольного контура path.'
        )
        if (it.fill && 'stops' in it.fill) {
          const stops = it.fill.stops
          requireValue(
            stops.every((s, k) => !k || s.offset >= stops[k - 1].offset),
            'Точки градиента должны идти по возрастанию.'
          )
        }
      } catch (e) {
        throw new Error(where + ' — ' + (e as Error).message)
      }
    }
  }
  return d
}

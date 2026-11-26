import { kinds, mediaSlides, slots, target, type Cell } from './grid.ts'
import type { Characters, Deck, FontAsset, Item, TextStyle } from './model.ts'
import { fontCatalog } from './fontCatalog.ts'
import { defaultSystemStyles, isTextType, textTypes } from './textTypes.ts'

function modernStyle<T extends Characters>(style: T): T {
  const { bold, ...rest } = style
  const next = {
    ...rest,
    ...(bold === undefined ? {} : { weight: bold ? '700' : '400' }),
  } as T
  const block = next as TextStyle
  if (typeof block.padding === 'number') {
    const p = block.padding
    block.padding = [p, p, p, p]
  }
  return next
}

function key(value: TextStyle) {
  return JSON.stringify(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  )
}

export function migrateTypography(
  deck: Deck,
  v1: boolean,
  recoveryFonts: FontAsset[]
): Deck {
  deck.version = 4
  const originalStyles = deck.theme.styles
  if (new Set(originalStyles.map((s) => s.id)).size !== originalStyles.length)
    throw Error('Повторяется идентификатор именованного стиля.')
  const occupied = new Set(originalStyles.map((s) => s.id))
  const remappedFonts = new Map<string, string>()
  const oldIds = new Set(deck.resources.fonts.map((font) => font.id))
  if (oldIds.size !== deck.resources.fonts.length)
    throw Error('Повторяется идентификатор гарнитуры.')
  for (const font of deck.resources.fonts) {
    if (
      !Object.hasOwn(fontCatalog, font.id) ||
      ['sans', 'serif', 'mono', 'legacy'].includes(font.id)
    )
      continue
    let id = 'user-' + font.id
    let i = 1
    while (oldIds.has(id)) id = 'user-' + font.id + '-' + ++i
    oldIds.add(id)
    remappedFonts.set(font.id, id)
    font.id = id
  }
  const knownFonts = new Set([
    ...Object.keys(fontCatalog),
    ...deck.resources.fonts.map((f) => f.id),
  ])
  const normalize = <T extends Characters>(value: T) => {
    const style = modernStyle(value)
    if (style.font && remappedFonts.has(style.font))
      style.font = remappedFonts.get(style.font)
    if (style.font && !knownFonts.has(style.font)) {
      const recovered = recoveryFonts.find((f) => f.id === style.font)
      if (recovered && deck.resources.fonts.length < 32) {
        deck.resources.fonts.push(structuredClone(recovered))
        knownFonts.add(recovered.id)
      } else style.font = 'sans'
    }
    if (style.font && Object.hasOwn(fontCatalog, style.font)) {
      const font = fontCatalog[style.font]
      if (style.italic && !font.italic) style.italic = false
      if (style.weight && !font.weights.includes(Number(style.weight)))
        style.weight = String(
          font.weights.includes(400) ? 400 : font.weights[0]
        )
    }
    return style
  }
  const systemStyles = defaultSystemStyles()
  const initialized = new Set<string>()
  deck.theme = { ...deck.theme, systemStyles, styles: [] }
  let counter = 0
  function nextId() {
    let id: string
    do id = 'migrated-style-' + ++counter
    while (occupied.has(id))
    occupied.add(id)
    return id
  }
  const styleIds = new Map<string, string>()
  for (const def of originalStyles) {
    const id = isTextType(def.id) ? nextId() : def.id
    styleIds.set(def.id, id)
    deck.theme.styles.push({ ...def, id, values: normalize(def.values) })
  }
  const named = (label: string, values: TextStyle) => {
    const match = deck.theme.styles.find(
      (style) => key(style.values) === key(values)
    )
    if (match) return match.id
    if (deck.theme.styles.length >= 128)
      throw Error(
        'Миграция требует больше 128 пользовательских стилей. Исходный документ сохранён.'
      )
    const id = nextId()
    deck.theme.styles.push({ id, label, values })
    return id
  }

  const masters = kinds.flatMap((kind) => deck.master.schemes[kind].cells)
  for (const cell of masters) {
    if (
      (cell.type === 'header' || cell.type === 'footer') &&
      deck[cell.type] !== undefined
    )
      cell.value = deck[cell.type]
  }
  const cells = [
    ...masters,
    ...deck.slides.flatMap((s) => s.structure?.cells ?? []),
  ]
  const references = new Map<Cell, Item[]>()
  const used = new Set(
    mediaSlides(deck).flatMap((s) => s.items.map((o) => o.id.toLowerCase()))
  )
  let itemCounter = 0
  for (const slide of mediaSlides(deck)) {
    for (const { id, cell } of slots(deck.master, slide)) {
      const object = slide.items.find((o) => target(o) === id)
      if (object && !object.fixed) {
        const attached = references.get(cell) ?? []
        attached.push(object)
        references.set(cell, attached)
      }
      if (
        object ||
        (cell.type !== 'header' && cell.type !== 'footer') ||
        Object.values(deck.master.art ?? {}).includes(slide)
      )
        continue
      const value = slide[cell.type]
      if (value === undefined || value === (cell.value ?? '')) continue
      let oid: string
      do
        oid =
          'a7100400-0000-4000-8000-' +
          (++itemCounter).toString(16).padStart(12, '0')
      while (used.has(oid))
      used.add(oid)
      const item: Item = {
        id: oid,
        slot: id,
        type: 'text',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        text: value,
        src: '',
      }
      slide.items.push(item)
      // Display the former fallback in the new slot without inheriting item defaults.
      const attached = references.get(cell) ?? []
      attached.push(item)
      references.set(cell, attached)
    }
    delete slide.header
    delete slide.footer
  }
  delete deck.header
  delete deck.footer

  const legacyBase: TextStyle = {
    font: 'sans',
    leading: 1.18,
    minSize: 16,
    padding: 0,
    fit: true,
  }
  const inCell = new Set<Item>()
  for (const cell of cells) {
    if (!isTextType(cell.type)) {
      delete cell.value
      delete cell.style
      continue
    }
    cell.value ??= ''
    const previous = cell.style
    delete cell.style
    const type = cell.type
    const base = normalize({
      ...legacyBase,
      size: 32,
      color: '#183e45',
      align: 'left',
      ...previous,
      fit: true,
    } satisfies TextStyle)
    const items = references.get(cell) ?? []
    const itemStyles = items.map((item) => {
      if (!item.size) return base
      return normalize({
        ...legacyBase,
        size: item.size,
        color: item.color,
        align: item.align,
        ...originalStyles.find((s) => s.id === item.style)?.values,
        ...previous,
        ...item.overrides,
        fit: true,
      })
    })
    if (!initialized.has(type)) {
      initialized.add(type)
      systemStyles[type] = base
    }
    const baseDiffers = key(base) !== key(systemStyles[type])
    const varied = items.some(
      (o, i) => o.paragraphs || key(itemStyles[i]) !== key(base)
    )
    if (type !== 'text' && (baseDiffers || varied)) {
      cell.type = 'text'
      cell.bindingType = type
    }
    if (cell.type === 'text' && (baseDiffers || type !== 'text'))
      cell.textStyle = named(textTypes[type] + ' · прежнее оформление', base)
    items.forEach((item, i) => {
      inCell.add(item)
      delete item.style
      delete item.overrides
      if (cell.type === 'text' && key(itemStyles[i]) !== key(base))
        item.overrides = itemStyles[i]
    })
  }
  for (const slide of mediaSlides(deck))
    for (const item of slide.items) {
      if (item.type !== 'image' && !inCell.has(item)) {
        if (item.style && styleIds.has(item.style))
          item.style = styleIds.get(item.style)
        const old = originalStyles.find(
          (style) => styleIds.get(style.id) === item.style
        )
        const values: TextStyle = normalize({
          ...legacyBase,
          size: item.size ?? 32,
          color: item.color ?? '#183e45',
          align: item.align ?? 'left',
          ...old?.values,
          ...(v1 ? { font: 'legacy', fit: false } : {}),
          ...item.overrides,
        })
        if (item.type === 'text' || item.text || item.paragraphs)
          item.overrides = values
      }
      delete item.size
      delete item.color
      delete item.align
      item.paragraphs?.forEach((p) => {
        p.runs = p.runs.map(normalize)
      })
    }
  return deck
}

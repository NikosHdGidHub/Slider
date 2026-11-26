import {
  check,
  definitions,
  legacyDefinitions,
  FORMAT_VERSION,
} from './schema.ts'
import {
  kinds,
  blankGrid,
  cell,
  freezeDecoration,
  slots,
  rememberArt,
  mediaSlides,
  templateResources,
} from './grid.ts'
import {
  MAX_DOCUMENT_BYTES,
  newDeck,
  newSlide,
  validateDeck,
  type Deck,
  type Slide,
} from './model.ts'

export interface Template {
  format?: typeof FORMAT_VERSION
  kind: 'presentation' | 'layout'
  description: string
  deck: Deck
}
export function validateTemplate(value: unknown): Template {
  if (
    !value ||
    typeof value !== 'object' ||
    !('deck' in value) ||
    !('kind' in value) ||
    !('description' in value) ||
    Object.keys(value).some(
      (k) => !['deck', 'kind', 'description', 'format'].includes(k)
    ) ||
    !['presentation', 'layout'].includes(String(value.kind)) ||
    ('format' in value &&
      value.format !== 3 &&
      value.format !== FORMAT_VERSION) ||
    typeof value.description !== 'string' ||
    value.description.length > 2000
  )
    throw new Error('Ожидается шаблон с полями kind, description и deck.')
  if (new Blob([JSON.stringify(value)]).size > MAX_DOCUMENT_BYTES)
    throw new Error('Шаблон превышает 64 МиБ.')
  if ('format' in value) {
    const rules =
      value.format === FORMAT_VERSION ? definitions : legacyDefinitions
    check(rules.Template, value, 'Шаблон', rules)
  }
  const deck = validateDeck(value.deck)
  const isDeck = value.kind === 'presentation'
  if (deck.slides.length !== (isDeck ? 3 : 1))
    throw new Error(
      isDeck
        ? 'В шаблоне презентации должно быть ровно три слайда.'
        : 'Компоновка должна содержать один слайд.'
    )
  deck.slides.forEach((s, i) => {
    if (
      'format' in value &&
      (s.kind ?? 'normal') !== (isDeck ? kinds[i] : 'normal')
    )
      throw Error('Неверный порядок схем шаблона')
    s.kind = isDeck ? (['title', 'normal', 'end'] as const)[i] : 'normal'
  })
  if (!isDeck && deck.slides[0].items.some((o) => o.role === 'decoration'))
    throw new Error(
      'Компоновка содержит только заменяемые объекты. Измените роль оформления на содержимое.'
    )
  if ('format' in value && !isDeck && !deck.slides[0].structure)
    throw Error('Структурному шаблону нужна сетка')
  return {
    ...('format' in value ? { format: FORMAT_VERSION } : {}),
    kind: isDeck ? 'presentation' : 'layout',
    description: value.description,
    deck,
  }
}
export function copyDeck(source: Deck, title = source.title) {
  const d = structuredClone(source)
  d.id = crypto.randomUUID()
  d.title = title
  for (const s of mediaSlides(d)) {
    s.id = crypto.randomUUID()
    const links = new Map<string, string>()
    for (const o of s.items) {
      o.id = crypto.randomUUID()
      for (const k of ['group', 'relation'] as const) {
        if (!o[k]) continue
        const original = k + '/' + o[k]
        if (!links.has(original)) links.set(original, 'g' + crypto.randomUUID())
        o[k] = links.get(original)
      }
    }
  }
  return d
}
export function instantiate(template: Template) {
  const deck = copyDeck(template.deck)
  if (template.format === FORMAT_VERSION) {
    delete deck.migrated
    rememberArt(deck)
    for (const slide of deck.slides) delete slide.ownBackground
    for (const s of deck.slides)
      s.items = s.items.map((o) =>
        o.role === 'decoration' ? freezeDecoration(o, slots(deck.master, s)) : o
      )
  }
  if (!template.format) deck.migrated = true
  return deck
}
export function applyLayout(d: Deck, sid: string, template: Template): Deck {
  const slide = d.slides.find((s) => s.id === sid)
  if (
    !slide ||
    (slide.kind ?? 'normal') !== 'normal' ||
    template.kind !== 'layout'
  )
    throw new Error('Выберите обычный слайд и компоновку.')
  const {
    imported: layout,
    fonts,
    styles,
  } = templateResources(d, copyDeck(template.deck))
  const src = layout.slides[0],
    area = slide.area ?? { x: 0, y: 0, w: 1280, h: 720 },
    from = src.area ?? { x: 0, y: 0, w: 1280, h: 720 }
  const items = src.items.map((o) => {
    return {
      ...o,
      x: area.x + ((o.x - from.x) * area.w) / from.w,
      y: area.y + ((o.y - from.y) * area.h) / from.h,
      w: (o.w * area.w) / from.w,
      h: (o.h * area.h) / from.h,
    }
  })
  return validateDeck({
    ...d,
    resources: { fonts },
    theme: { ...d.theme, styles },
    slides: d.slides.map((s) =>
      s.id !== sid
        ? s
        : {
            ...s,
            items: [
              ...s.items.map((o) =>
                o.role === 'decoration' ? o : { ...o, slot: 'tray' }
              ),
              ...items,
            ],
          }
    ),
  })
}
export const builtins: Template[] = []
export function createGridTemplate(
  kind: Template['kind'],
  title: string
): Template {
  const deck = newDeck(title)
  deck.master.name = title
  if (kind === 'presentation')
    deck.slides = kinds.map((kind) => ({ ...newSlide(), kind }))
  else {
    deck.slides[0].kind = 'normal'
    deck.slides[0].structure = blankGrid('text')
  }
  return { format: FORMAT_VERSION, kind, description: '', deck }
}
export function templateFrom(deck: Deck): Template {
  const selected = kinds.map((k) =>
    deck.slides.find((s) => (s.kind ?? 'normal') === k)
  )
  if (selected.some((s) => !s))
    throw Error('Нужны титульный, обычный и завершающий слайды.')
  const d = copyDeck(
    { ...deck, slides: selected as Slide[] },
    deck.title + ' — шаблон'
  )
  delete d.master.art
  d.master.name = d.title
  return validateTemplate({
    format: FORMAT_VERSION,
    kind: 'presentation',
    description: '',
    deck: d,
  })
}

export const twoByTwo = createGridTemplate(
  'layout',
  'Описание, изображение и вывод'
)
twoByTwo.deck.id = 'a7100000-0012-4000-8000-000000000001'
twoByTwo.deck.slides[0].id = 'a7100000-0012-4000-8000-000000000002'
twoByTwo.deck.slides[0].structure = {
  rows: [2, 1],
  cols: [1, 1],
  padding: [24, 24, 24, 24],
  cells: [
    cell(0, 0, 'description', 'description'),
    cell(0, 1, 'image', 'image'),
    { ...cell(1, 0, 'text', 'conclusion'), cols: 2 },
  ].map((c) => ({
    ...c,
    padding: [20, 20, 20, 20],
    width: 2,
    border: '#aca0be',
  })),
}
export const baseTemplate = createGridTemplate('presentation', 'По умолчанию')
baseTemplate.deck.id = 'a7100000-0013-4000-8000-000000000001'

baseTemplate.deck.slides.forEach((slide, index) => {
  slide.id = 'a7100000-0013-4000-8000-' + String(index + 2).padStart(12, '0')
})

builtins.push(baseTemplate, twoByTwo)

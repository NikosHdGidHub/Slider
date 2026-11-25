import { cellTypes } from './grid.ts'
// Named definitions are used both by the importer and the downloadable specification.
type Rule = {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  const?: string | number | null
  enum?: readonly string[]
  pattern?: string
  minimum?: number
  maximum?: number
  maxLength?: number
  items?: Rule
  minItems?: number
  maxItems?: number
  properties?: Record<string, Rule>
  required?: string[]
  additionalProperties?: false
  $ref?: string
  anyOf?: Rule[]
  description?: string
}
const num = (minimum: number, maximum: number): Rule => ({
  type: 'number',
  minimum,
  maximum,
})
const str = (maxLength: number, pattern?: string): Rule => ({
  type: 'string',
  maxLength,
  pattern,
})
const values = (...options: string[]): Rule => ({ enum: options })
const ref = (name: string): Rule => ({ $ref: '#/$defs/' + name })
const list = (items: Rule, minItems: number, maxItems: number): Rule => ({
  type: 'array',
  items,
  minItems,
  maxItems,
})
const meanings: Record<string, string> = {
  version: 'Номер формата файла.',
  id: 'Уникальный идентификатор в своей коллекции.',
  title: 'Название презентации.',
  master: 'Главный шаблон с тремя сетками title, normal, end.',
  structure: 'Вложенная сетка в системе координат области слайда.',
  schemes: 'Геометрия титульного, обычного и завершающего слайдов.',
  slot: 'Размещение объекта: free, tray, m/ID либо s/ID.',
  priorSlot: 'Привязка перед переносом в неразмещённое содержимое.',
  fixed: 'Декор главной схемы в абсолютных координатах холста.',
  group: 'Общий идентификатор перемещаемой группы на слайде.',
  relation: 'Общая смысловая связь объектов на слайде.',
  imageFit: 'Вписание изображения целиком либо заполнение с обрезкой.',
  focusX: 'Горизонтальная точка фокуса в процентах.',
  focusY: 'Вертикальная точка фокуса в процентах.',
  canvas: 'Виртуальный холст в пикселях.',
  width: 'Ширина холста.',
  height: 'Высота холста.',
  theme: 'Самодостаточная тема документа.',
  resources: 'Встроенные файлы документа.',
  styles: 'Определения именованных стилей.',
  palette: 'Цвета темы в формате #RRGGBB.',
  fonts: 'Пользовательские гарнитуры.',
  slides: 'Слайды в порядке показа.',
  items: 'Объекты от заднего к переднему плану.',
  kind: 'Назначение слайда.',
  area: 'Рекомендуемая область учебного содержания.',
  background: 'Растровый фон, заполняющий слайд, либо null.',
  notes: 'Текст для преподавателя.',
  x: 'Горизонтальная координата.',
  y: 'Вертикальная координата.',
  w: 'Ширина рамки в px.',
  h: 'Высота рамки в px.',
  text: 'Текст без разметки. Для блока с paragraphs включает все фрагменты и переносы между абзацами.',
  src: 'Растровый источник для изображения. Для остальных объектов пустая строка.',
  size: 'Исходный кегль в px.',
  color: 'Цвет #RRGGBB.',
  align: 'Горизонтальное выравнивание текста.',
  role: 'Оформление decoration сохраняется при замене содержимого.',
  rotation: 'Градусы по часовой стрелке вокруг центра рамки.',
  flipX: 'Горизонтальное отражение по локальной оси.',
  flipY: 'Вертикальное отражение по локальной оси.',
  opacity: 'Непрозрачность объекта от 0 до 1.',
  type: 'Вариант объекта или заливки.',
  shape: 'Геометрия в пределах рамки.',
  fill: 'Способ заполнения замкнутой фигуры.',
  stroke: 'Цвет линии по границе.',
  strokeWidth: 'Толщина линии в px.',
  dash: 'Длины штриха и пропуска в px.',
  radius: 'Радиус углов прямоугольника в px.',
  shadow: 'Тень силуэта, включая встроенный текст.',
  blur: 'Радиус размытия тени в px.',
  nodes: 'Узлы от начала до конца контура, в процентах рамки.',
  closed: 'Соединяет последний узел с первым.',
  in: 'Абсолютная входящая ручка Безье.',
  out: 'Абсолютная исходящая ручка Безье.',
  stops: 'Цветовые точки по возрастанию offset.',
  offset: 'Доля расстояния по градиенту.',
  angle: 'Направление линейного градиента в градусах.',
  style: 'ID именованного стиля из theme.styles.',
  overrides: 'Индивидуальные свойства поверх именованного стиля.',
  paragraphs: 'Структурированные абзацы в порядке чтения.',
  runs: 'Последовательные фрагменты одного абзаца.',
  list: 'Маркер или последовательный номер.',
  indent: 'Отступ абзаца слева в px.',
  after: 'Интервал после абзаца в px.',
  font: 'ID встроенного или загруженного шрифта.',
  bold: 'Полужирное начертание.',
  italic: 'Курсив.',
  underline: 'Подчёркивание.',
  strike: 'Зачёркивание.',
  highlight: 'Цвет фона символов.',
  tracking: 'Расстояние между буквами в px.',
  leading: 'Высота строки как множитель кегля.',
  padding: 'Внутренний отступ со всех сторон в px.',
  fit: 'Уменьшение текста при переполнении.',
  minSize: 'Нижняя граница подгонки кегля блока.',
  values: 'Параметры именованного стиля.',
  label: 'Читаемое название.',
  format: 'Контейнер шрифта.',
  data: 'Подлинный файл в base64 без префикса data URL.',
}
const obj = (
  required: Record<string, Rule>,
  optional: Record<string, Rule> = {}
): Rule => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries({ ...required, ...optional }).map(([key, rule]) => [
      key,
      { ...rule, description: meanings[key] },
    ])
  ),
  required: Object.keys(required),
  additionalProperties: false,
})
export const shapes = {
  rect: 'Прямоугольник',
  rounded: 'Скруглённая карточка',
  circle: 'Круг',
  ellipse: 'Эллипс',
  triangle: 'Треугольник',
  polygon: 'Шестиугольник',
  star: 'Звезда',
  arrow: 'Стрелка',
  line: 'Прямая',
  polyline: 'Ломаная',
  curve: 'Кривая',
  path: 'Свой контур',
} as const
export const builtinFonts = {
  sans: 'DejaVu Sans',
  serif: 'DejaVu Serif',
  mono: 'DejaVu Sans Mono',
  legacy: 'Arial (системный)',
} as const
const uuid = str(36, '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$')
const name = str(80, '^[a-zA-Z][a-zA-Z0-9_-]{0,79}$')
const color = str(7, '^#[a-fA-F0-9]{6}$')
const bool: Rule = { type: 'boolean' }
const coord = num(-8192, 8192),
  length = num(0.01, 8192),
  size = num(1, 1024)
const box = { x: coord, y: coord, w: length, h: length }
const char = {
  font: name,
  size,
  color,
  bold: bool,
  italic: bool,
  underline: bool,
  strike: bool,
  highlight: color,
  tracking: num(-3, 40),
}
const text = {
  ...char,
  align: values('left', 'center', 'right'),
  leading: num(0.6, 4),
  padding: num(0, 512),
  fit: bool,
  minSize: size,
}
const common = {
  id: uuid,
  ...box,
  text: str(200000),
  src: str(24 * 1024 * 1024),
  size,
  color,
  align: text.align,
}
const transform = {
  layerName: str(200),
  hidden: bool,
  locked: bool,
  priorSlot: str(84),
  slot: str(84),
  fixed: bool,
  group: name,
  relation: name,
  contentScale: num(0.00001, 8192),
  role: values('content', 'decoration'),
  rotation: num(-360, 360),
  flipX: bool,
  flipY: bool,
  opacity: num(0, 1),
}
const rich = {
  style: name,
  overrides: ref('TextStyle'),
  paragraphs: list(ref('Paragraph'), 1, 500),
}
const image = { ...common, type: { const: 'image' } }
const shape = {
  ...common,
  type: { const: 'shape' },
  shape: values(...Object.keys(shapes)),
}
const v1base = obj({
  id: uuid,
  type: values('text', 'image'),
  ...box,
  text: common.text,
  src: common.src,
  size,
  color,
  align: text.align,
})
const source: Rule = { anyOf: [{ const: null }, common.src] }
const slide = { id: uuid, color, background: source, notes: str(200000) }
export const FORMAT_VERSION = 3
export const definitions: Record<string, Rule> = {
  Template: obj({
    format: { const: 3 },
    kind: values('presentation', 'layout'),
    description: str(2000),
    deck: ref('Presentation'),
  }),
  Presentation: obj(
    {
      version: { const: FORMAT_VERSION },
      master: ref('Master'),
      id: uuid,
      title: str(1024),
      canvas: obj({ width: { const: 1280 }, height: { const: 720 } }),
      theme: obj({
        styles: list(ref('NamedStyle'), 0, 128),
        palette: list(color, 1, 32),
      }),
      resources: obj({ fonts: list(ref('Font'), 0, 32) }),
      slides: list(ref('Slide'), 1, 1000),
    },
    { migrated: bool, header: str(200000), footer: str(200000) }
  ),
  Master: obj(
    {
      name: str(1024),
      schemes: obj({
        title: ref('Grid'),
        normal: ref('Grid'),
        end: ref('Grid'),
      }),
    },
    {
      art: obj(
        {},
        { title: ref('Slide'), normal: ref('Slide'), end: ref('Slide') }
      ),
    }
  ),
  Grid: obj({
    rows: list(num(0.01, 8192), 1, 24),
    cols: list(num(0.01, 8192), 1, 24),
    padding: ref('Insets'),
    cells: list(ref('Cell'), 1, 576),
  }),
  Insets: list(num(0, 1279), 4, 4),
  Cell: obj(
    {
      id: name,
      row: num(0, 23),
      col: num(0, 23),
      rows: num(1, 24),
      cols: num(1, 24),
      type: values(...Object.keys(cellTypes)),
      padding: ref('Insets'),
    },
    {
      fill: color,
      border: color,
      width: num(0, 64),
      value: str(200000),
      style: ref('TextStyle'),
    }
  ),
  Slide: obj(
    { ...slide, items: list(ref('Item'), 0, 500) },
    {
      kind: values('title', 'normal', 'end'),
      area: obj(box),
      ownBackground: bool,
      effects: obj(
        {},
        {
          brightness: num(0, 200),
          blur: num(0, 40),
          zoom: num(50, 300),
          x: num(0, 100),
          y: num(0, 100),
          fit: values('cover', 'contain'),
        }
      ),
      structure: ref('Grid'),
      header: str(200000),
      footer: str(200000),
    }
  ),
  Item: { anyOf: [ref('Text'), ref('Image'), ref('Shape')] },
  Text: obj(
    { ...common, type: { const: 'text' }, src: { const: '' } },
    { ...transform, ...rich }
  ),
  Image: obj(
    { ...image, text: { const: '' } },
    {
      ...transform,
      imageFit: values('contain', 'cover'),
      focusX: num(0, 100),
      focusY: num(0, 100),
    }
  ),
  Shape: obj(
    { ...shape, src: { const: '' } },
    {
      ...transform,
      ...rich,
      fill: ref('Fill'),
      stroke: color,
      strokeWidth: num(0, 100),
      dash: list(num(0.1, 500), 1, 12),
      radius: num(0, 4096),
      shadow: ref('Shadow'),
      nodes: list(ref('Node'), 2, 512),
      closed: bool,
    }
  ),
  TextStyle: obj({}, text),
  NamedStyle: obj({ id: name, label: str(100), values: ref('TextStyle') }),
  Paragraph: obj(
    { runs: list(ref('Run'), 1, 1000) },
    {
      list: values('bullet', 'number'),
      indent: num(0, 512),
      after: num(0, 256),
    }
  ),
  Run: obj({ text: str(200000) }, char),
  Fill: {
    anyOf: [
      obj({ type: { const: 'none' } }),
      obj({ type: { const: 'solid' }, color }),
      obj(
        { type: { const: 'linear' }, stops: list(ref('Stop'), 2, 16) },
        { angle: num(-360, 360) }
      ),
      obj({ type: { const: 'radial' }, stops: list(ref('Stop'), 2, 16) }),
    ],
  },
  Stop: obj({ offset: num(0, 1), color }),
  Shadow: obj({
    x: num(-200, 200),
    y: num(-200, 200),
    blur: num(0, 100),
    color,
  }),
  Node: obj(
    { x: num(-400, 500), y: num(-400, 500) },
    { in: ref('Point'), out: ref('Point') }
  ),
  Point: obj({ x: num(-400, 500), y: num(-400, 500) }),
  Font: obj({
    id: name,
    label: str(100),
    format: values('woff2', 'woff', 'ttf', 'otf'),
    data: str(5600000),
  }),
  Legacy: obj({
    version: { const: 1 },
    id: uuid,
    title: str(1024),
    slides: list(obj({ ...slide, items: list(v1base, 0, 500) }), 1, 1000),
  }),
}
export const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $ref: '#/$defs/Presentation',
  $defs: definitions,
}
export function check(rule: Rule, value: unknown, path: string): void {
  const fail = (reason: string): never => {
    throw new Error(path + ' — ' + reason)
  }
  if (rule.$ref) return check(definitions[rule.$ref.slice(8)], value, path)
  if (rule.anyOf) {
    if (
      rule === definitions.Item &&
      value &&
      typeof value === 'object' &&
      'type' in value
    ) {
      const key = { text: 'Text', shape: 'Shape', image: 'Image' }[
        String(value.type) as 'text'
      ]
      if (!['text', 'shape', 'image'].includes(String(value.type)))
        fail('неизвестный тип объекта')
      return check(definitions[key], value, path)
    }
    for (const choice of rule.anyOf) {
      try {
        check(choice, value, path)
        return
      } catch {
        /* try the next documented variant */
      }
    }
    fail('значение не соответствует допустимым вариантам')
  }
  if ('const' in rule && value !== rule.const)
    fail('ожидалось ' + JSON.stringify(rule.const))
  if (rule.enum && !rule.enum.includes(value as string))
    fail('допустимо ' + rule.enum.join(', '))
  if (!rule.type) return
  if (rule.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < rule.minItems! ||
      value.length > rule.maxItems!
    )
      fail(
        'число элементов должно быть от ' +
          rule.minItems +
          ' до ' +
          rule.maxItems
      )
    ;(value as unknown[]).forEach((entry, i) =>
      check(rule.items!, entry, path + '[' + i + ']')
    )
  } else if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail('ожидался объект')
    const record = value as Record<string, unknown>
    for (const field of rule.required!)
      if (!Object.hasOwn(record, field)) fail('нет поля ' + field)
    for (const [field, entry] of Object.entries(record)) {
      if (!Object.hasOwn(rule.properties!, field))
        fail('неизвестное поле ' + field)
      check(rule.properties![field], entry, path + '.' + field)
    }
  } else {
    if (typeof value !== rule.type) fail('ожидается ' + rule.type)
    if (
      typeof value === 'string' &&
      (value.length > rule.maxLength! ||
        (rule.pattern && !new RegExp(rule.pattern).test(value)))
    )
      fail('некорректная строка')
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) ||
        value < rule.minimum! ||
        value > rule.maximum!)
    )
      fail('допустимый диапазон ' + rule.minimum + '…' + rule.maximum)
  }
}

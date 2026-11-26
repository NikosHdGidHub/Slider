import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react'
import { fontCatalog } from './fontCatalog'
import { textTypeIds, textTypes, isTextType, type TextType } from './textTypes'
import { type Cell, type Insets } from './grid'
import { IconButton, PropertySection } from './Workspace'
import { fontFamily } from './Artwork'
import { useRef, useState } from 'react'
import { installStyle, type StyleLibrary } from './styleLibrary'
import { shapes } from './schema'
import {
  newShape,
  itemTextType,
  replaceStyle,
  verifyFont,
  type Characters,
  type Deck,
  type FontAsset,
  type Item,
  type TextStyle,
} from './model'
type Change = (fn: (d: Deck) => Deck) => void
export function Num({
  label,
  value,
  min,
  max,
  change,
  step = 1,
}: {
  label: string
  value: number
  min: number
  max: number
  change: (v: number) => void
  step?: number
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber))
            change(Math.min(max, Math.max(min, e.target.valueAsNumber)))
        }}
      />
    </label>
  )
}
function Color({
  label,
  value,
  change,
}: {
  label: string
  value: string
  change: (v: string) => void
}) {
  return (
    <label>
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  )
}
function Toggle({
  label,
  value,
  change,
}: {
  label: string
  value: boolean
  change: (v: boolean) => void
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
      />
      {label}
    </label>
  )
}
function CharacterFields({
  values,
  onChange,
  deck,
  onUpload,
}: {
  values: Characters
  onChange: (s: Characters) => void
  deck: Deck
  onUpload?: (file: File) => void
}) {
  const [search, setSearch] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const font = values.font ?? 'sans'
  const fonts = [
    ...Object.entries(fontCatalog).map(([id, f]) => ({ id, label: f.label })),
    ...deck.resources.fonts,
  ]
  const variants = fontCatalog[font] ?? { weights: [400], italic: false }
  const match = (text: string) =>
    text.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))
  return (
    <>
      <label>
        Поиск гарнитуры
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        Гарнитура
        <select
          aria-label="Гарнитура"
          value={font}
          style={{ fontFamily: fontFamily(font, deck) }}
          onChange={(e) => {
            const id = e.target.value
            if (id === '@upload') {
              fileInput.current?.click()
              return
            }
            const target = fontCatalog[id] ?? { weights: [400], italic: false }
            onChange({
              font: id,
              ...(!target.weights.includes(Number(values.weight ?? 400))
                ? {
                    weight: String(
                      target.weights.includes(400) ? 400 : target.weights[0]
                    ),
                  }
                : {}),
              ...(!target.italic && values.italic ? { italic: false } : {}),
            })
          }}
        >
          {fonts
            .filter((f) => f.id === font || match(f.label) || match(f.id))
            .map(({ id, label }) => (
              <option
                key={id}
                value={id}
                style={{ fontFamily: fontFamily(id, deck) }}
              >
                {label}
              </option>
            ))}
          {onUpload && <option value="@upload">Загрузить шрифт…</option>}
        </select>
      </label>
      {onUpload && (
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="Загрузить шрифт"
          accept=".woff2,.woff,.ttf,.otf"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onUpload(file)
          }}
        />
      )}
      <div className="field-pair">
        <Num
          label="Размер шрифта"
          value={values.size ?? 32}
          min={1}
          max={1024}
          change={(size) => onChange({ size })}
        />
        <label>
          Насыщенность
          <select
            value={values.weight ?? '400'}
            onChange={(e) => onChange({ weight: e.target.value })}
          >
            {variants.weights.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-pair">
        <Color
          label="Цвет текста"
          value={values.color ?? '#183e45'}
          change={(color) => onChange({ color })}
        />
        <Color
          label="Выделение маркером"
          value={values.highlight ?? '#fff4aa'}
          change={(highlight) => onChange({ highlight })}
        />
      </div>
      <div className="switches">
        {(
          [
            ['italic', 'Курсив'],
            ['underline', 'Подчёркивание'],
            ['strike', 'Зачёркивание'],
          ] as const
        )
          .filter(([key]) => key !== 'italic' || variants.italic)
          .map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              value={!!values[key]}
              change={(v) => onChange({ [key]: v })}
            />
          ))}
      </div>
      <Num
        label="Интервал между буквами"
        value={values.tracking ?? 0}
        min={-3}
        max={40}
        step={0.25}
        change={(tracking) => onChange({ tracking })}
      />
    </>
  )
}

const alignments = {
  align: [
    ['left', 'Слева', AlignLeft],
    ['center', 'По центру горизонтали', AlignCenter],
    ['right', 'Справа', AlignRight],
  ],
  verticalAlign: [
    ['top', 'Сверху', AlignVerticalJustifyStart],
    ['middle', 'По центру вертикали', AlignVerticalJustifyCenter],
    ['bottom', 'Снизу', AlignVerticalJustifyEnd],
  ],
} as const

function StyleFields({
  deck,
  values,
  change,
  onUpload,
}: {
  deck: Deck
  values: TextStyle
  change: (v: TextStyle) => void
  onUpload: (file: File) => void
}) {
  const padding: Insets = Array.isArray(values.padding)
    ? values.padding
    : [0, 0, 0, 0]
  const shadow = values.textShadow ?? {
    color: '#000000',
    opacity: 0.6,
    x: 2,
    y: 3,
    blur: 4,
  }
  const stroke = values.textStroke ?? { color: '#000000', opacity: 1, width: 1 }
  const glow = values.textGlow ?? {
    color: '#fff4aa',
    intensity: 0.5,
    radius: 7,
  }
  return (
    <>
      <CharacterFields
        deck={deck}
        values={values}
        onChange={change}
        onUpload={onUpload}
      />
      {values.highlight && (
        <button onClick={() => change({ highlight: undefined })}>
          Убрать маркер
        </button>
      )}
      {Object.entries(alignments).map(([key, choices]) => (
        <div
          key={key}
          className="text-align-tools"
          role="group"
          aria-label={
            key === 'align'
              ? 'Горизонтальное выравнивание'
              : 'Вертикальное выравнивание'
          }
        >
          {choices.map(([id, label, Icon], index) => (
            <IconButton
              key={id}
              label={label}
              aria-pressed={
                (values[key as keyof typeof alignments] ?? choices[0][0]) ===
                choices[index][0]
              }
              onClick={() => change({ [key]: id })}
            >
              <Icon size={16} />
            </IconButton>
          ))}
        </div>
      ))}
      <div className="field-pair">
        <Num
          label="Межстрочный интервал"
          min={0.6}
          max={4}
          step={0.05}
          value={values.leading ?? 1.18}
          change={(leading) => change({ leading })}
        />
        <Num
          label="После абзаца"
          min={0}
          max={256}
          value={values.paragraphSpacing ?? 0}
          change={(paragraphSpacing) => change({ paragraphSpacing })}
        />
      </div>
      <fieldset>
        <legend>Внутренние отступы текста</legend>
        <div className="field-pair">
          {['Сверху', 'Справа', 'Снизу', 'Слева'].map((label, index) => (
            <Num
              key={label}
              label={label}
              min={0}
              max={512}
              value={padding[index]}
              change={(n) => {
                const next: Insets = [...padding]
                next[index] = n
                change({ padding: next })
              }}
            />
          ))}
        </div>
      </fieldset>
      <Toggle
        label="Автоподгонка"
        value={values.fit ?? true}
        change={(fit) => change({ fit })}
      />
      {(values.fit ?? true) && (
        <Num
          label="Минимальный размер"
          min={1}
          max={1024}
          value={values.minSize ?? 16}
          change={(minSize) => change({ minSize })}
        />
      )}
      <PropertySection id="text-effects" title="Эффекты текста">
        <Toggle
          label="Тень текста"
          value={!!values.textShadow}
          change={(on) => change({ textShadow: on ? shadow : undefined })}
        />
        {values.textShadow && (
          <>
            <Color
              label="Цвет тени"
              value={shadow.color}
              change={(color) => change({ textShadow: { ...shadow, color } })}
            />
            <Num
              label="Непрозрачность тени"
              min={0}
              max={1}
              step={0.05}
              value={shadow.opacity}
              change={(opacity) =>
                change({ textShadow: { ...shadow, opacity } })
              }
            />
            <div className="field-pair">
              <Num
                label="Смещение X"
                min={-200}
                max={200}
                value={shadow.x}
                change={(x) => change({ textShadow: { ...shadow, x } })}
              />
              <Num
                label="Смещение Y"
                min={-200}
                max={200}
                value={shadow.y}
                change={(y) => change({ textShadow: { ...shadow, y } })}
              />
            </div>
            <Num
              label="Размытие тени"
              min={0}
              max={100}
              value={shadow.blur}
              change={(blur) => change({ textShadow: { ...shadow, blur } })}
            />
          </>
        )}
        <Toggle
          label="Обводка текста"
          value={!!values.textStroke}
          change={(on) => change({ textStroke: on ? stroke : undefined })}
        />
        {values.textStroke && (
          <>
            <Color
              label="Цвет обводки"
              value={stroke.color}
              change={(color) => change({ textStroke: { ...stroke, color } })}
            />
            <Num
              label="Толщина обводки"
              min={0}
              max={32}
              value={stroke.width}
              change={(width) => change({ textStroke: { ...stroke, width } })}
            />
            <Num
              label="Непрозрачность обводки"
              min={0}
              max={1}
              step={0.05}
              value={stroke.opacity}
              change={(opacity) =>
                change({ textStroke: { ...stroke, opacity } })
              }
            />
          </>
        )}
        <Toggle
          label="Свечение текста"
          value={!!values.textGlow}
          change={(on) => change({ textGlow: on ? glow : undefined })}
        />
        {values.textGlow && (
          <>
            <Color
              label="Цвет свечения"
              value={glow.color}
              change={(color) => change({ textGlow: { ...glow, color } })}
            />
            <Num
              label="Радиус свечения"
              min={0}
              max={100}
              value={glow.radius}
              change={(radius) => change({ textGlow: { ...glow, radius } })}
            />
            <Num
              label="Интенсивность свечения"
              min={0}
              max={1}
              step={0.05}
              value={glow.intensity}
              change={(intensity) =>
                change({ textGlow: { ...glow, intensity } })
              }
            />
          </>
        )}
      </PropertySection>
    </>
  )
}
async function fontFile(file: File): Promise<FontAsset> {
  const format = file.name
    .split('.')
    .pop()
    ?.toLowerCase() as FontAsset['format']
  if (
    !['woff2', 'woff', 'ttf', 'otf'].includes(format) ||
    !file.size ||
    file.size > 4194304
  )
    throw new Error('Выберите WOFF2, WOFF, TTF или OTF до 4 МиБ.')
  const buffer = await file.arrayBuffer(),
    digest = await crypto.subtle.digest('SHA-256', buffer)
  const id =
    'font-' +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  const f = { id, label: file.name.slice(0, 100), format, data }
  verifyFont(f)
  try {
    await new FontFace('AtlasTest', buffer).load()
  } catch {
    throw new Error('Браузер не смог прочитать шрифт.')
  }
  return f
}
export function StylesPanel({
  deck,
  change,
  notice,
  library,
  initialStyleId = 'text',
}: {
  library?: StyleLibrary
  deck: Deck
  change: Change
  notice: (v: string) => void
  initialStyleId?: string
}) {
  const [id, setID] = useState(initialStyleId)
  const [replacement, setReplacement] = useState('')
  const selected = deck.theme.styles.find((s) => s.id === id)
  const values = isTextType(id)
    ? deck.theme.systemStyles[id]
    : (selected?.values ?? deck.theme.systemStyles.text)
  function createStyle(copy?: TextStyle) {
    if (deck.theme.styles.length >= 128) {
      notice('В документе уже 128 стилей.')
      return
    }
    const label = prompt('Название стиля')?.trim()
    if (!label) return
    const id = 's' + crypto.randomUUID()
    change((d) => ({
      ...d,
      theme: {
        ...d.theme,
        styles: [
          ...d.theme.styles,
          { id, label: label.slice(0, 100), values: { ...copy } },
        ],
      },
    }))
    setID(id)
  }
  async function addFont(file: File) {
    try {
      const font = await fontFile(file)
      change((d) => {
        if (d.resources.fonts.some((existing) => existing.id === font.id))
          return d
        if (d.resources.fonts.length >= 32)
          throw new Error('В документе уже 32 шрифта.')
        return { ...d, resources: { fonts: [...d.resources.fonts, font] } }
      })
      notice('Шрифт доступен в списке гарнитур.')
    } catch (error) {
      notice((error as Error).message)
    }
  }
  return (
    <PropertySection id="styles" title="Стили текста">
      <PropertySection id="text-resources" title="Ресурсы оформления">
        <PropertySection id="theme" title="Палитра темы">
          {deck.theme.palette.map((value, index) => (
            <Color
              key={index}
              value={value}
              label={'Цвет палитры ' + (index + 1)}
              change={(color) =>
                change((d) => ({
                  ...d,
                  theme: {
                    ...d.theme,
                    palette: d.theme.palette.map((v, j) =>
                      j === index ? color : v
                    ),
                  },
                }))
              }
            />
          ))}
          <button
            disabled={deck.theme.palette.length >= 32}
            onClick={() =>
              change((d) => ({
                ...d,
                theme: { ...d.theme, palette: [...d.theme.palette, '#ffffff'] },
              }))
            }
          >
            Добавить цвет палитры
          </button>
        </PropertySection>
        {library && (
          <label>
            Добавить из библиотеки
            <select
              aria-label="Добавить из библиотеки"
              value=""
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':')
                try {
                  const next = installStyle(
                    deck,
                    library,
                    kind === 'font' ? { font: id } : { style: id }
                  )
                  change(() => next)
                  notice('Добавлено в документ.')
                } catch (err) {
                  notice((err as Error).message)
                }
              }}
            >
              <option value="">Стиль или шрифт</option>
              <optgroup label="Стили">
                {library.styles.map((s) => (
                  <option key={s.id} value={'style:' + s.id}>
                    {s.label} · {s.id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Шрифты">
                {library.fonts.map((f) => (
                  <option key={f.id} value={'font:' + f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
      </PropertySection>
      <label>
        Стиль текста
        <select
          aria-label="Стиль текста"
          value={isTextType(id) || selected ? id : 'text'}
          onChange={(e) => setID(e.target.value)}
        >
          <optgroup label="Системные">
            {textTypeIds.map((type) => (
              <option key={type} value={type}>
                {textTypes[type]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Пользовательские">
            {deck.theme.styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <button onClick={() => createStyle()}>Создать стиль</button>
      <button onClick={() => createStyle(values)}>Дублировать стиль</button>
      {selected && (
        <>
          <label>
            Название стиля
            <input
              key={id}
              defaultValue={selected.label}
              maxLength={100}
              onBlur={(e) => {
                const label = e.target.value.trim()
                if (!label) {
                  e.target.value = selected.label
                  return
                }
                change((d) => ({
                  ...d,
                  theme: {
                    ...d.theme,
                    styles: d.theme.styles.map((s) =>
                      s.id === id ? { ...s, label } : s
                    ),
                  },
                }))
              }}
            />
          </label>
          <label>
            Заменить ссылки при удалении
            <select
              aria-label="Заменить ссылки при удалении"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            >
              <option value="">Системный стиль «Текст»</option>
              {deck.theme.styles
                .filter((s) => s.id !== id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            onClick={() => {
              const next = deck.theme.styles.some(
                (s) => s.id === replacement && s.id !== id
              )
                ? replacement
                : undefined
              change((d) => replaceStyle(d, id, next))
              setID(next ?? 'text')
              setReplacement('')
            }}
          >
            Удалить стиль
          </button>
        </>
      )}
      <StyleFields
        onUpload={addFont}
        values={values}
        deck={deck}
        change={(fields) =>
          change((d) => {
            const update = (style: TextStyle) =>
              Object.fromEntries(
                Object.entries({ ...style, ...fields }).filter(
                  ([, value]) => value !== undefined
                )
              )
            return {
              ...d,
              theme:
                isTextType(id) || !selected
                  ? {
                      ...d.theme,
                      systemStyles: {
                        ...d.theme.systemStyles,
                        [isTextType(id) ? id : 'text']: update(values),
                      },
                    }
                  : {
                      ...d.theme,
                      styles: d.theme.styles.map((style) =>
                        style.id === id
                          ? { ...style, values: update(style.values) }
                          : style
                      ),
                    },
            }
          })
        }
      />
    </PropertySection>
  )
}

export function TextPanel({
  item,
  cell,
  deck,
  patch,
  editOnCanvas,
  reset,
}: {
  item: Item
  cell?: Cell
  deck: Deck
  patch: (v: Partial<Item>) => void
  editOnCanvas?: () => void
  reset?: () => void
}) {
  const type = itemTextType(item, cell)
  return (
    <PropertySection id="text" title="Содержание текста" initial>
      <div>
        {!isTextType(cell?.type) && (
          <label>
            Тип текста
            <select
              value={type}
              onChange={(e) => {
                const textType = e.target.value as TextType
                patch(
                  textType === 'text'
                    ? { textType }
                    : {
                        textType,
                        paragraphs: undefined,
                        overrides: undefined,
                        style: undefined,
                      }
                )
              }}
            >
              {textTypeIds.map((id) => (
                <option value={id} key={id}>
                  {textTypes[id]}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === 'text' && !cell?.textStyle && (
          <label>
            Пользовательский стиль
            <select
              aria-label="Пользовательский стиль"
              value={item.style ?? ''}
              onChange={(e) =>
                patch({
                  style: e.target.value || undefined,
                  overrides: undefined,
                })
              }
            >
              <option value="">Системный стиль «Текст»</option>
              {deck.theme.styles.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {editOnCanvas ? (
          <button onClick={editOnCanvas}>Редактировать на холсте</button>
        ) : (
          (!item.paragraphs || type !== 'text') && (
            <label>
              Текст
              <textarea
                id="atlas-edit-text"
                maxLength={200000}
                value={item.text}
                onChange={(e) =>
                  patch({ text: e.target.value, paragraphs: undefined })
                }
              />
            </label>
          )
        )}
        {reset && (
          <button onClick={reset}>Вернуть исходный текст ячейки</button>
        )}
      </div>
    </PropertySection>
  )
}

export function ShapePanel({
  item,
  patch,
}: {
  item: Item
  patch: (v: Partial<Item>) => void
}) {
  const f = item.fill ?? { type: 'solid', color: '#bde6dd' }
  return (
    <>
      <PropertySection id="shape" title="Фигура, заливка и границы" initial>
        <label>
          Форма
          <select
            aria-label="Форма"
            value={item.shape}
            onChange={(e) => {
              const shape = e.target.value as Item['shape']
              patch({
                shape,
                nodes:
                  shape === 'path'
                    ? (item.nodes ?? newShape('path').nodes)
                    : undefined,
                closed: shape === 'path' ? !!item.closed : undefined,
              })
            }}
          >
            {Object.entries(shapes).map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Заливка
          <select
            aria-label="Заливка"
            value={f.type}
            onChange={(e) => {
              const type = e.target.value as typeof f.type
              patch({
                fill:
                  type === 'none'
                    ? { type }
                    : type === 'solid'
                      ? { type, color: '#bde6dd' }
                      : {
                          type,
                          stops:
                            'stops' in f
                              ? f.stops
                              : [
                                  { offset: 0, color: '#bde6dd' },
                                  { offset: 1, color: '#4792a0' },
                                ],
                        },
              })
            }}
          >
            <option value="none">Прозрачная</option>
            <option value="solid">Сплошная</option>
            <option value="linear">Линейный градиент</option>
            <option value="radial">Радиальный градиент</option>
          </select>
        </label>
        {f.type === 'solid' && (
          <Color
            label="Цвет заливки"
            value={f.color}
            change={(color) => patch({ fill: { ...f, color } })}
          />
        )}
        {'stops' in f && (
          <>
            {f.type === 'linear' && (
              <Num
                label="Угол градиента"
                value={f.angle ?? 0}
                min={-360}
                max={360}
                change={(angle) => patch({ fill: { ...f, angle } })}
              />
            )}
            {f.stops.map((s, i) => (
              <div className="field-pair" key={i}>
                <Color
                  label={'Цвет ' + (i + 1)}
                  value={s.color}
                  change={(color) =>
                    patch({
                      fill: {
                        ...f,
                        stops: f.stops.map((v, j) =>
                          j === i ? { ...v, color } : v
                        ),
                      },
                    })
                  }
                />
                <Num
                  label="Позиция"
                  value={s.offset}
                  min={f.stops[i - 1]?.offset ?? 0}
                  max={f.stops[i + 1]?.offset ?? 1}
                  step={0.01}
                  change={(offset) =>
                    patch({
                      fill: {
                        ...f,
                        stops: f.stops.map((v, j) =>
                          j === i ? { ...v, offset } : v
                        ),
                      },
                    })
                  }
                />
                <button
                  disabled={f.stops.length <= 2}
                  onClick={() =>
                    patch({
                      fill: { ...f, stops: f.stops.filter((_, j) => i !== j) },
                    })
                  }
                >
                  Убрать
                </button>
              </div>
            ))}
            <button
              disabled={f.stops.length >= 16}
              onClick={() =>
                patch({
                  fill: {
                    ...f,
                    stops: [...f.stops, { offset: 1, color: '#ffffff' }],
                  },
                })
              }
            >
              Добавить цвет
            </button>
          </>
        )}
        <Color
          label="Цвет контура"
          value={item.stroke ?? '#275b68'}
          change={(stroke) => patch({ stroke })}
        />
        <Num
          label="Толщина контура"
          min={0}
          max={100}
          value={item.strokeWidth ?? 0}
          change={(strokeWidth) => patch({ strokeWidth })}
        />
        <Toggle
          label="Пунктир"
          value={!!item.dash}
          change={(on) => patch({ dash: on ? [12, 8] : undefined })}
        />
        {['rounded', 'rect'].includes(item.shape!) && (
          <Num
            label="Скругление"
            min={0}
            max={4096}
            value={item.radius ?? (item.shape === 'rounded' ? 24 : 0)}
            change={(radius) => patch({ radius })}
          />
        )}
      </PropertySection>
      <PropertySection id="shape-shadow" title="Тени и эффекты">
        <Toggle
          label="Тень"
          value={!!item.shadow}
          change={(on) =>
            patch({
              shadow: on
                ? { x: 4, y: 6, blur: 8, color: '#799390' }
                : undefined,
            })
          }
        />
        {item.shadow && (
          <>
            <Color
              label="Цвет тени"
              value={item.shadow.color}
              change={(color) => patch({ shadow: { ...item.shadow!, color } })}
            />
            {(['x', 'y', 'blur'] as const).map((k) => (
              <Num
                key={k}
                label={
                  { x: 'Смещение X', y: 'Смещение Y', blur: 'Размытие' }[k]
                }
                min={k === 'blur' ? 0 : -200}
                max={k === 'blur' ? 100 : 200}
                value={item.shadow![k]}
                change={(v) => patch({ shadow: { ...item.shadow!, [k]: v } })}
              />
            ))}
          </>
        )}
      </PropertySection>
      {item.shape === 'path' && (
        <PropertySection id="path" title="Контур фигуры" initial>
          <Toggle
            label="Замкнуть контур"
            value={!!item.closed}
            change={(closed) => patch({ closed })}
          />
          <small>Перетаскивайте узлы и круглые ручки на холсте.</small>
          {item.nodes!.map((n, i) => (
            <div key={i} className="field-pair">
              <span>Узел {i + 1}</span>
              <button
                onClick={() =>
                  patch({
                    nodes: item.nodes!.map((p, j) =>
                      j !== i
                        ? p
                        : p.in || p.out
                          ? { x: p.x, y: p.y }
                          : {
                              ...p,
                              in: { x: p.x - 12, y: p.y },
                              out: { x: p.x + 12, y: p.y },
                            }
                    ),
                  })
                }
              >
                {n.in || n.out ? 'Прямой' : 'Безье'}
              </button>
              <button
                disabled={item.nodes!.length <= 2}
                onClick={() =>
                  patch({ nodes: item.nodes!.filter((_, j) => j !== i) })
                }
              >
                Удалить
              </button>
            </div>
          ))}
          <button
            onClick={() => patch({ nodes: [...item.nodes!, { x: 50, y: 50 }] })}
          >
            Добавить узел
          </button>
        </PropertySection>
      )}
    </>
  )
}
export function GeometryPanel({
  item,
  patch,
  canPin,
}: {
  item: Item
  canPin?: boolean
  patch: (v: Partial<Item>) => void
}) {
  return (
    <PropertySection id="geometry" title="Геометрия и слой">
      <div className="field-pair">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <Num
            key={k}
            label={{ x: 'X', y: 'Y', w: 'Ширина', h: 'Высота' }[k]}
            min={k === 'x' || k === 'y' ? -8192 : 0.01}
            max={8192}
            value={item[k]}
            change={(v) => patch({ [k]: v })}
          />
        ))}
      </div>
      <Num
        label="Поворот"
        min={-360}
        max={360}
        value={item.rotation ?? 0}
        change={(rotation) => patch({ rotation })}
      />
      <Num
        label="Непрозрачность"
        min={0}
        max={1}
        step={0.05}
        value={item.opacity ?? 1}
        change={(opacity) => patch({ opacity })}
      />
      {canPin && (
        <Toggle
          label="Закрепить в шаблоне"
          value={!!item.fixed}
          change={(fixed) => patch({ fixed })}
        />
      )}
      <Toggle
        label="Отразить по горизонтали"
        value={!!item.flipX}
        change={(flipX) => patch({ flipX })}
      />
      <Toggle
        label="Отразить по вертикали"
        value={!!item.flipY}
        change={(flipY) => patch({ flipY })}
      />
      <Toggle
        label="Оформление шаблона"
        value={item.role === 'decoration'}
        change={(on) => patch({ role: on ? 'decoration' : 'content' })}
      />
    </PropertySection>
  )
}

import {
  ArrowLeft,
  Captions,
  Columns3,
  FileDown,
  Merge,
  PanelTop,
  Rows3,
  Save,
  SplitSquareHorizontal,
} from 'lucide-react'
import { CanvasViewport } from './CanvasViewport'
import {
  HistoryButtons,
  IconButton,
  PropertySection,
  Workspace,
} from './Workspace'
import { Editor } from './Editor'
import { download } from './instructions'
import { useCommands, type HistoryControls, type Action } from './StudioTools'
import { Background } from './Background'
import { useEffect, useRef, useState } from 'react'
import { Stage } from './Stage'
import type { TextEditStart } from './VisualText'
import {
  cell,
  repairSlots,
  defaultMaster,
  cellTypes,
  blankGrid,
  rectangles,
  validateGrid,
  target,
  kinds,
  type Cell,
  type Grid,
  type Insets,
  type Kind,
  type CellType,
} from './grid'
import { StylesPanel } from './Properties'
import { sourceText, activeTextStyleId } from './model'
import { isTextType, textTypes } from './textTypes'
import type { Template } from './catalog'

export function editTrack(
  source: Grid,
  axis: 'rows' | 'cols',
  index: number,
  remove: boolean
) {
  const g = structuredClone(source),
    pos = axis === 'rows' ? 'row' : 'col'
  if (remove) {
    if (g[axis].length === 1)
      throw Error('Сетка должна иметь хотя бы одну полосу')
    g[axis].splice(index, 1)
    g.cells = g.cells.filter((c) => !(c[pos] === index && c[axis] === 1))
    for (const c of g.cells) {
      if (c[pos] > index) c[pos]--
      else if (c[pos] + c[axis] > index) c[axis]--
    }
  } else {
    if (g[axis].length >= 24) throw Error('Максимум 24 полосы')
    g[axis].push(1)
    const last = g[axis].length - 1
    for (let i = 0; i < g[axis === 'rows' ? 'cols' : 'rows'].length; i++)
      g.cells.push(cell(axis === 'rows' ? last : i, axis === 'cols' ? last : i))
  }
  return g
}
function Padding({
  label,
  value,
  update,
}: {
  label: string
  value: Insets
  update: (v: Insets) => void
}) {
  return (
    <PropertySection id={label} title={label}>
      <div className="grid-fields">
        {['Все стороны', 'Сверху', 'Справа', 'Снизу', 'Слева'].map((n, i) => (
          <label key={n}>
            {n}
            <input
              type="number"
              min="0"
              max="1279"
              value={
                i
                  ? value[i - 1]
                  : value.every((v) => v === value[0])
                    ? value[0]
                    : ''
              }
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value))
                update(
                  value.map((x, j) => (!i || j === i - 1 ? v : x)) as Insets
                )
              }}
            />
          </label>
        ))}
      </div>
    </PropertySection>
  )
}
export function GridDesigner({
  libraryAvailable,
  template,
  set,
  history,
  save,
  back,
  notice,
}: {
  libraryAvailable?: boolean
  template: Template
  history: HistoryControls
  set: (t: Template) => void
  save: () => void
  back: () => void
  notice: (s: string) => void
}) {
  const clipboard = useRef<Cell | null>(null)
  const [kind, choose] = useState<Kind>('title'),
    [selected, select] = useState(''),
    [merge, merging] = useState(false)
  const [objects, setObjects] = useState(false)
  const [sourceEdit, setSourceEdit] = useState<
    | (TextEditStart & {
        id: string
        slideId: string
      })
    | null
  >(null)
  const [inspectorRequest, requestInspector] = useState(0)
  const cellProperties = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!merge) return
    const cancel = (e: KeyboardEvent) => {
      if (e.code === 'Escape') merging(false)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [merge])
  const canvas = useRef<HTMLDivElement>(null)
  const structural = template.kind === 'layout',
    deck = template.deck,
    s = deck.slides[structural ? 0 : kinds.indexOf(kind)],
    g = structural
      ? (s.structure ?? blankGrid('free'))
      : deck.master.schemes[kind]
  const c = g.cells.find((v) => v.id === selected) ?? g.cells[0]
  const selectedStyleId = activeTextStyleId(undefined, c)
  const activeSourceEdit = sourceEdit?.slideId === s.id ? sourceEdit : null
  function change(next: Grid) {
    try {
      validateGrid(next, structural)
      const d = structuredClone(deck)
      if (structural) d.slides[0].structure = next
      else d.master.schemes[kind] = next
      // Keep every detached example object accessible after changing the grid.
      const page = d.slides[structural ? 0 : kinds.indexOf(kind)]
      page.items = repairSlots(d.master, page).items
      set({ ...template, deck: d })
    } catch (e) {
      notice((e as Error).message)
    }
  }
  function patch(v: Partial<Cell>) {
    change({
      ...g,
      cells: g.cells.map((o) => (o.id === c.id ? { ...o, ...v } : o)),
    })
  }
  function changeType(type: CellType) {
    if (type === c.type) return
    const { style, textStyle, bindingType, value, ...geometry } = c
    change({
      ...g,
      cells: g.cells.map((o) =>
        o.id === c.id
          ? {
              ...geometry,
              type,
              ...(isTextType(type) ? { value: textTypes[type] } : {}),
            }
          : o
      ),
    })
  }
  function updateSources(value: string, every = false, cellId = c.id) {
    const field = g.cells.find((o) => o.id === cellId)

    if (!field || !isTextType(field.type)) return

    const d = structuredClone(deck)

    for (const page of d.slides) {
      if (!every && page.id !== s.id) continue

      const ids = new Set<string>()

      const update = (grid: Grid | undefined, prefix: string) => {
        for (const targetCell of grid?.cells ?? []) {
          if (
            every ? targetCell.type !== field.type : targetCell.id !== field.id
          ) {
            continue
          }

          targetCell.value = value

          ids.add(prefix + targetCell.id)
        }
      }

      if (!structural) {
        update(d.master.schemes[page.kind ?? 'normal'], 'm/')
      }

      if (structural || every) {
        update(page.structure, 's/')
      }

      page.items = page.items.filter(
        (item) => item.fixed || !ids.has(target(item))
      )
    }

    set({ ...template, deck: d })
  }
  function editSource(cellId: string, start: TextEditStart = {}) {
    const field = g.cells.find((o) => o.id === cellId)

    if (!field || !isTextType(field.type) || merge) {
      return
    }

    select(field.id)

    setSourceEdit({
      ...start,
      id: (structural ? 's/' : 'm/') + field.id,
      slideId: s.id,
    })
  }
  function pick(v: Cell) {
    if (!merge) {
      select(v.id)
      return
    }
    merging(false)
    const row = Math.min(c.row, v.row),
      col = Math.min(c.col, v.col),
      endY = Math.max(c.row + c.rows, v.row + v.rows),
      endX = Math.max(c.col + c.cols, v.col + v.cols)
    const inside = g.cells.filter(
      (o) =>
        o.row < endY &&
        o.row + o.rows > row &&
        o.col < endX &&
        o.col + o.cols > col
    )
    if (
      inside.some(
        (o) =>
          o.row < row ||
          o.col < col ||
          o.row + o.rows > endY ||
          o.col + o.cols > endX
      )
    ) {
      notice('Выделите прямоугольник из целых ячеек.')
      return
    }
    change({
      ...g,
      cells: [
        ...g.cells.filter((o) => !inside.includes(o)),
        { ...c, row, col, rows: endY - row, cols: endX - col },
      ],
    })
  }
  function commands(o: Cell): Action[] {
    const base = () => ({
      id: o.id,
      row: o.row,
      col: o.col,
      rows: o.rows,
      cols: o.cols,
    })
    function copy() {
      clipboard.current = structuredClone(o)
    }
    function replace(next: Cell) {
      change({ ...g, cells: g.cells.map((v) => (v.id === o.id ? next : v)) })
    }
    return [
      {
        name: 'Свойства ячейки',
        run: () => {
          select(o.id)
          requestInspector((value) => value + 1)
          requestAnimationFrame(() => {
            const section = cellProperties.current?.closest('details')
            if (section) section.open = true
            requestAnimationFrame(() =>
              section?.querySelector('summary')?.focus()
            )
          })
        },
      },
      { name: 'Копировать настройки', key: 'c', run: copy },
      {
        name: 'Вырезать настройки',
        key: 'x',
        run: () => {
          copy()
          replace({ ...base(), type: 'empty', padding: [0, 0, 0, 0] })
        },
      },
      {
        name: 'Вставить настройки',
        key: 'v',
        run: () => {
          if (clipboard.current)
            replace({ ...structuredClone(clipboard.current), ...base() })
        },
      },
    ]
  }
  const context = useCommands(
    objects ? [] : [...history.actions, ...commands(c)]
  )
  const drag = useRef<{
    axis: 'rows' | 'cols'
    index: number
    start: number
    base: Grid
  } | null>(null)
  const exportTemplate = () =>
    download(
      deck.title + '.atlas.json',
      JSON.stringify(template, null, 2),
      'application/json'
    )

  function splitCell() {
    const cells = g.cells.filter((o) => o.id !== c.id)
    for (let row = 0; row < c.rows; row++)
      for (let col = 0; col < c.cols; col++)
        cells.push(
          row || col
            ? cell(c.row + row, c.col + col)
            : { ...c, rows: 1, cols: 1 }
        )
    change({ ...g, cells })
  }

  if (objects) {
    return (
      <Editor
        deck={deck}
        initialSlideId={s.id}
        gridTemplateKind={template.kind}
        libraryAvailable={libraryAvailable}
        history={history}
        change={(update) => set({ ...template, deck: update(deck) })}
        status="Редактор оформления"
        exitLabel="К сетке шаблона"
        back={() => setObjects(false)}
        headerTools={
          <IconButton label="В библиотеку" onClick={back}>
            <ArrowLeft />
          </IconButton>
        }
        saveTemplate={save}
        exportTemplate={exportTemplate}
        action={() => {}}
        view={() => {}}
        notice={notice}
      />
    )
  }

  return (
    <>
      {context.menu}
      <Workspace
        scope="grid"
        inspectorRequest={inspectorRequest}
        header={
          <>
            <IconButton label="В библиотеку" onClick={back}>
              <ArrowLeft />
            </IconButton>
            <input
              aria-label="Название шаблона"
              maxLength={200}
              value={deck.title}
              onChange={(e) =>
                set({
                  ...template,
                  deck: {
                    ...deck,
                    title: e.target.value,
                    master: { ...deck.master, name: e.target.value },
                  },
                })
              }
            />
            <small className="edit-status" role="status">
              {structural ? 'Шаблон компоновки' : 'Главный шаблон'}
            </small>
            <IconButton
              label="Оформление и объекты"
              onClick={() => {
                setSourceEdit(null)
                setObjects(true)
              }}
            >
              <Captions />
            </IconButton>
            <button
              className="primary"
              aria-label="Сохранить шаблон"
              title="Сохранить шаблон"
              onClick={save}
            >
              <Save size={16} />
              <span>Сохранить шаблон</span>
            </button>
            <IconButton label="Экспортировать JSON" onClick={exportTemplate}>
              <FileDown />
            </IconButton>
          </>
        }
        navigationLabel="Схемы"
        navigation={
          !structural ? (
            <div className="workspace-schemes">
              {kinds.map((v, i) => (
                <button
                  aria-pressed={v === kind}
                  key={v}
                  onClick={() => {
                    setSourceEdit(null)
                    choose(v)
                    select('')
                    merging(false)
                  }}
                >
                  <PanelTop size={16} />
                  {['Титульный', 'Обычный', 'Завершающий'][i]}
                </button>
              ))}
            </div>
          ) : undefined
        }
        tools={
          <>
            <div
              className="workspace-tool-group"
              role="group"
              aria-label="Сетка"
            >
              <IconButton
                label="Добавить строку"
                onClick={() => change(editTrack(g, 'rows', 0, false))}
                disabled={g.rows.length >= 24}
              >
                <Rows3 />
              </IconButton>
              <IconButton
                label="Добавить столбец"
                onClick={() => change(editTrack(g, 'cols', 0, false))}
                disabled={g.cols.length >= 24}
              >
                <Columns3 />
              </IconButton>
              <IconButton
                label="Объединить ячейки"
                aria-pressed={merge}
                title={merge ? 'Выберите последнюю ячейку' : undefined}
                onClick={() => merging(!merge)}
              >
                <Merge />
              </IconButton>
              <IconButton
                label="Разделить ячейку"
                disabled={c.rows === 1 && c.cols === 1}
                onClick={splitCell}
              >
                <SplitSquareHorizontal />
              </IconButton>
              {merge && (
                <span role="status" className="merge-status">
                  Выберите последнюю ячейку
                </span>
              )}
            </div>
            <HistoryButtons history={history} />
          </>
        }
        properties={
          <>
            <PropertySection id="grid-tracks" title="Сетка" initial>
              {(['rows', 'cols'] as const).map((axis) => (
                <div key={axis} className="field-pair">
                  <button
                    disabled={g[axis].length === 1}
                    onClick={() =>
                      change(
                        editTrack(
                          g,
                          axis,
                          axis === 'rows' ? c.row : c.col,
                          true
                        )
                      )
                    }
                  >
                    Удалить {axis === 'rows' ? 'строку' : 'столбец'}
                  </button>
                  <label>
                    Вес {axis === 'rows' ? 'строки' : 'столбца'}
                    <input
                      type="number"
                      min=".01"
                      step=".1"
                      value={g[axis][axis === 'rows' ? c.row : c.col]}
                      onChange={(e) =>
                        change({
                          ...g,
                          [axis]: g[axis].map((x, i) =>
                            i === (axis === 'rows' ? c.row : c.col)
                              ? Math.min(8192, Math.max(0.01, +e.target.value))
                              : x
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <Padding
                label="Отступы сетки"
                value={g.padding}
                update={(padding) => change({ ...g, padding })}
              />
            </PropertySection>
            <PropertySection
              id="grid-cell"
              title={'Ячейка ' + (c.row + 1) + ' × ' + (c.col + 1)}
              initial
            >
              <div ref={cellProperties} className="grid-cell-fields">
                <label>
                  Тип ячейки
                  <select
                    value={c.type}
                    onChange={(e) => changeType(e.target.value as CellType)}
                  >
                    {Object.entries(cellTypes)
                      .filter(
                        ([k]) =>
                          !structural ||
                          !['area', 'header', 'footer'].includes(k)
                      )
                      .map(([k, n]) => (
                        <option key={k} value={k}>
                          {n}
                        </option>
                      ))}
                  </select>
                </label>
                {isTextType(c.type) && (
                  <>
                    <label>
                      Исходный текст
                      <textarea
                        maxLength={200000}
                        value={sourceText(c)}
                        onChange={(e) => updateSources(e.target.value)}
                      />
                    </label>
                    <button
                      title={
                        structural
                          ? 'Все ячейки текущей компоновки'
                          : 'Все схемы и вложенные сетки текущего шаблона'
                      }
                      onClick={() => updateSources(sourceText(c), true)}
                    >
                      Применить ко всем ячейкам этого типа
                    </button>
                    <button
                      onClick={() =>
                        updateSources(
                          textTypes[c.type as keyof typeof textTypes]
                        )
                      }
                    >
                      Сбросить исходный текст
                    </button>
                    {c.bindingType && (
                      <small>
                        Прежний тип привязки · {textTypes[c.bindingType]}
                      </small>
                    )}
                    {c.type === 'text' && (
                      <label>
                        Пользовательский стиль
                        <select
                          aria-label="Пользовательский стиль"
                          value={c.textStyle ?? ''}
                          onChange={(e) => {
                            if (e.target.value)
                              patch({ textStyle: e.target.value })
                            else {
                              const { textStyle, ...rest } = c
                              change({
                                ...g,
                                cells: g.cells.map((o) =>
                                  o.id === c.id ? rest : o
                                ),
                              })
                            }
                          }}
                        >
                          <option value="">Системный стиль «Текст»</option>
                          {deck.theme.styles.map((style) => (
                            <option value={style.id} key={style.id}>
                              {style.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label>
                  Фон ячейки
                  <input
                    type="color"
                    value={c.fill ?? '#ffffff'}
                    onChange={(e) => patch({ fill: e.target.value })}
                  />
                </label>
                <label>
                  Цвет рамки
                  <input
                    type="color"
                    value={c.border ?? '#663399'}
                    onChange={(e) => patch({ border: e.target.value })}
                  />
                </label>
                <label>
                  Толщина рамки
                  <input
                    type="number"
                    min="0"
                    max="64"
                    value={c.width ?? 0}
                    onChange={(e) =>
                      patch({
                        width: Math.min(64, Math.max(0, +e.target.value)),
                      })
                    }
                  />
                </label>
                <Padding
                  label="Отступы ячейки"
                  value={c.padding}
                  update={(padding) => patch({ padding })}
                />
              </div>
            </PropertySection>
            <StylesPanel
              key={`${s.id}:${c.id}:${selectedStyleId}`}
              initialStyleId={selectedStyleId}
              deck={deck}
              notice={notice}
              change={(update) => set({ ...template, deck: update(deck) })}
            />
            {!structural && (
              <PropertySection id="grid-background" title="Фон">
                <Background
                  libraryAvailable={libraryAvailable}
                  deck={deck}
                  key={s.id}
                  slide={s}
                  notice={notice}
                  update={(next) =>
                    set({
                      ...template,
                      deck: {
                        ...deck,
                        slides: deck.slides.map((v) =>
                          v.id === s.id ? next : v
                        ),
                      },
                    })
                  }
                />
              </PropertySection>
            )}
            <PropertySection id="grid-description" title="Описание">
              <label>
                Описание шаблона
                <textarea
                  value={template.description}
                  maxLength={2000}
                  onChange={(e) =>
                    set({ ...template, description: e.target.value })
                  }
                />
              </label>
            </PropertySection>
          </>
        }
      >
        <CanvasViewport editable>
          <div ref={canvas} className="grid-board">
            <Stage
              deck={structural ? { ...deck, master: defaultMaster() } : deck}
              slide={s}
              showSource
              diagnostics
              textEdit={activeSourceEdit ?? undefined}
              finishTextEdit={() =>
                setSourceEdit((current) =>
                  current === activeSourceEdit ? null : current
                )
              }
              onSourceText={(id, fields) => {
                if (typeof fields.text !== 'string') return

                const prefix = structural ? 's/' : 'm/'

                if (!id.startsWith(prefix)) return

                updateSources(fields.text, false, id.slice(prefix.length))
              }}
              undo={(redo) =>
                history.actions
                  .find((a) => a.key === (redo ? 'shift+z' : 'z'))
                  ?.run()
              }
            />
            {rectangles(g).map(({ cell: o, outer: b }) => (
              <button
                key={o.id}
                aria-label={'Ячейка ' + (o.row + 1) + ', ' + (o.col + 1)}
                className={
                  'grid-cell ' +
                  (o.id === c.id ? 'selected ' : '') +
                  (activeSourceEdit?.id === (structural ? 's/' : 'm/') + o.id
                    ? 'editing'
                    : '')
                }
                style={{
                  left: b.x / 12.8 + '%',
                  top: b.y / 7.2 + '%',
                  width: b.w / 12.8 + '%',
                  height: b.h / 7.2 + '%',
                }}
                onContextMenu={(e) => {
                  select(o.id)
                  context.open(e, commands(o))
                }}
                onClick={(e) => {
                  if (merge || !isTextType(o.type)) {
                    pick(o)
                    return
                  }

                  editSource(o.id, {
                    point: {
                      left: e.clientX,
                      top: e.clientY,
                    },
                  })
                }}
              >
                <span>{cellTypes[o.type]}</span>
              </button>
            ))}
            {(['rows', 'cols'] as const).flatMap((axis) =>
              g[axis].slice(0, -1).map((_, i) => {
                const row = axis === 'rows',
                  dim = row ? 720 : 1280,
                  pad = row ? g.padding[0] : g.padding[3],
                  space = dim - pad - (row ? g.padding[2] : g.padding[1]),
                  sum = g[axis].reduce((a, b) => a + b)
                const at =
                  ((pad +
                    (space * g[axis].slice(0, i + 1).reduce((a, b) => a + b)) /
                      sum) /
                    dim) *
                    100 +
                  '%'
                const segments = rectangles(g).filter(
                  ({ cell: c }) => (row ? c.row : c.col) + c[axis] === i + 1
                )
                return segments.map(({ cell: c, outer: b }) => (
                  <div
                    key={axis + i + c.id}
                    role="separator"
                    aria-label={(row ? 'Строка ' : 'Столбец ') + (i + 1)}
                    className={'grid-divider ' + axis}
                    style={
                      row
                        ? {
                            top: at,
                            left: b.x / 12.8 + '%',
                            width: b.w / 12.8 + '%',
                          }
                        : {
                            left: at,
                            top: b.y / 7.2 + '%',
                            height: b.h / 7.2 + '%',
                          }
                    }
                    onPointerDown={(e) => {
                      if (e.button !== 0 || !e.isPrimary) return
                      e.currentTarget.setPointerCapture(e.pointerId)
                      drag.current = {
                        axis,
                        index: i,
                        start: row ? e.clientY : e.clientX,
                        base: g,
                      }
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current
                      if (!d || d.axis !== axis || d.index !== i) return
                      const rect = canvas.current!.getBoundingClientRect(),
                        next = structuredClone(d.base),
                        tracks = next[axis],
                        pair = tracks[i] + tracks[i + 1],
                        sum = tracks.reduce((a, b) => a + b)
                      tracks[i] = Math.max(
                        0.02,
                        Math.min(
                          pair - 0.02,
                          tracks[i] +
                            (((((row ? e.clientY : e.clientX) - d.start) /
                              (row ? rect.height : rect.width)) *
                              dim) /
                              space) *
                              sum
                        )
                      )
                      tracks[i + 1] = pair - tracks[i]
                      change(next)
                    }}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                    onLostPointerCapture={() => (drag.current = null)}
                  />
                ))
              })
            )}
          </div>
        </CanvasViewport>
      </Workspace>
    </>
  )
}

import { EditorHeader, type SaveControl } from './EditorHeader'
import { askConfirm } from './ConfirmDialog'
import { CanvasViewport } from './CanvasViewport'
import { TextStyleManager } from './TextStyleManager'
import { CellAppearance } from './CellAppearance'
import {
  HistoryButtons,
  IconButton,
  PropertySection,
  Workspace,
} from './Workspace'
import { type HistoryControls, useCommands, type Action } from './StudioTools'
import { Background } from './Background'
import { PlacementPanel } from './PlacementPanel'
import {
  slots,
  target,
  acceptsItem,
  linkCaptions,
  applyKind,
  inheritedBackground,
  freezeDecoration,
  validateGrid,
  type Cell,
} from './grid'
import { shapes } from './schema'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  ImagePlus,
  FolderOpen,
  Shapes,
  CloudUpload,
  RefreshCw,
  Type,
  Play,
  FileDown,
  HardDriveDownload,
} from 'lucide-react'
import type { StyleLibrary } from './styleLibrary'
import { TextPanel, ShapePanel, GeometryPanel, Num } from './Properties'
import { applyLayout, type Template } from './catalog'
import { importSVG } from './vectorImport'
import { Stage } from './Stage'
import { isTextType, type TextType } from './textTypes'
import { fontCatalog } from './fontCatalog'
import type { TextEditStart } from './VisualText'
import {
  newSlide,
  sourceText,
  newText,
  newShape,
  validateDeck,
  activeTextStyleId,
  type Deck,
  type Item,
  type Slide,
  type Characters,
} from './model'
import { Files } from './Files'
import { optimize, checkImageBudget } from './media'
import { type AvailabilityProps } from './AvailabilityControl'

type Props = {
  publishLabel?: string
  canPublish?: boolean
  libraryAvailable?: boolean
  history: HistoryControls
  availability?: AvailabilityProps
  deck: Deck
  initialSlideId?: string
  initialSlotId?: string
  allowBleed?: boolean
  styleLibrary?: StyleLibrary
  templates?: Template[]
  resolveTemplate?: (t: Template) => Promise<Template>
  syncLabel?: string
  openSync?: () => void
  gridTemplateKind?: Template['kind']
  saveAs?: () => void
  saveTemplate?: () => void
  saveControl: SaveControl
  exportTemplate?: () => void
  headerTools?: React.ReactNode
  exitLabel?: string
  description?: string
  describe?: (v: string) => void
  change: (f: (d: Deck) => Deck) => void
  back: () => void
  view: () => void
  status: string
  action: (id: 'export' | 'publish' | 'offline') => void
  notice: (s: string) => void
}
export function Editor({
  deck,
  initialSlideId,
  initialSlotId,
  allowBleed,
  publishLabel,
  canPublish,
  availability,
  libraryAvailable,
  saveAs,
  styleLibrary,
  templates = [],
  resolveTemplate,
  saveTemplate,
  saveControl,
  exportTemplate,
  headerTools,
  exitLabel = 'В библиотеку',
  gridTemplateKind,
  description,
  describe,
  change,
  history,
  back,
  view,
  status,
  action,
  notice,
}: Props) {
  const clipboard = useRef<Item[]>([])
  const [sid, choose] = useState(initialSlideId ?? deck.slides[0].id),
    [sel, select] = useState('')
  const [selectedSlot, setSelectedSlot] = useState(initialSlotId ?? '')
  const [styleManager, setStyleManager] = useState(false)
  const freeDecoration =
    !!saveTemplate &&
    (gridTemplateKind === 'presentation' || allowBleed === true)
  const [edit, setEdit] = useState<
    (TextEditStart & { id: string; slideId: string; source?: Item }) | null
  >(null)
  const thumbnailList = useRef<HTMLDivElement>(null)
  const slide = deck.slides.find((s) => s.id === sid) || deck.slides[0],
    idx = deck.slides.indexOf(slide),
    item = slide.items.find((x) => x.id === sel)
  const input = useRef<HTMLInputElement>(null),
    background = useRef(false)
  function modify(fn: (s: Slide) => Slide, checkSize = false) {
    change((d) => {
      const next = {
        ...d,
        slides: d.slides.map((s) =>
          s.id === slide.id ? linkCaptions(d.master, fn(s)) : s
        ),
      }
      if (checkSize) checkImageBudget(next)
      return next
    })
  }
  const chosenSlot = useRef('')
  const locations = slots(deck.master, slide)
  const activeSlot = locations.find((v) => v.id === selectedSlot)
  const itemCell = item?.fixed
    ? undefined
    : locations.find((v) => v.id === item?.slot)?.cell
  const cellSlot = locations.find(
    (v) => v.id === (selectedSlot || (item && !item.fixed ? target(item) : ''))
  )
  const realCellSlot =
    (cellSlot?.id === 'free'
      ? locations.find((v) => v.id === 'm/' + cellSlot.cell.id)
      : cellSlot) ??
    locations.find((v) => v.id.startsWith('s/')) ??
    locations.find((v) => v.id.startsWith('m/'))
  function updateCell(fields: Partial<Cell>) {
    if (!realCellSlot || !saveTemplate) return
    const id = realCellSlot.id
    change((d) => {
      const next = structuredClone(d)
      const page = next.slides.find((s) => s.id === slide.id)
      if (!page) return d
      const grid = id.startsWith('s/')
        ? page.structure
        : next.master.schemes[page.kind ?? 'normal']
      if (!grid) return d
      const c = grid.cells.find((c) => c.id === id.slice(2))
      if (!c) return d
      Object.assign(c, fields)
      if (fields.fill === undefined && Object.hasOwn(fields, 'fill'))
        delete c.fill
      try {
        validateGrid(grid, id.startsWith('s/'))
      } catch (error) {
        notice((error as Error).message)
        return d
      }
      return next
    })
  }
  const textEdit = edit?.slideId === slide.id ? edit : null
  const draft =
    textEdit?.source && !slide.items.some((o) => o.id === textEdit.id)
      ? textEdit.source
      : undefined
  const styleItem = item ?? draft
  const styleCell = styleItem
    ? styleItem.fixed
      ? undefined
      : locations.find((v) => v.id === styleItem.slot)?.cell
    : activeSlot?.cell

  const selectedStyleId = activeTextStyleId(styleItem, styleCell)
  function editText(id: string, start: TextEditStart = {}) {
    select(id)
    setEdit({ ...start, id, slideId: slide.id })
  }
  function editSource(id: string, start: TextEditStart = {}) {
    const dest = locations.find((v) => v.id === id)
    if (!dest || !isTextType(dest.cell.type)) return
    const source = { ...newText(), text: sourceText(dest.cell), slot: id }
    setSelectedSlot(id)
    select(source.id)
    setEdit({ ...start, id: source.id, slideId: slide.id, source })
  }
  function updateSystemStyle(type: TextType, fields: Characters) {
    change((d) => {
      const style = { ...d.theme.systemStyles[type], ...fields }
      if (fields.font) {
        const face = Object.hasOwn(fontCatalog, fields.font)
          ? fontCatalog[fields.font]
          : undefined
        if (!face?.weights.includes(Number(style.weight ?? 400)))
          style.weight = '400'
        if (!face?.italic && style.italic) style.italic = false
      }
      return {
        ...d,
        theme: {
          ...d.theme,
          systemStyles: { ...d.theme.systemStyles, [type]: style },
        },
      }
    })
  }
  function additions(s: Slide, added: Item[]) {
    const available = slots(deck.master, s),
      used = new Set(s.items.map(target))
    return added.map((o) => {
      // In the presentation design editor, new objects are decorations unless
      // the user explicitly selected a compatible content slot.
      if (
        freeDecoration &&
        !available.some(
          (v) =>
            v.id === chosenSlot.current &&
            v.id !== 'free' &&
            acceptsItem(v.cell, o) &&
            (v.cell.type === 'free' || !used.has(v.id))
        )
      )
        return { ...o, fixed: true, role: 'decoration' as const }
      const match =
        available.find(
          (v) =>
            v.id === chosenSlot.current &&
            acceptsItem(v.cell, o) &&
            (v.cell.type === 'free' || !used.has(v.id))
        ) ??
        available.find(
          (v) =>
            v.cell.type !== 'free' && acceptsItem(v.cell, o) && !used.has(v.id)
        ) ??
        available.find((v) => v.cell.type === 'free')
      if (!match && saveTemplate && gridTemplateKind !== 'layout')
        return { ...o, fixed: true, role: 'decoration' as const }
      if (match) used.add(match.id)
      return match?.id === 'free' ? o : { ...o, slot: match?.id ?? 'tray' }
    })
  }
  function patch(id: string, fields: Partial<Item>) {
    modify((s) => {
      const addDraft = draft?.id === id && !s.items.some((it) => it.id === id)
      return {
        ...s,
        items: (addDraft ? [...s.items, draft] : s.items).map((it) =>
          it.id === id
            ? (Object.fromEntries(
                Object.entries({ ...it, ...fields }).filter(
                  ([, value]) => value !== undefined
                )
              ) as unknown as Item)
            : it
        ),
      }
    })
  }
  function removeItem() {
    if (item)
      modify((s) => ({ ...s, items: s.items.filter((it) => it.id !== sel) }))
    select('')
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (document.querySelector('dialog.atlas-confirm[open]')) return
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable],[data-text-controls],.text-style-manager'
        )
      )
        return
      if (
        item &&
        !item.locked &&
        (!item.fixed || saveTemplate) &&
        ['Delete', 'Backspace'].includes(e.key)
      ) {
        e.preventDefault()
        removeItem()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  function reorder(delta: number) {
    const to = idx + delta
    if (to < 0 || to >= deck.slides.length) return
    change((d) => {
      const slides = d.slides.slice()
      ;[slides[idx], slides[to]] = [slides[to], slides[idx]]
      return { ...d, slides }
    })
  }
  function addSlide() {
    const normal = deck.slides.find((s) => s.kind === 'normal')
    const fresh = normal
      ? {
          ...structuredClone(normal),
          id: crypto.randomUUID(),
          notes: '',
          items: normal.items
            .filter((o) => o.role === 'decoration')
            .map((o) => ({ ...structuredClone(o), id: crypto.randomUUID() })),
        }
      : newSlide()
    change((d) => ({
      ...d,
      slides: [
        ...d.slides.slice(0, idx + 1),
        deck.master.art
          ? applyKind(
              deck.master,
              { ...fresh, ownBackground: false, items: [] },
              'normal'
            )
          : fresh,
        ...d.slides.slice(idx + 1),
      ],
    }))
    choose(fresh.id)
    select('')
  }
  async function delSlide() {
    if (
      !(await askConfirm(
        'Удалить текущий слайд вместе с объектами и заметками?',
        { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
      ))
    )
      return
    const slides = deck.slides.filter((s) => s.id !== slide.id)
    if (!slides.length) slides.push(newSlide())
    change((d) => ({ ...d, slides }))
    choose(slides[Math.min(idx, slides.length - 1)].id)
    select('')
  }
  function pickImage(bg = false) {
    background.current = bg
    input.current?.click()
  }
  const [picker, setPicker] = useState(false)
  function addImage(src: string, width: number, height: number, bg: boolean) {
    if (bg) modify((s) => ({ ...s, background: src }), true)
    else {
      const w = Math.min(700, width, (520 * width) / height),
        h = (w * height) / width
      const img: Item = {
        ...newText(),
        type: 'image',
        src,
        text: '',
        x: (1280 - w) / 2,
        y: (720 - h) / 2,
        w,
        h,
      }
      modify(
        (s) => ({ ...s, items: [...s.items, ...additions(s, [img])] }),
        true
      )
      select(img.id)
    }
  }
  async function insert(file: File) {
    const bg = background.current
    try {
      if (!bg && (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name))) {
        const items = await importSVG(file)
        const next = {
          ...slide,
          items: [...slide.items, ...additions(slide, items)],
        }
        validateDeck({ ...deck, slides: [next] })
        modify((s) => ({ ...s, items: [...s.items, ...additions(s, items)] }))
        select(items[0].id)
        notice('SVG добавлен как редактируемые векторные фигуры.')
        return
      }
      const { src, width, height } = await optimize(file)
      addImage(src, width, height, bg)
    } catch (e) {
      notice((e as Error).message)
    }
  }
  const editable = (o: Item) => !o.locked && (!o.fixed || !!saveTemplate)
  function commands(o?: Item): Action[] {
    const actions: Action[] = []
    function copy() {
      if (o)
        clipboard.current = structuredClone(
          slide.items.filter(
            (v) =>
              v.id === o.id || (o.group && o.group === v.group && editable(v))
          )
        )
    }
    function paste(source = clipboard.current) {
      if (!source.length) return
      if (slide.items.length + source.length > 500) {
        notice('На слайде можно разместить до 500 объектов.')
        return
      }
      const ids = new Map<string, string>()
      const copies = source.map((v) => {
        const x = { ...structuredClone(v), id: crypto.randomUUID() }
        delete x.slot
        delete x.priorSlot
        delete x.fixed
        for (const k of ['group', 'relation'] as const)
          if (x[k]) {
            const key = k + x[k]
            if (!ids.has(key)) ids.set(key, 'g' + crypto.randomUUID())
            x[k] = ids.get(key)
          }
        return x
      })
      modify((s) => ({ ...s, items: [...s.items, ...additions(s, copies)] }))
      select(copies[0].id)
    }
    if (o) {
      actions.push({ name: 'Свойства', run: () => select(o.id) })
      if (editable(o)) {
        actions.push(
          { name: 'Копировать', key: 'c', run: copy },
          {
            name: 'Вырезать',
            key: 'x',
            run: () => {
              copy()
              const ids = new Set(clipboard.current.map((v) => v.id))
              modify((s) => ({
                ...s,
                items: s.items.filter((v) => !ids.has(v.id)),
              }))
              select('')
            },
          },
          {
            name: 'Дублировать',
            run: () => {
              copy()
              paste()
            },
          },
          {
            name: 'Удалить',
            run: () => {
              modify((s) => ({
                ...s,
                items: s.items.filter((v) => v.id !== o.id),
              }))
              select('')
            },
          }
        )
        for (const delta of [-1, 1]) {
          const i = slide.items.indexOf(o),
            adj = slide.items[i + delta]
          if (adj && target(adj) !== 'tray')
            actions.push({
              name: delta > 0 ? 'Выше' : 'Ниже',
              run: () => reorderLayer(o.id, adj.id),
            })
        }
      }
      if (!o.fixed || saveTemplate) {
        actions.push(
          {
            name: o.locked ? 'Разблокировать' : 'Заблокировать',
            run: () => patch(o.id, { locked: !o.locked }),
          },
          {
            name: o.hidden ? 'Показать слой' : 'Скрыть слой',
            run: () => patch(o.id, { hidden: !o.hidden }),
          }
        )
        if (!o.locked)
          actions.push({
            name: 'Переименовать',
            run: () => {
              const n = prompt(
                'Название слоя',
                o.layerName ?? o.text.slice(0, 40)
              )
              if (n?.trim()) patch(o.id, { layerName: n.trim().slice(0, 200) })
            },
          })
      }
    }
    actions.push({ name: 'Вставить', key: 'v', run: () => paste() })
    return actions
  }
  function reorderLayer(id: string, dest: string) {
    modify((s) => {
      const items = s.items.slice(),
        from = items.findIndex((v) => v.id === id),
        to = items.findIndex((v) => v.id === dest)
      if (from < 0 || to < 0 || !editable(items[from])) return s
      items.splice(to, 0, items.splice(from, 1)[0])
      return { ...s, items }
    })
  }
  const actions = commands(item),
    context = useCommands([...history.actions, ...actions])
  useEffect(() => {
    const scroll = thumbnailList.current?.closest('.workspace-scroll')
    if (!scroll) return
    function reveal() {
      const thumb =
        thumbnailList.current?.querySelector<HTMLElement>('.thumb.active')
      if (!thumb || !scroll?.clientHeight) return
      const item = thumb.getBoundingClientRect()
      const area = scroll.getBoundingClientRect()
      if (item.top < area.top) scroll.scrollTop += item.top - area.top
      else if (item.bottom > area.bottom)
        scroll.scrollTop += item.bottom - area.bottom
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [slide.id, idx])
  function rows(tray: boolean) {
    return slide.items
      .filter((o) => (target(o) === 'tray') === tray)
      .reverse()
      .map((o) => (
        <button
          aria-label={
            tray
              ? undefined
              : 'Слой ' +
                (o.layerName ||
                  o.text.slice(0, 38) ||
                  { shape: 'Фигура', text: 'Текст', image: 'Изображение' }[
                    o.type
                  ])
          }
          className="layer-row"
          key={o.id}
          aria-pressed={o.id === sel}
          draggable={!tray && editable(o)}
          onDragStart={(e) =>
            e.dataTransfer.setData('application/atlas-layer', o.id)
          }
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) =>
            reorderLayer(
              e.dataTransfer.getData('application/atlas-layer'),
              o.id
            )
          }
          onClick={() => select(o.id)}
          onContextMenu={(e) => {
            select(o.id)
            context.open(e, commands(o))
          }}
        >
          <span aria-hidden="true">
            {o.type === 'text' ? 'T' : o.type === 'image' ? '▧' : '◇'}
          </span>
          {o.layerName ||
            o.text.slice(0, 38) ||
            { text: 'Текст', shape: 'Фигура', image: 'Изображение' }[
              o.type
            ]}{' '}
          {o.fixed ? ' · закреплён' : ''}
          {o.locked ? ' · заблокирован' : ''}
          {o.role === 'decoration' ? ' · декор' : ''}
          {o.hidden ? ' · скрыт' : ''}
        </button>
      ))
  }
  return (
    <>
      {context.menu}
      {styleManager && (
        <TextStyleManager
          deck={deck}
          slide={slide}
          initialStyleId={selectedStyleId}
          library={styleLibrary}
          change={change}
          close={() => setStyleManager(false)}
          notice={notice}
        />
      )}
      {picker && (
        <div className="overlay">
          <section
            className="dialog file-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Выбор изображения"
          >
            <button onClick={() => setPicker(false)}>Закрыть</button>
            <Files
              pick={({ src, width, height }) => {
                addImage(src, width, height, false)
                setPicker(false)
              }}
            />
          </section>
        </div>
      )}
      <Workspace
        scope={saveTemplate ? 'template' : 'lesson'}
        header={
          <EditorHeader
            back={back}
            exitLabel={exitLabel}
            nameLabel={saveTemplate ? 'Название шаблона' : 'Название методички'}
            title={deck.title}
            rename={(title) => change((d) => ({ ...d, title }))}
            availability={availability}
            status={status}
            save={saveControl}
          >
            {!saveTemplate && (
              <button
                className="primary"
                aria-label="Показать"
                title="Показать"
                onClick={view}
              >
                <Play size={16} />
                <span>Показать</span>
              </button>
            )}

            {!availability && publishLabel && (
              <button
                className="primary"
                disabled={!canPublish}
                title={publishLabel}
                aria-label={publishLabel}
                onClick={() => action('publish')}
              >
                <CloudUpload size={16} />
                <span>{publishLabel}</span>
              </button>
            )}

            {headerTools}
            {!saveTemplate && (
              <IconButton
                label="Подготовить к офлайн-показу"
                onClick={() => action('offline')}
              >
                <HardDriveDownload />
              </IconButton>
            )}
            {(!saveTemplate || exportTemplate) && (
              <IconButton
                label="Экспортировать JSON"
                className="editor-export"
                onClick={exportTemplate ?? (() => action('export'))}
              >
                <FileDown />
              </IconButton>
            )}
          </EditorHeader>
        }
        navigationLabel="Слайды"
        navigationActions={
          !gridTemplateKind && (
            <IconButton label="Слайд" title="Добавить слайд" onClick={addSlide}>
              <Plus />
            </IconButton>
          )
        }
        navigation={
          <div ref={thumbnailList}>
            {' '}
            {deck.slides.map((s, i) => (
              <button
                key={s.id}
                className={'thumb ' + (s.id === slide.id ? 'active' : '')}
                aria-current={s.id === slide.id ? 'step' : undefined}
                aria-label={'Слайд ' + (i + 1)}
                onClick={() => {
                  choose(s.id)
                  select('')
                  setSelectedSlot('')
                  chosenSlot.current = ''
                }}
              >
                <b>{i + 1}</b>
                <Stage deck={deck} slide={s} />
              </button>
            ))}
          </div>
        }
        tools={
          <>
            <div
              className="workspace-tool-group"
              role="group"
              aria-label="Добавление объектов"
            >
              <IconButton
                label="Добавить текст"
                onClick={() => {
                  const [text] = additions(slide, [newText()])
                  modify((s) => ({
                    ...s,
                    items: [...s.items, text],
                  }))
                  if (target(text) === 'tray') select(text.id)
                  else editText(text.id, { selectAll: true })
                }}
              >
                <Type />
              </IconButton>
              <IconButton
                label="Фигура"
                onClick={() => {
                  const shape = newShape()
                  modify((s) => ({
                    ...s,
                    items: [...s.items, ...additions(s, [shape])],
                  }))
                  select(shape.id)
                }}
              >
                <Shapes />
              </IconButton>
              {libraryAvailable && (
                <IconButton
                  label="Выбрать из моих файлов"
                  onClick={() => setPicker(true)}
                >
                  <FolderOpen />
                </IconButton>
              )}
              <IconButton label="Изображение" onClick={() => pickImage()}>
                <ImagePlus />
              </IconButton>
            </div>
            <HistoryButtons history={history} />
            <IconButton
              label="Текстовые стили"
              onClick={() => {
                setEdit(null)
                setStyleManager(true)
              }}
            >
              <Type />
            </IconButton>
          </>
        }
        notes={
          !gridTemplateKind && (
            <textarea
              aria-label="Заметки преподавателя"
              value={slide.notes}
              placeholder="Что важно рассказать на этом слайде?"
              onChange={(e) => modify((s) => ({ ...s, notes: e.target.value }))}
            />
          )
        }
        properties={
          <>
            <PlacementPanel
              key={slide.id}
              deck={deck}
              slide={slide}
              templates={templates}
              resolveTemplate={resolveTemplate}
              update={(next) =>
                change((latest) => {
                  if (latest !== deck) {
                    notice('Методичка изменилась. Примените шаблон ещё раз.')
                    return latest
                  }
                  return next
                })
              }
              select={select}
              selected={item?.locked ? '' : sel}
              notice={notice}
              saveAs={saveAs}
              design={!!saveTemplate}
            />
            <>
              {slide.items.some((o) => target(o) === 'tray') && (
                <PropertySection
                  id="unplaced"
                  title="Нераспределённые элементы"
                  initial
                >
                  <div className="layer-list">{rows(true)}</div>
                </PropertySection>
              )}
              <PropertySection id="layers" title="Слои" initial>
                <div className="layer-list">
                  {rows(false)}
                  <button
                    onClick={() => select('')}
                    onContextMenu={(e) =>
                      context.open(e, [
                        { name: 'Свойства фона', run: () => select('') },
                      ])
                    }
                  >
                    🔒 Фон
                  </button>
                </div>
              </PropertySection>
              <PropertySection
                id="object-actions"
                title={item ? 'Действия с объектом' : 'Буфер обмена'}
              >
                {actions.map((a) => (
                  <button key={a.name} onClick={a.run}>
                    {a.name}
                  </button>
                ))}
              </PropertySection>
            </>
            <section
              className="inspector-level"
              aria-label="Область редактирования"
            >
              <h3>Область редактирования</h3>
              <PropertySection id="slide" title="Свойства слайда" initial>
                {describe && (
                  <label>
                    Описание шаблона
                    <textarea
                      maxLength={2000}
                      value={description}
                      onChange={(e) => describe(e.target.value)}
                    />
                  </label>
                )}
                {!gridTemplateKind && (
                  <label>
                    Роль слайда
                    <select
                      value={slide.kind ?? 'normal'}
                      onChange={(e) =>
                        modify((s) =>
                          applyKind(
                            deck.master,
                            s,
                            e.target.value as NonNullable<Slide['kind']>
                          )
                        )
                      }
                    >
                      <option value="normal">Обычный</option>
                      <option value="title">Титульный</option>
                      <option value="end">Завершающий</option>
                    </select>
                  </label>
                )}
                {!slide.structure &&
                  deck.master.name === 'По умолчанию' &&
                  (slide.kind ?? 'normal') === 'normal' && (
                    <label>
                      Компоновка
                      <select
                        aria-label="Применить компоновку"
                        value=""
                        onChange={async (e) => {
                          const t = templates.find(
                            (t) => t.deck.id === e.target.value
                          )
                          if (!t) return
                          if (
                            slide.items.some((o) => o.role !== 'decoration') &&
                            !(await askConfirm(
                              'Перенести прежнее содержимое в неразмещённые объекты и применить компоновку?',
                              {
                                title: 'Изменение компоновки',
                                label: 'Продолжить',
                                variant: 'warning',
                              }
                            ))
                          )
                            return
                          try {
                            const template = resolveTemplate
                              ? await resolveTemplate(t)
                              : t
                            change((latest) => {
                              if (latest !== deck) {
                                notice(
                                  'Методичка изменилась. Примените компоновку ещё раз.'
                                )
                                return latest
                              }
                              return applyLayout(latest, slide.id, template)
                            })
                          } catch (err) {
                            notice((err as Error).message)
                          }
                        }}
                      >
                        <option value="">Выберите компоновку</option>
                        {templates
                          .filter((t) => t.kind === 'layout' && !t.format)
                          .map((t) => (
                            <option key={t.deck.id} value={t.deck.id}>
                              {t.deck.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                {(deck.migrated ||
                  (saveTemplate &&
                    !deck.slides.some((s) => s.structure) &&
                    deck.master.name === 'По умолчанию')) && (
                  <details>
                    <summary>Область прежней компоновки</summary>
                    {(['x', 'y', 'w', 'h'] as const).map((k) => (
                      <Num
                        key={k}
                        label={k}
                        value={
                          (slide.area ?? { x: 0, y: 0, w: 1280, h: 720 })[k]
                        }
                        min={k === 'x' || k === 'y' ? 0 : 1}
                        max={k === 'x' || k === 'w' ? 1280 : 720}
                        change={(v) =>
                          modify((s) => ({
                            ...s,
                            area: {
                              x: 0,
                              y: 0,
                              w: 1280,
                              h: 720,
                              ...s.area,
                              [k]: v,
                            },
                          }))
                        }
                      />
                    ))}
                  </details>
                )}
              </PropertySection>
              {gridTemplateKind !== 'layout' && (
                <PropertySection id="slide-background" title="Фон" initial>
                  <Background
                    libraryAvailable={libraryAvailable}
                    deck={deck}
                    key={slide.id}
                    slide={slide}
                    notice={notice}
                    update={(next) =>
                      modify(() => ({ ...next, ownBackground: true }))
                    }
                    reset={() =>
                      modify((s) =>
                        inheritedBackground(
                          s,
                          deck.master.art?.[s.kind ?? 'normal']
                        )
                      )
                    }
                  />
                  {!saveTemplate && (
                    <button
                      onClick={() =>
                        change((d) => {
                          const kind = slide.kind ?? 'normal',
                            base = d.master.art?.[kind] ?? {
                              ...newSlide(),
                              kind,
                            }
                          const sample = inheritedBackground(base, slide)
                          return {
                            ...d,
                            master: {
                              ...d.master,
                              art: { ...d.master.art, [kind]: sample },
                            },
                            slides: d.slides.map((s) =>
                              (s.kind ?? 'normal') === kind &&
                              (s.id === slide.id || !s.ownBackground)
                                ? inheritedBackground(s, sample)
                                : s
                            ),
                          }
                        })
                      }
                    >
                      Применить фон к схеме этой методички
                    </button>
                  )}
                </PropertySection>
              )}
              {saveTemplate && realCellSlot && (
                <>
                  <label>
                    Редактируемая ячейка
                    <select
                      value={realCellSlot.id}
                      onChange={(e) => setSelectedSlot(e.target.value)}
                    >
                      {locations
                        .filter(
                          (v) => v.id.startsWith('m/') || v.id.startsWith('s/')
                        )
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.id.startsWith('m/') ? 'Схема' : 'Компоновка'} ·{' '}
                            {v.cell.row + 1} × {v.cell.col + 1} · {v.cell.type}
                          </option>
                        ))}
                    </select>
                  </label>
                  <CellAppearance
                    cell={realCellSlot.cell}
                    change={updateCell}
                  />
                </>
              )}
            </section>
            <section className="inspector-level" aria-label="Выбранный объект">
              <h3>Выбранный объект</h3>
              {!item && activeSlot && isTextType(activeSlot.cell.type) && (
                <PropertySection
                  id="slot-source"
                  title="Содержание ячейки"
                  initial
                >
                  <p>
                    {sourceText(activeSlot.cell) || 'Пустое исходное значение'}
                  </p>
                  <button onClick={() => editSource(activeSlot.id)}>
                    Редактировать на холсте
                  </button>
                </PropertySection>
              )}
              {item && !editable(item) ? (
                <small>
                  {item.locked
                    ? 'Слой заблокирован'
                    : 'Слой закреплён в шаблоне'}
                </small>
              ) : item ? (
                <>
                  {item.type === 'image' && (
                    <PropertySection
                      id="image-crop"
                      title="Кадрирование изображения"
                      initial
                    >
                      <label>
                        Заполнение ячейки
                        <select
                          value={item.imageFit ?? 'contain'}
                          onChange={(e) =>
                            patch(item.id, {
                              imageFit: e.target.value as Item['imageFit'],
                            })
                          }
                        >
                          <option value="contain">Вписать целиком</option>
                          <option value="cover">Заполнить с обрезкой</option>
                        </select>
                      </label>
                      {item.imageFit === 'cover' &&
                        (['focusX', 'focusY'] as const).map((k, i) => (
                          <label key={k}>
                            {i ? 'Фокус по вертикали' : 'Фокус по горизонтали'}
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={item[k] ?? 50}
                              onChange={(e) =>
                                patch(item.id, { [k]: +e.target.value })
                              }
                            />
                          </label>
                        ))}
                    </PropertySection>
                  )}
                  {item.type === 'shape' && (
                    <ShapePanel item={item} patch={(v) => patch(item.id, v)} />
                  )}
                  {item.type !== 'image' && (
                    <TextPanel
                      key={item.id}
                      deck={deck}
                      item={item}
                      cell={itemCell}
                      editOnCanvas={
                        target(item) === 'tray' || item.hidden
                          ? undefined
                          : () => editText(item.id)
                      }
                      reset={
                        isTextType(itemCell?.type)
                          ? () => {
                              setSelectedSlot(target(item))
                              removeItem()
                              select('')
                            }
                          : undefined
                      }
                      patch={(v) => patch(item.id, v)}
                    />
                  )}
                  {(saveTemplate ||
                    slots(deck.master, slide).find((v) => v.id === target(item))
                      ?.cell.type === 'free') && (
                    <GeometryPanel
                      item={item}
                      canPin={freeDecoration}
                      patch={(v) => {
                        if (freeDecoration && v.fixed === true) {
                          patch(item.id, {
                            ...freezeDecoration(item, locations),
                            role: item.role,
                          })
                        } else if (item.fixed && v.fixed === false) {
                          const free = slots(deck.master, slide).find(
                            (p) => p.cell.type === 'free'
                          )
                          patch(item.id, {
                            fixed: undefined,
                            slot: free?.id ?? 'tray',
                            ...(free
                              ? {
                                  x: (item.x - free.box.x) / free.scale,
                                  y: (item.y - free.box.y) / free.scale,
                                  w: item.w / free.scale,
                                  h: item.h / free.scale,
                                  contentScale:
                                    (item.contentScale ?? 1) / free.scale,
                                }
                              : {}),
                          })
                        } else patch(item.id, v)
                      }}
                    />
                  )}
                  <PropertySection
                    id="object-order"
                    title="Порядок и удаление объекта"
                    initial
                  >
                    <div className="field-pair">
                      {[-1, 1].map((delta) => (
                        <button
                          key={delta}
                          disabled={
                            !slide.items[slide.items.indexOf(item) + delta]
                          }
                          onClick={() =>
                            modify((s) => {
                              const items = s.items.slice(),
                                i = items.findIndex((o) => o.id === sel)
                              ;[items[i], items[i + delta]] = [
                                items[i + delta],
                                items[i],
                              ]
                              return { ...s, items }
                            })
                          }
                        >
                          {delta < 0 ? 'Слой ниже' : 'Слой выше'}
                        </button>
                      ))}
                    </div>
                    <button onClick={removeItem}>
                      <Trash2 />
                      Удалить объект
                    </button>
                  </PropertySection>
                </>
              ) : (
                <p className="inspector-empty">
                  Выберите объект для настройки его свойств.
                </p>
              )}
            </section>
            {!gridTemplateKind && (
              <PropertySection id="slide-order" title="Порядок слайдов" initial>
                <button disabled={!idx} onClick={() => reorder(-1)}>
                  <ChevronUp />
                  Переместить выше
                </button>
                <button
                  disabled={idx === deck.slides.length - 1}
                  onClick={() => reorder(1)}
                >
                  <ChevronDown />
                  Переместить ниже
                </button>
                <button onClick={delSlide}>
                  <Trash2 />
                  Удалить слайд
                </button>
              </PropertySection>
            )}
          </>
        }
      >
        <CanvasViewport
          editable
          bleed={freeDecoration}
          onContextMenu={(e) => {
            const id = (e.target as Element)
              .closest('[data-item]')
              ?.getAttribute('data-item')
            select(id ?? '')
            context.open(e, commands(slide.items.find((o) => o.id === id)))
          }}
        >
          <Stage
            deck={deck}
            slide={draft ? { ...slide, items: [...slide.items, draft] } : slide}
            design={!!saveTemplate}
            bleed={freeDecoration}
            selected={sel}
            onSlot={(id) => {
              chosenSlot.current = id
              setSelectedSlot(id)
              select('')
              if (locations.find((v) => v.id === id)?.cell.type === 'image')
                pickImage()
            }}
            onSlotEdit={editSource}
            textEdit={textEdit ?? undefined}
            finishTextEdit={() =>
              setEdit((current) => (current === textEdit ? null : current))
            }
            onSystemStyle={saveTemplate ? undefined : updateSystemStyle}
            undo={(redo) =>
              history.actions
                .find((a) => a.key === (redo ? 'shift+z' : 'z'))
                ?.run()
            }
            onText={patch}
            onNodes={(id, nodes) => patch(id, { nodes })}
            onEditText={editText}
            onSelect={(id) => {
              if (!saveTemplate) setSelectedSlot('')
              chosenSlot.current = ''
              select(id)
            }}
            onMove={(id, x, y) =>
              modify((s) => {
                const a = s.items.find((o) => o.id === id)!
                return {
                  ...s,
                  items: s.items.map((o) =>
                    o.id === id
                      ? { ...o, x, y }
                      : a.group &&
                          a.group === o.group &&
                          editable(o) &&
                          (a.fixed
                            ? o.fixed
                            : !o.fixed && target(a) === target(o))
                        ? {
                            ...o,
                            x:
                              freeDecoration && o.fixed
                                ? Math.max(-8192, Math.min(8192, o.x + x - a.x))
                                : o.x + x - a.x,
                            y:
                              freeDecoration && o.fixed
                                ? Math.max(-8192, Math.min(8192, o.y + y - a.y))
                                : o.y + y - a.y,
                          }
                        : o
                  ),
                }
              })
            }
            onResize={(id, w, h, x, y) => patch(id, { w, h, x, y })}
          />
        </CanvasViewport>
      </Workspace>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void insert(f)
        }}
      />
    </>
  )
}

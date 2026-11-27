import { FORMAT_VERSION } from './schema'
import { PropertySection } from './Workspace'
import { useState } from 'react'
import {
  slots,
  cellTypes,
  target,
  acceptsItem,
  linkCaptions,
  setStructure,
  switchMaster,
  bind,
} from './grid'
import { validateDeck, type Deck, type Slide, type Item } from './model'
import type { Template } from './catalog'

export function PlacementPanel({
  deck,
  slide,
  templates,
  resolveTemplate,
  update,
  select,
  selected,
  notice,
  saveAs,
  design = false,
}: {
  deck: Deck
  slide: Slide
  templates: Template[]
  resolveTemplate?: (t: Template) => Promise<Template>
  update: (d: Deck) => void
  select: (id: string) => void
  selected: string
  notice: (s: string) => void
  saveAs?: () => void
  design?: boolean
}) {
  const [marked, mark] = useState<string[]>([])
  const all = slots(deck.master, slide),
    tray = slide.items.filter((o) => target(o) === 'tray'),
    item = slide.items.find((o) => o.id === selected)
  const eligible = slide.items.filter((o) => !o.locked && (design || !o.fixed))
  const name = (o: Item) =>
    o.text.slice(0, 28) ||
    { shape: 'Фигура', image: 'Изображение', text: 'Текст' }[o.type]
  function replace(s: Slide) {
    s = linkCaptions(deck.master, s)
    update({
      ...deck,
      slides: deck.slides.map((v) => (v.id === s.id ? s : v)),
    })
  }
  function assign(o: Item, id: string) {
    replace({
      ...slide,
      items: slide.items.map((v) =>
        v.id === o.id ||
        (o.group &&
          o.group === v.group &&
          target(v) === target(o) &&
          (id === 'tray' || all.find((p) => p.id === id)?.cell.type === 'free'))
          ? bind(v, id)
          : v
      ),
    })
    select(o.id)
  }
  return (
    <>
      {!design && (
        <PropertySection id="slide-templates" title="Шаблоны слайда" initial>
          <small>Главный шаблон · {deck.master.name}</small>
          <label>
            Сменить главный шаблон
            <select
              value=""
              onChange={async (e) => {
                const t = templates.find((t) => t.deck.id === e.target.value)
                if (!t) return
                if (
                  !confirm(
                    deck.migrated
                      ? 'Исходная композиция каждого слайда перейдёт в неразмещённое содержимое. В библиотеке сохранится копия прежней методички. Продолжить?'
                      : 'Применить главный шаблон ко всей методичке?'
                  )
                )
                  return
                try {
                  const template = resolveTemplate ? await resolveTemplate(t) : t
                  const next = switchMaster(deck, template.deck)
                  update(validateDeck(next))
                  const n = next.slides.reduce(
                    (a, s) =>
                      a + s.items.filter((o) => target(o) === 'tray').length,
                    0
                  )
                  notice(
                    n ? 'Неразмещённых объектов: ' + n : 'Шаблон применён.'
                  )
                  select('')
                } catch (err) {
                  notice((err as Error).message)
                }
              }}
            >
              <option value="">Выберите шаблон</option>
              {templates
                .filter(
                  (t) =>
                    t.kind === 'presentation' && t.format === FORMAT_VERSION
                )
                .map((t) => (
                  <option key={t.deck.id} value={t.deck.id}>
                    {t.deck.title}
                  </option>
                ))}
            </select>
          </label>
          {all.some((v) => v.cell.type === 'area') && (
            <label>
              Режим области слайда
              <select
                aria-label="Режим области слайда"
                value={slide.structure ? 'structured' : 'free'}
                onChange={async (e) => {
                  if (e.target.value === 'structured') return
                  const t = templates.find((t) => t.deck.id === e.target.value)
                  if (
                    t &&
                    slide.items.some(
                      (o) =>
                        !o.fixed &&
                        !target(o).startsWith('m/') &&
                        target(o) !== 'tray'
                    ) &&
                    !confirm(
                      'Текущее размещение будет сброшено. Перенести объекты области в неразмещённое содержимое этого слайда?'
                    )
                  )
                    return
                  try {
                    const template = t && resolveTemplate ? await resolveTemplate(t) : t
                    update(validateDeck(setStructure(deck, slide, template?.deck)))
                    select('')
                  } catch (err) {
                    notice((err as Error).message)
                  }
                }}
              >
                <option value="free">Свободное размещение</option>
                {slide.structure && (
                  <option value="structured">Текущая структура</option>
                )}
                {templates
                  .filter(
                    (t) => t.kind === 'layout' && t.format === FORMAT_VERSION
                  )
                  .map((t) => (
                    <option key={t.deck.id} value={t.deck.id}>
                      {t.deck.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {saveAs && <button onClick={saveAs}>Сохранить как шаблон</button>}
        </PropertySection>
      )}
      {item && !item.fixed && (
        <PropertySection id="placement" title="Размещение" initial>
          <label>
            Размещение объекта
            <select
              aria-label="Размещение объекта"
              value={target(item)}
              onChange={(e) => assign(item, e.target.value)}
            >
              <option value="tray">Неразмещённое содержимое</option>
              {all
                .filter(
                  (v) =>
                    acceptsItem(v.cell, item) &&
                    (v.cell.type === 'free' ||
                      !slide.items.some(
                        (o) => o.id !== item.id && target(o) === v.id
                      ))
                )
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {cellTypes[v.cell.type]} · {v.cell.row + 1},{v.cell.col + 1}
                  </option>
                ))}
            </select>
          </label>
        </PropertySection>
      )}
      {!!eligible.length && (
        <PropertySection id="groups" title="Группы и связи">
          {eligible.map((o) => (
            <label className="toggle" key={o.id}>
              <input
                type="checkbox"
                checked={marked.includes(o.id)}
                onChange={(e) =>
                  mark(
                    e.target.checked
                      ? [...marked, o.id]
                      : marked.filter((id) => id !== o.id)
                  )
                }
              />
              {name(o)}
            </label>
          ))}
          {(['group', 'relation'] as const).map((key, i) => (
            <button
              key={key}
              disabled={marked.length < 2}
              onClick={() => {
                const members = eligible.filter((o) => marked.includes(o.id))
                const fixedGroup = design && members.every((o) => o.fixed)
                const freeGroup =
                  members.every(
                    (o) => !o.fixed && target(o) === target(members[0])
                  ) &&
                  all.find((v) => v.id === target(members[0]))?.cell.type ===
                    'free'
                if (
                  members.length < 2 ||
                  (key === 'group' && !fixedGroup && !freeGroup)
                ) {
                  notice(
                    'Выберите объекты одного свободного блока или закреплённые слои.'
                  )
                  return
                }
                const id = 'g' + crypto.randomUUID()
                replace({
                  ...slide,
                  items: slide.items.map((o) =>
                    members.includes(o) ? { ...o, [key]: id } : o
                  ),
                })
                mark([])
              }}
            >
              {i ? 'Связать по смыслу' : 'Сгруппировать'}
            </button>
          ))}
          {item?.group && (
            <button
              onClick={() =>
                replace({
                  ...slide,
                  items: slide.items.map((o) => {
                    if (o.group !== item.group) return o
                    const copy = { ...o }
                    delete copy.group
                    return copy
                  }),
                })
              }
            >
              Разгруппировать
            </button>
          )}
        </PropertySection>
      )}
    </>
  )
}

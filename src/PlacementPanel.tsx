import { useState } from "react";
import {
  slots,
  cellTypes,
  target,
  accepts,
  linkCaptions,
  setStructure,
  switchMaster,
  bind,
} from "./grid";
import { validateDeck, type Deck, type Slide, type Item } from "./model";
import type { Template } from "./catalog";

export function PlacementPanel({
  deck,
  slide,
  templates,
  update,
  select,
  selected,
  notice,
  saveAs,
}: {
  deck: Deck;
  slide: Slide;
  templates: Template[];
  update: (d: Deck) => void;
  select: (id: string) => void;
  selected: string;
  notice: (s: string) => void;
  saveAs?: () => void;
}) {
  const [marked, mark] = useState<string[]>([]);
  const all = slots(deck.master, slide),
    tray = slide.items.filter((o) => target(o) === "tray"),
    item = slide.items.find((o) => o.id === selected);
  const name = (o: Item) =>
    o.text.slice(0, 28) ||
    { shape: "Фигура", image: "Изображение", text: "Текст" }[o.type];
  function replace(s: Slide) {
    s = linkCaptions(deck.master, s);
    update({
      ...deck,
      slides: deck.slides.map((v) => (v.id === s.id ? s : v)),
    });
  }
  function assign(o: Item, id: string) {
    replace({
      ...slide,
      items: slide.items.map((v) =>
        v.id === o.id ||
        (o.group &&
          o.group === v.group &&
          target(v) === target(o) &&
          (id === "tray" || all.find((p) => p.id === id)?.cell.type === "free"))
          ? bind(v, id)
          : v,
      ),
    });
    select(o.id);
  }
  return (
    <>
      <details open>
        <summary>Шаблоны слайда</summary>
        <small>Главный шаблон · {deck.master.name}</small>
        <label>
          Сменить главный шаблон
          <select
            value=""
            onChange={(e) => {
              const t = templates.find((t) => t.deck.id === e.target.value);
              if (!t) return;
              if (
                !confirm(
                  deck.migrated
                    ? "Исходная композиция каждого слайда перейдёт в неразмещённое содержимое. В библиотеке сохранится копия прежней методички. Продолжить?"
                    : "Применить главный шаблон ко всей методичке?",
                )
              )
                return;
              try {
                const next = switchMaster(deck, t.deck);
                update(validateDeck(next));
                const n = next.slides.reduce(
                  (a, s) =>
                    a + s.items.filter((o) => target(o) === "tray").length,
                  0,
                );
                notice(n ? "Неразмещённых объектов: " + n : "Шаблон применён.");
                select("");
              } catch (err) {
                notice((err as Error).message);
              }
            }}
          >
            <option value="">Выберите шаблон</option>
            {templates
              .filter((t) => t.kind === "presentation" && t.format === 3)
              .map((t) => (
                <option key={t.deck.id} value={t.deck.id}>
                  {t.deck.title}
                </option>
              ))}
          </select>
        </label>
        {all.some((v) => v.cell.type === "area") && (
          <label>
            Режим области слайда
            <select
              aria-label="Режим области слайда"
              value={slide.structure ? "structured" : "free"}
              onChange={(e) => {
                if (e.target.value === "structured") return;
                const t = templates.find((t) => t.deck.id === e.target.value);
                if (
                  t &&
                  slide.items.some(
                    (o) =>
                      !o.fixed &&
                      !target(o).startsWith("m/") &&
                      target(o) !== "tray",
                  ) &&
                  !confirm(
                    "Текущее размещение будет сброшено. Перенести объекты области в неразмещённое содержимое этого слайда?",
                  )
                )
                  return;
                try {
                  update(validateDeck(setStructure(deck, slide, t?.deck)));
                  select("");
                } catch (err) {
                  notice((err as Error).message);
                }
              }}
            >
              <option value="free">Свободное размещение</option>
              {slide.structure && (
                <option value="structured">Текущая структура</option>
              )}
              {templates
                .filter((t) => t.kind === "layout" && t.format === 3)
                .map((t) => (
                  <option key={t.deck.id} value={t.deck.id}>
                    {t.deck.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        {saveAs && <button onClick={saveAs}>Сохранить как шаблон</button>}
      </details>
      {all
        .filter((v) => v.cell.type === "header" || v.cell.type === "footer")
        .map((v) => {
          const k = v.cell.type as "header" | "footer";
          return (
            <details key={v.id}>
              <summary>{cellTypes[k]}</summary>
              <label>
                Для всей методички
                <input
                  value={deck[k] ?? v.cell.value ?? ""}
                  onChange={(e) => update({ ...deck, [k]: e.target.value })}
                />
              </label>
              <label>
                Для этого слайда
                <input
                  value={slide[k] ?? deck[k] ?? v.cell.value ?? ""}
                  onChange={(e) => replace({ ...slide, [k]: e.target.value })}
                />
              </label>
              <button
                onClick={() => {
                  const next = { ...slide };
                  delete next[k];
                  replace(next);
                }}
              >
                Вернуть общее значение
              </button>
            </details>
          );
        })}
      {item && !item.fixed && (
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
                  accepts(v.cell.type, item) &&
                  (v.cell.type === "free" ||
                    !slide.items.some(
                      (o) => o.id !== item.id && target(o) === v.id,
                    )),
              )
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {cellTypes[v.cell.type]} · {v.cell.row + 1},{v.cell.col + 1}
                </option>
              ))}
          </select>
        </label>
      )}
      <details>
        <summary>Группы и связи</summary>
        {slide.items
          .filter((o) => !o.fixed)
          .map((o) => (
            <label className="toggle" key={o.id}>
              <input
                type="checkbox"
                checked={marked.includes(o.id)}
                onChange={(e) =>
                  mark(
                    e.target.checked
                      ? [...marked, o.id]
                      : marked.filter((id) => id !== o.id),
                  )
                }
              />
              {name(o)}
            </label>
          ))}
        {(["group", "relation"] as const).map((key, i) => (
          <button
            key={key}
            disabled={marked.length < 2}
            onClick={() => {
              const members = slide.items.filter((o) => marked.includes(o.id));
              if (
                members.length < 2 ||
                (key === "group" &&
                  (new Set(members.map(target)).size !== 1 ||
                    all.find((v) => v.id === target(members[0]))?.cell.type !==
                      "free"))
              ) {
                notice("Для группы выберите объекты одного свободного блока.");
                return;
              }
              const id = "g" + crypto.randomUUID();
              replace({
                ...slide,
                items: slide.items.map((o) =>
                  marked.includes(o.id) ? { ...o, [key]: id } : o,
                ),
              });
              mark([]);
            }}
          >
            {i ? "Связать по смыслу" : "Сгруппировать"}
          </button>
        ))}
        {item?.group && (
          <button
            onClick={() =>
              replace({
                ...slide,
                items: slide.items.map((o) => {
                  if (o.group !== item.group) return o;
                  const copy = { ...o };
                  delete copy.group;
                  return copy;
                }),
              })
            }
          >
            Разгруппировать
          </button>
        )}
      </details>
    </>
  );
}

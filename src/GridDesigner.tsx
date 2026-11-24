import { useCommands, type HistoryControls, type Action } from "./StudioTools";
import { Background } from "./Background";
import { useRef, useState } from "react";
import { Stage } from "./Stage";
import {
  cell,
  repairSlots,
  defaultMaster,
  cellTypes,
  blankGrid,
  rectangles,
  validateGrid,
  kinds,
  type Cell,
  type Grid,
  type Insets,
  type Kind,
  type CellType,
} from "./grid";
import { builtinFonts } from "./schema";
import type { Template } from "./catalog";

export function editTrack(
  source: Grid,
  axis: "rows" | "cols",
  index: number,
  remove: boolean,
) {
  const g = structuredClone(source),
    pos = axis === "rows" ? "row" : "col";
  if (remove) {
    if (g[axis].length === 1)
      throw Error("Сетка должна иметь хотя бы одну полосу");
    g[axis].splice(index, 1);
    g.cells = g.cells.filter((c) => !(c[pos] === index && c[axis] === 1));
    for (const c of g.cells) {
      if (c[pos] > index) c[pos]--;
      else if (c[pos] + c[axis] > index) c[axis]--;
    }
  } else {
    if (g[axis].length >= 24) throw Error("Максимум 24 полосы");
    g[axis].push(1);
    const last = g[axis].length - 1;
    for (let i = 0; i < g[axis === "rows" ? "cols" : "rows"].length; i++)
      g.cells.push(
        cell(axis === "rows" ? last : i, axis === "cols" ? last : i),
      );
  }
  return g;
}
function Padding({
  label,
  value,
  update,
}: {
  label: string;
  value: Insets;
  update: (v: Insets) => void;
}) {
  return (
    <details>
      <summary>{label}</summary>
      <div className="grid-fields">
        {["Все стороны", "Сверху", "Справа", "Снизу", "Слева"].map((n, i) => (
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
                    : ""
              }
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value));
                update(
                  value.map((x, j) => (!i || j === i - 1 ? v : x)) as Insets,
                );
              }}
            />
          </label>
        ))}
      </div>
    </details>
  );
}
export function GridDesigner({
  template,
  set,
  history,
  save,
  back,
  art,
  notice,
}: {
  template: Template;
  history: HistoryControls;
  set: (t: Template) => void;
  save: () => void;
  back: () => void;
  art: () => void;
  notice: (s: string) => void;
}) {
  const clipboard = useRef<Cell | null>(null);
  const [kind, choose] = useState<Kind>("title"),
    [selected, select] = useState(""),
    [merge, merging] = useState(false);
  const [tab, setTab] = useState("table");
  const canvas = useRef<HTMLDivElement>(null);
  const structural = template.kind === "layout",
    deck = template.deck,
    s = deck.slides[structural ? 0 : kinds.indexOf(kind)],
    g = structural
      ? (s.structure ?? blankGrid("free"))
      : deck.master.schemes[kind];
  const c = g.cells.find((v) => v.id === selected) ?? g.cells[0];
  function change(next: Grid) {
    try {
      validateGrid(next, structural);
      const d = structuredClone(deck);
      if (structural) d.slides[0].structure = next;
      else d.master.schemes[kind] = next;
      // Keep every detached example object accessible after changing the grid.
      const page = d.slides[structural ? 0 : kinds.indexOf(kind)];
      page.items = repairSlots(d.master, page).items;
      set({ ...template, deck: d });
    } catch (e) {
      notice((e as Error).message);
    }
  }
  function patch(v: Partial<Cell>) {
    change({
      ...g,
      cells: g.cells.map((o) => (o.id === c.id ? { ...o, ...v } : o)),
    });
  }
  function pick(v: Cell) {
    if (!merge) {
      select(v.id);
      return;
    }
    merging(false);
    const row = Math.min(c.row, v.row),
      col = Math.min(c.col, v.col),
      endY = Math.max(c.row + c.rows, v.row + v.rows),
      endX = Math.max(c.col + c.cols, v.col + v.cols);
    const inside = g.cells.filter(
      (o) =>
        o.row < endY &&
        o.row + o.rows > row &&
        o.col < endX &&
        o.col + o.cols > col,
    );
    if (
      inside.some(
        (o) =>
          o.row < row ||
          o.col < col ||
          o.row + o.rows > endY ||
          o.col + o.cols > endX,
      )
    ) {
      notice("Выделите прямоугольник из целых ячеек.");
      return;
    }
    change({
      ...g,
      cells: [
        ...g.cells.filter((o) => !inside.includes(o)),
        { ...c, row, col, rows: endY - row, cols: endX - col },
      ],
    });
  }
  function commands(o: Cell): Action[] {
    const base = () => ({
      id: o.id,
      row: o.row,
      col: o.col,
      rows: o.rows,
      cols: o.cols,
    });
    function copy() {
      clipboard.current = structuredClone(o);
    }
    function replace(next: Cell) {
      change({ ...g, cells: g.cells.map((v) => (v.id === o.id ? next : v)) });
    }
    return [
      {
        name: "Свойства ячейки",
        run: () => {
          select(o.id);
          setTab("table");
        },
      },
      { name: "Копировать настройки", key: "c", run: copy },
      {
        name: "Вырезать настройки",
        key: "x",
        run: () => {
          copy();
          replace({ ...base(), type: "empty", padding: [0, 0, 0, 0] });
        },
      },
      {
        name: "Вставить настройки",
        key: "v",
        run: () => {
          if (clipboard.current)
            replace({ ...structuredClone(clipboard.current), ...base() });
        },
      },
    ];
  }
  const context = useCommands([...history.actions, ...commands(c)]);
  const drag = useRef<{
    axis: "rows" | "cols";
    index: number;
    start: number;
    base: Grid;
  } | null>(null);
  return (
    <main className="grid-designer">
      {context.menu}
      <header className="edit-head">
        {history.buttons}
        <button onClick={back}>В библиотеку</button>
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
        <button className="primary" onClick={save}>
          Сохранить шаблон
        </button>
      </header>
      <div className="grid-work">
        <section>
          <h1>
            {structural
              ? "Структурный шаблон слайда"
              : "Главный шаблон презентации"}
          </h1>
          {!structural && (
            <div className="catalog-tabs">
              {kinds.map((v, i) => (
                <button
                  className={v === kind ? "active" : ""}
                  key={v}
                  onClick={() => {
                    choose(v);
                    select("");
                    merging(false);
                  }}
                >
                  {["Титульный", "Обычный", "Завершающий"][i]}
                </button>
              ))}
            </div>
          )}
          <div ref={canvas} className="grid-board">
            <Stage
              deck={structural ? { ...deck, master: defaultMaster() } : deck}
              slide={s}
            />
            {rectangles(g).map(({ cell: o, outer: b }) => (
              <button
                key={o.id}
                aria-label={"Ячейка " + (o.row + 1) + ", " + (o.col + 1)}
                className={"grid-cell " + (o.id === c.id ? "selected" : "")}
                style={{
                  left: b.x / 12.8 + "%",
                  top: b.y / 7.2 + "%",
                  width: b.w / 12.8 + "%",
                  height: b.h / 7.2 + "%",
                }}
                onContextMenu={(e) => {
                  select(o.id);
                  context.open(e, commands(o));
                }}
                onClick={() => pick(o)}
              >
                <span>{cellTypes[o.type]}</span>
              </button>
            ))}
            {(["rows", "cols"] as const).flatMap((axis) =>
              g[axis].slice(0, -1).map((_, i) => {
                const row = axis === "rows",
                  dim = row ? 720 : 1280,
                  pad = row ? g.padding[0] : g.padding[3],
                  space = dim - pad - (row ? g.padding[2] : g.padding[1]),
                  sum = g[axis].reduce((a, b) => a + b);
                const at =
                  ((pad +
                    (space * g[axis].slice(0, i + 1).reduce((a, b) => a + b)) /
                      sum) /
                    dim) *
                    100 +
                  "%";
                const segments = rectangles(g).filter(
                  ({ cell: c }) => (row ? c.row : c.col) + c[axis] === i + 1,
                );
                return segments.map(({ cell: c, outer: b }) => (
                  <div
                    key={axis + i + c.id}
                    role="separator"
                    aria-label={(row ? "Строка " : "Столбец ") + (i + 1)}
                    className={"grid-divider " + axis}
                    style={
                      row
                        ? {
                            top: at,
                            left: b.x / 12.8 + "%",
                            width: b.w / 12.8 + "%",
                          }
                        : {
                            left: at,
                            top: b.y / 7.2 + "%",
                            height: b.h / 7.2 + "%",
                          }
                    }
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = {
                        axis,
                        index: i,
                        start: row ? e.clientY : e.clientX,
                        base: g,
                      };
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current;
                      if (!d || d.axis !== axis || d.index !== i) return;
                      const rect = canvas.current!.getBoundingClientRect(),
                        next = structuredClone(d.base),
                        tracks = next[axis],
                        pair = tracks[i] + tracks[i + 1],
                        sum = tracks.reduce((a, b) => a + b);
                      tracks[i] = Math.max(
                        0.02,
                        Math.min(
                          pair - 0.02,
                          tracks[i] +
                            (((((row ? e.clientY : e.clientX) - d.start) /
                              (row ? rect.height : rect.width)) *
                              dim) /
                              space) *
                              sum,
                        ),
                      );
                      tracks[i + 1] = pair - tracks[i];
                      change(next);
                    }}
                    onPointerUp={() => (drag.current = null)}
                    onLostPointerCapture={() => (drag.current = null)}
                  />
                ));
              }),
            )}
          </div>
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
          <button onClick={art}>Редактировать объекты и шрифты</button>
        </section>
        <aside className="inspector">
          {!structural && (
            <nav>
              <button
                aria-pressed={tab === "table"}
                onClick={() => setTab("table")}
              >
                Таблица
              </button>
              <button aria-pressed={tab === "bg"} onClick={() => setTab("bg")}>
                Фон
              </button>
            </nav>
          )}
          {tab === "bg" && !structural ? (
            <Background
              deck={deck}
              key={s.id}
              slide={s}
              notice={notice}
              update={(next) =>
                set({
                  ...template,
                  deck: {
                    ...deck,
                    slides: deck.slides.map((v) => (v.id === s.id ? next : v)),
                  },
                })
              }
            />
          ) : (
            <>
              <h2>Сетка</h2>
              {(["rows", "cols"] as const).map((axis) => (
                <div key={axis} className="field-pair">
                  <button
                    onClick={() => change(editTrack(g, axis, 0, false))}
                    disabled={g[axis].length >= 24}
                  >
                    Добавить {axis === "rows" ? "строку" : "столбец"}
                  </button>
                  <button
                    disabled={g[axis].length === 1}
                    onClick={() =>
                      change(
                        editTrack(
                          g,
                          axis,
                          axis === "rows" ? c.row : c.col,
                          true,
                        ),
                      )
                    }
                  >
                    Удалить {axis === "rows" ? "строку" : "столбец"}
                  </button>
                  <label>
                    Вес {axis === "rows" ? "строки" : "столбца"}
                    <input
                      type="number"
                      min=".01"
                      step=".1"
                      value={g[axis][axis === "rows" ? c.row : c.col]}
                      onChange={(e) =>
                        change({
                          ...g,
                          [axis]: g[axis].map((x, i) =>
                            i === (axis === "rows" ? c.row : c.col)
                              ? Math.min(8192, Math.max(0.01, +e.target.value))
                              : x,
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
              <h2>
                Ячейка {c.row + 1} × {c.col + 1}
              </h2>
              <button onClick={() => merging(!merge)}>
                {merge ? "Выберите последнюю ячейку" : "Объединить ячейки"}
              </button>
              {(c.rows > 1 || c.cols > 1) && (
                <button
                  onClick={() => {
                    const cells = g.cells.filter((o) => o !== c);
                    for (let y = 0; y < c.rows; y++)
                      for (let x = 0; x < c.cols; x++)
                        cells.push(
                          x || y
                            ? cell(c.row + y, c.col + x)
                            : { ...c, rows: 1, cols: 1 },
                        );
                    change({ ...g, cells });
                  }}
                >
                  Разделить ячейку
                </button>
              )}
              <label>
                Тип ячейки
                <select
                  value={c.type}
                  onChange={(e) => patch({ type: e.target.value as CellType })}
                >
                  {Object.entries(cellTypes)
                    .filter(
                      ([k]) =>
                        !structural ||
                        !["area", "header", "footer"].includes(k),
                    )
                    .map(([k, n]) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                </select>
              </label>
              {!["area", "empty", "image", "free"].includes(c.type) && (
                <>
                  <label>
                    Исходный текст
                    <textarea
                      value={c.value ?? ""}
                      onChange={(e) => patch({ value: e.target.value })}
                    />
                  </label>
                  <label>
                    Размер текста
                    <input
                      type="number"
                      value={c.style?.size ?? 32}
                      min={1}
                      max={1024}
                      onChange={(e) =>
                        patch({
                          style: {
                            ...c.style,
                            size: Math.min(1024, Math.max(1, +e.target.value)),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Гарнитура
                    <select
                      value={c.style?.font ?? "sans"}
                      onChange={(e) =>
                        patch({ style: { ...c.style, font: e.target.value } })
                      }
                    >
                      {[
                        ...Object.entries(builtinFonts),
                        ...deck.resources.fonts.map((f) => [f.id, f.label]),
                      ].map(([k, n]) => (
                        <option key={k} value={k}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Выравнивание
                    <select
                      value={c.style?.align ?? "left"}
                      onChange={(e) =>
                        patch({
                          style: {
                            ...c.style,
                            align: e.target.value as
                              | "left"
                              | "center"
                              | "right",
                          },
                        })
                      }
                    >
                      <option value="left">По левому краю</option>
                      <option value="center">По центру</option>
                      <option value="right">По правому краю</option>
                    </select>
                  </label>
                  <label>
                    Начертание
                    <select
                      value={c.style?.bold ? "bold" : "regular"}
                      onChange={(e) =>
                        patch({
                          style: {
                            ...c.style,
                            bold: e.target.value === "bold",
                          },
                        })
                      }
                    >
                      <option value="regular">Обычное</option>
                      <option value="bold">Полужирное</option>
                    </select>
                  </label>
                  <label>
                    Цвет текста
                    <input
                      type="color"
                      value={c.style?.color ?? "#183e45"}
                      onChange={(e) =>
                        patch({ style: { ...c.style, color: e.target.value } })
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Фон ячейки
                <input
                  type="color"
                  value={c.fill ?? "#ffffff"}
                  onChange={(e) => patch({ fill: e.target.value })}
                />
              </label>
              <label>
                Цвет рамки
                <input
                  type="color"
                  value={c.border ?? "#663399"}
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
                    patch({ width: Math.min(64, Math.max(0, +e.target.value)) })
                  }
                />
              </label>
              <Padding
                label="Отступы ячейки"
                value={c.padding}
                update={(padding) => patch({ padding })}
              />
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

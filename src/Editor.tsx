import { shapes } from "./schema";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  ImagePlus,
  Type,
  Play,
  MoreHorizontal,
  Check,
  UploadCloud,
  FileDown,
  WifiOff,
  Palette,
  RotateCcw,
} from "lucide-react";
import type { StyleLibrary } from "./styleLibrary";
import {
  TextPanel,
  ShapePanel,
  GeometryPanel,
  StylesPanel,
  Num,
} from "./Properties";
import { applyLayout, type Template } from "./catalog";
import { importSVG } from "./vectorImport";
import { Stage } from "./Stage";
import {
  newSlide,
  newText,
  newShape,
  validateDeck,
  type Deck,
  type Item,
  type Slide,
} from "./model";
import { optimize } from "./media";
import { cloudImage } from "./publication";
import { client } from "./cloud";

type Props = {
  deck: Deck;
  styleLibrary?: StyleLibrary;
  templates?: Template[];
  saveTemplate?: () => void;
  description?: string;
  describe?: (v: string) => void;
  change: (f: (d: Deck) => Deck) => void;
  back: () => void;
  view: () => void;
  status: string;
  action: (id: "export" | "publish" | "offline") => void;
  notice: (s: string) => void;
};
export function Editor({
  deck,
  styleLibrary,
  templates = [],
  saveTemplate,
  description,
  describe,
  change,
  back,
  view,
  status,
  action,
  notice,
}: Props) {
  const [sid, choose] = useState(deck.slides[0].id),
    [sel, select] = useState(""),
    [menu, setMenu] = useState(false);
  const slide = deck.slides.find((s) => s.id === sid) || deck.slides[0],
    idx = deck.slides.indexOf(slide),
    item = slide.items.find((x) => x.id === sel);
  const input = useRef<HTMLInputElement>(null),
    background = useRef(false);
  function modify(fn: (s: Slide) => Slide) {
    change((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slide.id ? fn(s) : s)),
    }));
  }
  function patch(id: string, fields: Partial<Item>) {
    modify((s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === id
          ? (Object.fromEntries(
              Object.entries({ ...it, ...fields }).filter(
                ([, value]) => value !== undefined,
              ),
            ) as unknown as Item)
          : it,
      ),
    }));
  }
  function removeItem() {
    if (item)
      modify((s) => ({ ...s, items: s.items.filter((it) => it.id !== sel) }));
    select("");
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (item && ["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        removeItem();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function reorder(delta: number) {
    const to = idx + delta;
    if (to < 0 || to >= deck.slides.length) return;
    change((d) => {
      const slides = d.slides.slice();
      [slides[idx], slides[to]] = [slides[to], slides[idx]];
      return { ...d, slides };
    });
  }
  function addSlide() {
    const normal = deck.slides.find((s) => s.kind === "normal");
    const fresh = normal
      ? {
          ...structuredClone(normal),
          id: crypto.randomUUID(),
          notes: "",
          items: normal.items
            .filter((o) => o.role === "decoration")
            .map((o) => ({ ...structuredClone(o), id: crypto.randomUUID() })),
        }
      : newSlide();
    change((d) => ({
      ...d,
      slides: [
        ...d.slides.slice(0, idx + 1),
        fresh,
        ...d.slides.slice(idx + 1),
      ],
    }));
    choose(fresh.id);
    select("");
  }
  function delSlide() {
    if (!confirm("Удалить текущий слайд вместе с объектами и заметками?"))
      return;
    const slides = deck.slides.filter((s) => s.id !== slide.id);
    if (!slides.length) slides.push(newSlide());
    change((d) => ({ ...d, slides }));
    choose(slides[Math.min(idx, slides.length - 1)].id);
    select("");
  }
  function pickImage(bg = false) {
    background.current = bg;
    input.current?.click();
  }
  async function insert(file: File) {
    const bg = background.current;
    try {
      if (!bg && (file.type === "image/svg+xml" || /\.svg$/i.test(file.name))) {
        const items = await importSVG(file);
        const next = { ...slide, items: [...slide.items, ...items] };
        validateDeck({ ...deck, slides: [next] });
        modify((s) => ({ ...s, items: [...s.items, ...items] }));
        select(items[0].id);
        notice("SVG добавлен как редактируемые векторные фигуры.");
        return;
      }
      const { src, width, height } = await optimize(file);
      if (bg) modify((s) => ({ ...s, background: src }));
      else {
        const w = Math.min(700, width, (520 * width) / height),
          h = (w * height) / width;
        const img: Item = {
          ...newText(),
          type: "image",
          src,
          text: "",
          x: (1280 - w) / 2,
          y: (720 - h) / 2,
          w,
          h,
        };
        modify((s) => ({ ...s, items: [...s.items, img] }));
        select(img.id);
      }
      if (client && navigator.onLine)
        cloudImage(src).catch(() =>
          notice(
            "Изображение сохранено локально. При публикации загрузка повторится.",
          ),
        );
    } catch (e) {
      notice((e as Error).message);
    }
  }
  return (
    <div className="editor">
      <header className="edit-head">
        <button className="icon" title="В библиотеку" onClick={back}>
          <ArrowLeft />
        </button>
        <input
          aria-label="Название методички"
          maxLength={200}
          value={deck.title}
          onChange={(e) => change((d) => ({ ...d, title: e.target.value }))}
          onBlur={() => {
            if (!deck.title.trim())
              change((d) => ({ ...d, title: "Без названия" }));
          }}
        />
        <small>
          <Check size={15} />
          {status}
        </small>
        <button className="primary" onClick={view}>
          <Play size={16} />
          Показать
        </button>
        {saveTemplate ? (
          <button className="secondary" onClick={saveTemplate}>
            Сохранить шаблон
          </button>
        ) : (
          <div className="menu-anchor">
            <button
              className="icon"
              aria-label="Действия с методичкой"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal />
            </button>
            {menu && (
              <div className="popover">
                {(
                  [
                    ["export", "Экспортировать JSON", FileDown],
                    ["offline", "Подготовить к офлайн-показу", WifiOff],
                    ["publish", "Опубликовать", UploadCloud],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setMenu(false);
                      action(key);
                    }}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      <div className="edit-grid">
        <aside className="strip">
          <h3>
            Слайды <span>{deck.slides.length}</span>
          </h3>
          {deck.slides.map((s, i) => (
            <button
              key={s.id}
              className={"thumb " + (s.id === slide.id ? "active" : "")}
              onClick={() => {
                choose(s.id);
                select("");
              }}
            >
              <b>{i + 1}</b>
              <Stage deck={deck} slide={s} />
            </button>
          ))}
          <button className="secondary full" onClick={addSlide}>
            <Plus size={16} />
            Слайд
          </button>
        </aside>
        <main className="bench">
          <div className="tools">
            <button
              onClick={() => {
                const text = newText();
                modify((s) => ({ ...s, items: [...s.items, text] }));
                select(text.id);
              }}
            >
              <Type />
              Добавить текст
            </button>
            <button
              onClick={() => {
                const shape = newShape();
                modify((s) => ({ ...s, items: [...s.items, shape] }));
                select(shape.id);
              }}
            >
              <Plus />
              Фигура
            </button>
            <button onClick={() => pickImage()}>
              <ImagePlus />
              Изображение
            </button>
          </div>
          <div className="canvas">
            <Stage
              deck={deck}
              slide={slide}
              selected={sel}
              onText={patch}
              onNodes={(id, nodes) => patch(id, { nodes })}
              onEditText={(id) => {
                select(id);
                requestAnimationFrame(() =>
                  document.getElementById("atlas-edit-text")?.focus(),
                );
              }}
              onSelect={select}
              onMove={(id, x, y) => patch(id, { x, y })}
              onResize={(id, w, h, x, y) => patch(id, { w, h, x, y })}
            />
          </div>
          <label className="notes">
            <strong>Заметки преподавателя</strong>
            <textarea
              value={slide.notes}
              placeholder="Что важно рассказать на этом слайде?"
              onChange={(e) => modify((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </main>
        <aside className="inspector">
          {slide.items.length > 0 && (
            <label>
              Объекты слайда
              <select
                aria-label="Объекты слайда"
                value={sel}
                onChange={(e) => select(e.target.value)}
              >
                <option value="">Слайд целиком</option>
                {slide.items.map((o, i) => (
                  <option key={o.id} value={o.id}>
                    {i + 1}.{" "}
                    {o.text.slice(0, 32) ||
                      (o.type === "image"
                        ? "Изображение"
                        : (shapes[o.shape!] ?? "Текст"))}
                    {o.role === "decoration" ? " · оформление" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3>{item ? "Свойства объекта" : "Свойства слайда"}</h3>
          {item ? (
            <>
              {item.type === "shape" && (
                <ShapePanel item={item} patch={(v) => patch(item.id, v)} />
              )}
              {item.type !== "image" && (
                <TextPanel
                  key={item.id}
                  deck={deck}
                  item={item}
                  patch={(v) => patch(item.id, v)}
                />
              )}
              <GeometryPanel item={item} patch={(v) => patch(item.id, v)} />
              <div className="field-pair">
                {[-1, 1].map((delta) => (
                  <button
                    key={delta}
                    disabled={!slide.items[slide.items.indexOf(item) + delta]}
                    onClick={() =>
                      modify((s) => {
                        const items = s.items.slice(),
                          i = items.findIndex((o) => o.id === sel);
                        [items[i], items[i + delta]] = [
                          items[i + delta],
                          items[i],
                        ];
                        return { ...s, items };
                      })
                    }
                  >
                    {delta < 0 ? "Слой ниже" : "Слой выше"}
                  </button>
                ))}
              </div>
              <button onClick={removeItem}>
                <Trash2 />
                Удалить объект
              </button>
              <button onClick={() => select("")}>
                <Palette />
                Свойства слайда
              </button>
            </>
          ) : (
            <>
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
              <label>
                Роль слайда
                <select
                  value={slide.kind ?? "normal"}
                  onChange={(e) =>
                    modify((s) => ({
                      ...s,
                      kind: e.target.value as Slide["kind"],
                    }))
                  }
                >
                  <option value="normal">Обычный</option>
                  <option value="title">Титульный</option>
                  <option value="end">Завершающий</option>
                </select>
              </label>
              {(slide.kind ?? "normal") === "normal" && (
                <label>
                  Компоновка
                  <select
                    aria-label="Применить компоновку"
                    value=""
                    onChange={(e) => {
                      const t = templates.find(
                        (t) => t.deck.id === e.target.value,
                      );
                      if (!t) return;
                      if (
                        slide.items.some((o) => o.role !== "decoration") &&
                        !confirm(
                          "Заменить содержимое слайда? Оформление и заметки сохранятся.",
                        )
                      )
                        return;
                      try {
                        const next = applyLayout(deck, slide.id, t);
                        change(() => next);
                      } catch (err) {
                        notice((err as Error).message);
                      }
                    }}
                  >
                    <option value="">Выберите компоновку</option>
                    {templates
                      .filter((t) => t.kind === "layout")
                      .map((t) => (
                        <option key={t.deck.id} value={t.deck.id}>
                          {t.deck.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <details>
                <summary>Область содержимого</summary>
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <Num
                    key={k}
                    label={k}
                    value={(slide.area ?? { x: 0, y: 0, w: 1280, h: 720 })[k]}
                    min={k === "x" || k === "y" ? 0 : 1}
                    max={k === "x" || k === "w" ? 1280 : 720}
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
              <label>
                Цвет фона
                <input
                  type="color"
                  value={slide.color}
                  onChange={(e) =>
                    modify((s) => ({ ...s, color: e.target.value }))
                  }
                />
              </label>
              <button onClick={() => pickImage(true)}>
                <ImagePlus />
                Фоновое изображение
              </button>
              {slide.background && (
                <button
                  onClick={() => modify((s) => ({ ...s, background: null }))}
                >
                  Убрать изображение
                </button>
              )}
              <button
                onClick={() =>
                  modify((s) => ({
                    ...s,
                    background: null,
                    color: newSlide().color,
                  }))
                }
              >
                <RotateCcw />
                Сбросить фон
              </button>
            </>
          )}
          <StylesPanel
            library={styleLibrary}
            deck={deck}
            change={change}
            notice={notice}
          />
          <hr />
          <h3>Порядок слайдов</h3>
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
        </aside>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void insert(f);
        }}
      />
    </div>
  );
}

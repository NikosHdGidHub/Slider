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
import { Stage } from "./Stage";
import { newSlide, newText, type Deck, type Item, type Slide } from "./model";
import { optimize } from "./media";
import { cloudImage } from "./publication";
import { client } from "./cloud";

type Props = {
  deck: Deck;
  change: (f: (d: Deck) => Deck) => void;
  back: () => void;
  view: () => void;
  status: string;
  action: (id: "export" | "publish" | "offline") => void;
  notice: (s: string) => void;
};
export function Editor({
  deck,
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
      items: s.items.map((it) => (it.id === id ? { ...it, ...fields } : it)),
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
    const fresh = newSlide();
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
              <Stage slide={s} />
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
            <button onClick={() => pickImage()}>
              <ImagePlus />
              Изображение
            </button>
          </div>
          <div className="canvas">
            <Stage
              slide={slide}
              selected={sel}
              onSelect={select}
              onMove={(id, x, y) => patch(id, { x, y })}
              onResize={(id, w, h) => patch(id, { w, h })}
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
          <h3>{item ? "Свойства объекта" : "Свойства слайда"}</h3>
          {item ? (
            <>
              {item.type === "text" && (
                <>
                  <label>
                    Текст
                    <textarea
                      value={item.text}
                      onChange={(e) => patch(item.id, { text: e.target.value })}
                    />
                  </label>
                  <label>
                    Размер шрифта
                    <input
                      type="number"
                      min="8"
                      max="240"
                      value={item.size}
                      onChange={(e) =>
                        patch(item.id, {
                          size: Math.max(8, Math.min(240, +e.target.value)),
                        })
                      }
                    />
                  </label>
                  <label>
                    Цвет текста
                    <input
                      type="color"
                      value={item.color}
                      onChange={(e) =>
                        patch(item.id, { color: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Выравнивание
                    <select
                      value={item.align}
                      onChange={(e) =>
                        patch(item.id, {
                          align: e.target.value as Item["align"],
                        })
                      }
                    >
                      <option value="left">По левому краю</option>
                      <option value="center">По центру</option>
                      <option value="right">По правому краю</option>
                    </select>
                  </label>
                </>
              )}
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

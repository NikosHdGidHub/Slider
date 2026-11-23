import { useMemo, useState } from "react";
import { Stage } from "./Stage";
import { builtinFonts } from "./schema";
import type { Box, Deck, Item } from "./model";
function bounds(o: Item): Box {
  const a = ((o.rotation ?? 0) * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a)),
    w = o.w * c + o.h * s,
    h = o.h * c + o.w * s;
  return { x: o.x + (o.w - w) / 2, y: o.y + (o.h - h) / 2, w, h };
}
function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}
export function ImportPreview({
  deck,
  accept,
  back,
}: {
  deck: Deck;
  accept: () => void;
  back: () => void;
}) {
  const [index, setIndex] = useState(0),
    s = deck.slides[index];
  const messages = useMemo(() => {
    const out: string[] = [],
      boxes = s.items.map(bounds);
    for (const [i, o] of s.items.entries()) {
      const b = boxes[i],
        name = "Объект " + (i + 1);
      if (
        b.x < -0.01 ||
        b.y < -0.01 ||
        b.x + b.w > 1280.01 ||
        b.y + b.h > 720.01
      )
        out.push(name + " выходит за холст.");
      const fonts = [
        deck.theme.styles.find((style) => style.id === o.style)?.values.font,
        o.overrides?.font,
        ...(o.paragraphs?.flatMap((p) => p.runs.map((r) => r.font)) ?? []),
      ];
      if (
        fonts.some(
          (f) =>
            f &&
            !Object.hasOwn(builtinFonts, f) &&
            !deck.resources.fonts.some((a) => a.id === f),
        )
      )
        out.push(
          name + " использует отсутствующий шрифт. Подстановка — DejaVu Sans.",
        );
      for (let j = 0; j < i; j++) {
        if (out.length >= 24) break;
        if (
          overlaps(b, boxes[j]) &&
          (o.role !== s.items[j].role || o.text || s.items[j].text)
        )
          out.push(
            "Объекты " +
              (j + 1) +
              " и " +
              (i + 1) +
              " пересекаются. Проверьте наложение.",
          );
      }
    }
    return out;
  }, [s, deck]);
  return (
    <>
      <h2>{deck.title}</h2>
      <Stage deck={deck} slide={s} diagnostics />
      <div className="preview-nav">
        <button disabled={!index} onClick={() => setIndex(index - 1)}>
          Назад
        </button>
        <span>
          Слайд {index + 1} из {deck.slides.length}
        </span>
        <button
          disabled={index === deck.slides.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          Далее
        </button>
      </div>
      {messages.length > 0 && (
        <details open>
          <summary>Проверка композиции</summary>
          <ul>
            {messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="field-pair">
        <button onClick={back}>К исходному JSON</button>
        <button className="primary" onClick={accept}>
          Открыть в редакторе
        </button>
      </div>
    </>
  );
}

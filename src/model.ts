import {
  builtinFonts,
  check,
  definitions,
  FORMAT_VERSION,
  type shapes,
} from "./schema.ts";
export const CANVAS_WIDTH = 1280,
  CANVAS_HEIGHT = 720;
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface PathNode extends Point {
  in?: Point;
  out?: Point;
}
export type Shape = keyof typeof shapes;
export type Fill =
  | { type: "none" }
  | { type: "solid"; color: string }
  | {
      type: "linear" | "radial";
      angle?: number;
      stops: { offset: number; color: string }[];
    };
export interface Characters {
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: string;
  tracking?: number;
}
export interface TextStyle extends Characters {
  align?: "left" | "center" | "right";
  leading?: number;
  padding?: number;
  fit?: boolean;
  minSize?: number;
}
export interface Paragraph {
  runs: (Characters & { text: string })[];
  list?: "bullet" | "number";
  indent?: number;
  after?: number;
}
export interface Item extends Box {
  id: string;
  type: "text" | "image" | "shape";
  text: string;
  src: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  role?: "content" | "decoration";
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  style?: string;
  overrides?: TextStyle;
  paragraphs?: Paragraph[];
  shape?: Shape;
  fill?: Fill;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  radius?: number;
  shadow?: { x: number; y: number; blur: number; color: string };
  nodes?: PathNode[];
  closed?: boolean;
}
export interface Slide {
  id: string;
  color: string;
  background: string | null;
  notes: string;
  items: Item[];
  area?: Box;
  kind?: "title" | "normal" | "end";
}
export interface FontAsset {
  id: string;
  label: string;
  format: "woff2" | "woff" | "ttf" | "otf";
  data: string;
}
export interface NamedStyle {
  id: string;
  label: string;
  values: TextStyle;
}
export interface Deck {
  version: 2;
  id: string;
  title: string;
  canvas: { width: 1280; height: 720 };
  theme: { styles: NamedStyle[]; palette: string[] };
  resources: { fonts: FontAsset[] };
  slides: Slide[];
}
export function newSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    color: "#ffffff",
    background: null,
    notes: "",
    items: [],
  };
}
export function newDeck(title: string): Deck {
  const style = (
    id: string,
    label: string,
    size: number,
    bold = false,
  ): NamedStyle => ({
    id,
    label,
    values: {
      font: "sans",
      size,
      bold,
      color: "#163e49",
      fit: true,
      minSize: 18,
    },
  });
  return {
    version: FORMAT_VERSION,
    id: crypto.randomUUID(),
    title: title.trim() || "Без названия",
    canvas: { width: 1280, height: 720 },
    theme: {
      palette: ["#163e49", "#e5f4ef", "#f8bd56"],
      styles: [
        style("title", "Заголовок", 64, true),
        style("subtitle", "Подзаголовок", 44),
        style("body", "Основной текст", 32),
        style("caption", "Подпись", 24),
        style("accent", "Акцент", 38, true),
        style("small", "Мелкий текст", 18),
      ],
    },
    resources: { fonts: [] },
    slides: [newSlide()],
  };
}
export function newText(): Item {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 80,
    y: 80,
    w: 560,
    h: 140,
    text: "Новый текст",
    src: "",
    size: 48,
    color: "#18293d",
    align: "left",
  };
}
export function newShape(shape: Shape = "rounded"): Item {
  const open = ["line", "polyline", "curve", "path"].includes(shape);
  return {
    ...newText(),
    type: "shape",
    shape,
    w: 320,
    h: 180,
    text: "",
    fill: { type: "solid", color: "#bde6dd" },
    stroke: "#275b68",
    strokeWidth: open ? 5 : 0,
    ...(shape === "path"
      ? {
          nodes: [
            { x: 0, y: 90 },
            { x: 45, y: 10 },
            { x: 100, y: 85 },
          ],
          closed: false,
        }
      : {}),
  };
}
export function typography(item: Item, deck?: Deck) {
  return {
    font: "sans",
    leading: 1.18,
    fit: true,
    minSize: 16,
    padding: 0,
    size: item.size,
    color: item.color,
    align: item.align,
    ...deck?.theme.styles.find((s) => s.id === item.style)?.values,
    ...item.overrides,
  };
}
export function paragraphs(item: Item): Paragraph[] {
  return (
    item.paragraphs ??
    item.text.split("\n").map((text) => ({ runs: [{ text }] }))
  );
}
export function richText(parts: Paragraph[]): Partial<Item> {
  return {
    paragraphs: parts,
    text: parts.map((p) => p.runs.map((r) => r.text).join("")).join("\n"),
  };
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function imageSource(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 24 * 1024 * 1024,
    "Некорректная ссылка или слишком большое изображение.",
  );
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    requireValue(
      comma > 0 && comma < 32,
      "Некорректное встроенное изображение.",
    );
    const mime = value.slice(0, comma);
    const data = value.slice(comma + 1);
    requireValue(
      data.length > 0 &&
        data.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+=*$/.test(data) &&
        !data.endsWith("==="),
      "Некорректные данные изображения.",
    );
    const signature = atob(data.slice(0, 16));
    const ok =
      (mime === "data:image/png;base64" &&
        signature.startsWith("\x89PNG\r\n\x1a\n")) ||
      (mime === "data:image/jpeg;base64" &&
        signature.startsWith("\xff\xd8\xff")) ||
      (mime === "data:image/webp;base64" &&
        signature.startsWith("RIFF") &&
        signature.slice(8, 12) === "WEBP");
    requireValue(ok, "Поддерживаются встроенные PNG, JPEG и WebP.");
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Не удалось прочитать ссылку на изображение.");
  }
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      value.length <= 8192,
    "Для внешних изображений требуется публичный HTTPS-адрес.",
  );
  return url.href;
}

const signatures = {
  woff: "wOFF",
  woff2: "wOF2",
  ttf: "\x00\x01\x00\x00",
  otf: "OTTO",
};
export function verifyFont(font: FontAsset) {
  requireValue(
    !Object.hasOwn(builtinFonts, font.id),
    "Идентификатор шрифта занят.",
  );
  requireValue(
    font.data.length <= 5592408 &&
      font.data.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(font.data) &&
      atob(font.data.slice(0, 8)).startsWith(signatures[font.format]),
    "Некорректный шрифт " + font.label + " (до 4 МиБ).",
  );
}
export function readJSON(raw: string): unknown {
  requireValue(
    raw.length <= MAX_DOCUMENT_BYTES &&
      new Blob([raw]).size <= MAX_DOCUMENT_BYTES,
    "Файл превышает 64 МБ.",
  );
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Не удалось прочитать JSON. Проверьте синтаксис.");
  }
}
export function validateDeck(input: unknown): Deck {
  const raw = typeof input === "string" ? readJSON(input) : input;
  requireValue(
    raw &&
      typeof raw === "object" &&
      "version" in raw &&
      [1, 2].includes(Number(raw.version)),
    "Неизвестная версия презентации.",
  );
  const legacy = raw.version === 1;
  check(definitions[legacy ? "Legacy" : "Presentation"], raw, "Презентация");
  const source = structuredClone(raw) as Deck;
  const d: Deck = legacy
    ? { ...newDeck(source.title), id: source.id, slides: source.slides }
    : source;
  requireValue(d.title.trim(), "Введите название.");
  const ids = new Set<string>();
  function unique(id: string, group: Set<string>, path: string) {
    requireValue(!group.has(id), path + " — повторяется идентификатор " + id);
    group.add(id);
  }
  unique(d.id.toLowerCase(), ids, "Презентация");
  const styles = new Set<string>(),
    fonts = new Set<string>();
  for (const f of d.resources.fonts) {
    unique(f.id, fonts, "Шрифт");
    verifyFont(f);
  }
  for (const s of d.theme.styles) unique(s.id, styles, "Стиль");
  for (const [i, s] of d.slides.entries()) {
    const path = "Слайд " + (i + 1);
    unique(s.id.toLowerCase(), ids, path);
    if (s.background !== null) {
      try {
        imageSource(s.background);
      } catch (e) {
        throw new Error(path + " — " + (e as Error).message);
      }
    }
    for (const [j, it] of s.items.entries()) {
      const where = path + ", объект " + (j + 1);
      try {
        unique(it.id.toLowerCase(), ids, where);
        if (it.type === "image") imageSource(it.src);
        if (legacy && it.type === "text")
          it.overrides = { font: "legacy", fit: false };
        if (it.style)
          requireValue(styles.has(it.style), "Не определён стиль " + it.style);
        if (it.paragraphs)
          requireValue(
            richText(it.paragraphs).text === it.text,
            "Поле text должно совпадать с текстом абзацев.",
          );
        requireValue(
          it.shape === "path"
            ? !!it.nodes
            : !it.nodes && it.closed === undefined,
          "Укажите узлы только для произвольного контура path.",
        );
        if (it.fill && "stops" in it.fill) {
          const stops = it.fill.stops;
          requireValue(
            stops.every((s, k) => !k || s.offset >= stops[k - 1].offset),
            "Точки градиента должны идти по возрастанию.",
          );
        }
      } catch (e) {
        throw new Error(where + " — " + (e as Error).message);
      }
    }
  }
  return d;
}

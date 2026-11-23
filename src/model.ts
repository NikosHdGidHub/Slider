export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export interface Item {
  id: string;
  type: "text" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  src: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface Slide {
  id: string;
  color: string;
  background: string | null;
  notes: string;
  items: Item[];
}

export interface Deck {
  version: 1;
  id: string;
  title: string;
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
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: title.trim() || "Без названия",
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

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(value: unknown): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Ожидался объект JSON.",
  );
  return value as Record<string, unknown>;
}

function line(value: unknown, max = 200_000): string {
  requireValue(
    typeof value === "string" && value.length <= max,
    "Текстовое поле отсутствует или превышает лимит.",
  );
  return value;
}

function number(value: unknown, min: number, max: number): number {
  requireValue(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
    "Недопустимый размер или координата объекта.",
  );
  return value;
}

function color(value: unknown): string {
  requireValue(
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
    "Цвет должен быть записан в формате #RRGGBB.",
  );
  return value;
}

function uuid(value: unknown, ids: Set<string>): string {
  requireValue(
    typeof value === "string" &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value),
    "Недопустимый идентификатор.",
  );
  requireValue(
    !ids.has(value.toLowerCase()),
    "Найдены повторяющиеся идентификаторы.",
  );
  ids.add(value.toLowerCase());
  return value;
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

function parseItem(raw: unknown, ids: Set<string>): Item {
  const a = object(raw);
  requireValue(
    a.type === "text" || a.type === "image",
    "Неизвестный тип объекта.",
  );
  requireValue(
    a.align === "left" || a.align === "center" || a.align === "right",
    "Неизвестное выравнивание.",
  );
  return {
    id: uuid(a.id, ids),
    type: a.type,
    align: a.align,
    x: number(a.x, -8192, 8192),
    y: number(a.y, -8192, 8192),
    w: number(a.w, 0.01, 8192),
    h: number(a.h, 0.01, 8192),
    text: a.type === "text" ? line(a.text) : "",
    src: a.type === "image" ? imageSource(a.src) : "",
    size: number(a.size, 1, 1024),
    color: color(a.color),
  };
}

export function validateDeck(raw: unknown): Deck {
  if (typeof raw === "string") {
    requireValue(
      new Blob([raw]).size <= MAX_DOCUMENT_BYTES,
      "Файл превышает 64 МБ.",
    );
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("Не удалось прочитать JSON. Проверьте формат файла.");
    }
  }
  const d = object(raw);
  requireValue(
    d.version === 1,
    "Эта версия формата методички не поддерживается.",
  );
  const title = line(d.title, 1024);
  requireValue(title.trim(), "Введите название методички.");
  const ids = new Set<string>();
  const id = uuid(d.id, ids);
  requireValue(
    Array.isArray(d.slides) && d.slides.length > 0 && d.slides.length <= 1000,
    "В методичке должно быть от 1 до 1000 слайдов.",
  );
  const slides = d.slides.map((rawSlide, index) => {
    try {
      const s = object(rawSlide);
      requireValue(
        Array.isArray(s.items) && s.items.length <= 500,
        "На слайде допустимо до 500 объектов.",
      );
      return {
        id: uuid(s.id, ids),
        color: color(s.color),
        background: s.background === null ? null : imageSource(s.background),
        notes: line(s.notes),
        items: s.items.map((item) => parseItem(item, ids)),
      };
    } catch (error) {
      throw new Error(
        `Слайд ${index + 1}. ${error instanceof Error ? error.message : "Некорректные данные."}`,
      );
    }
  });
  return { version: 1, id, title, slides };
}

import type { Box, Deck, Item, Slide, TextStyle } from "./model.ts";
export const cellTypes = {
  title: "Заголовок",
  subtitle: "Подзаголовок",
  description: "Описание",
  text: "Текст",
  header: "Верхний колонтитул",
  footer: "Нижний колонтитул",
  image: "Изображение",
  caption: "Подпись",
  area: "Область слайда",
  free: "Свободный блок",
  empty: "Пустая ячейка",
} as const;
export type CellType = keyof typeof cellTypes;
export type Kind = "title" | "normal" | "end";
export const kinds: Kind[] = ["title", "normal", "end"];
export type Insets = [number, number, number, number];
export interface Cell {
  id: string;
  row: number;
  col: number;
  rows: number;
  cols: number;
  type: CellType;
  padding: Insets;
  fill?: string;
  border?: string;
  width?: number;
  value?: string;
  style?: TextStyle;
}
export interface Grid {
  rows: number[];
  cols: number[];
  padding: Insets;
  cells: Cell[];
}
export interface Master {
  name: string;
  schemes: Record<Kind, Grid>;
  art?: Partial<Record<Kind, Slide>>;
}
export const canvas: Box = { x: 0, y: 0, w: 1280, h: 720 };
export function cell(
  row = 0,
  col = 0,
  type: CellType = "empty",
  id = "c" + crypto.randomUUID(),
): Cell {
  return { id, row, col, type, rows: 1, cols: 1, padding: [0, 0, 0, 0] };
}
export function blankGrid(type: CellType = "area"): Grid {
  return {
    rows: [1],
    cols: [1],
    padding: [0, 0, 0, 0],
    cells: [cell(0, 0, type, "body")],
  };
}
export function defaultMaster(): Master {
  return {
    name: "По умолчанию",
    schemes: { title: blankGrid(), normal: blankGrid(), end: blankGrid() },
  };
}
export function inset(b: Box, [t, r, bottom, l]: Insets): Box {
  return { x: b.x + l, y: b.y + t, w: b.w - r - l, h: b.h - t - bottom };
}
function sum(a: number[]) {
  return a.reduce((s, n) => s + n, 0);
}
export function rectangles(g: Grid) {
  const inner = inset(canvas, g.padding);
  return g.cells.map((c) => {
    const part = (v: number[], start: number, count: number) =>
      sum(v.slice(start, start + count)) / sum(v);
    const outer = {
      x: inner.x + inner.w * part(g.cols, 0, c.col),
      y: inner.y + inner.h * part(g.rows, 0, c.row),
      w: inner.w * part(g.cols, c.col, c.cols),
      h: inner.h * part(g.rows, c.row, c.rows),
    };
    return { cell: c, outer, box: inset(outer, c.padding) };
  });
}
export function validateGrid(g: Grid, structural: boolean) {
  if (
    [g.rows, g.cols].some(
      (a) =>
        !a.length ||
        a.length > 24 ||
        a.some((n) => !Number.isFinite(n) || n < 0.01 || n > 8192),
    )
  )
    throw Error("Недопустимые веса или число полос");
  const validInsets = (p: Insets) =>
    p.length === 4 && p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1279);
  if (!validInsets(g.padding) || g.cells.some((c) => !validInsets(c.padding)))
    throw Error("Недопустимые отступы");
  const occupied = new Set<number>(),
    ids = new Set<string>();
  for (const { cell: c, box } of rectangles(g)) {
    if (
      ![c.row, c.col, c.rows, c.cols].every(Number.isInteger) ||
      c.row < 0 ||
      c.col < 0 ||
      c.rows < 1 ||
      c.cols < 1 ||
      c.row + c.rows > g.rows.length ||
      c.col + c.cols > g.cols.length ||
      ids.has(c.id) ||
      box.w < 1 ||
      box.h < 1
    )
      throw Error("Некорректная геометрия или ID ячейки " + c.id);
    ids.add(c.id);
    if (structural && ["area", "header", "footer"].includes(c.type))
      throw Error("Структура не может управлять областью или колонтитулами");
    for (let y = c.row; y < c.row + c.rows; y++)
      for (let x = c.col; x < c.col + c.cols; x++) {
        const n = y * g.cols.length + x;
        if (occupied.has(n)) throw Error("Ячейки пересекаются");
        occupied.add(n);
      }
  }
  if (
    occupied.size !== g.rows.length * g.cols.length ||
    g.cells.filter((c) => c.type === "area").length > 1
  )
    throw Error(
      "Сетка должна покрывать все ячейки и содержать не более одной области",
    );
}
export function fitArea(b: Box) {
  const k = Math.min(b.w / 1280, b.h / 720);
  return {
    x: b.x + (b.w - 1280 * k) / 2,
    y: b.y + (b.h - 720 * k) / 2,
    w: 1280 * k,
    h: 720 * k,
  };
}
const mapBox = (b: Box, outer: Box): Box => ({
  x: outer.x + (b.x * outer.w) / 1280,
  y: outer.y + (b.y * outer.w) / 1280,
  w: (b.w * outer.w) / 1280,
  h: (b.h * outer.w) / 1280,
});
export interface Slot {
  id: string;
  cell: Cell;
  box: Box;
  outer: Box;
  scale: number;
}
export function slots(master: Master, s: Slide): Slot[] {
  const rows: Slot[] = rectangles(master.schemes[s.kind ?? "normal"]).map(
    (r) => ({ ...r, id: "m/" + r.cell.id, scale: 1 }),
  );
  const body = rows.find((r) => r.cell.type === "area");
  if (!body) return rows;
  const area = fitArea(body.box);
  if (!s.structure)
    return [
      ...rows,
      {
        id: "free",
        cell: { ...body.cell, type: "free", fill: undefined, width: 0 },
        box: area,
        outer: area,
        scale: area.w / 1280,
      },
    ];
  return [
    ...rows,
    ...rectangles(s.structure).map((r) => ({
      ...r,
      id: "s/" + r.cell.id,
      box: mapBox(r.box, area),
      outer: mapBox(r.outer, area),
      scale: area.w / 1280,
    })),
  ];
}
export function accepts(c: CellType, o: Item) {
  return (
    c === "free" ||
    (c === "image"
      ? o.type === "image"
      : !["area", "empty"].includes(c) && o.type === "text")
  );
}
export function target(o: Item) {
  return o.slot ?? "free";
}
export function pose(o: Item, all: Slot[]) {
  if (o.fixed) return { item: o, x: 0, y: 0, k: 1, fixed: true };
  const slot = all.find((s) => s.id === target(o));
  if (!slot) return null;
  const free = slot.cell.type === "free",
    k = slot.scale;
  const item = free
    ? o
    : {
        ...o,
        x: 0,
        y: 0,
        w: slot.box.w / k,
        h: slot.box.h / k,
        ...(o.type === "text"
          ? { overrides: { ...slot.cell.style, ...o.overrides, fit: true } }
          : {}),
      };
  return { item, x: slot.box.x, y: slot.box.y, k, fixed: !free };
}
export function freezeDecoration(o: Item, locations: Slot[]): Item {
  const p = pose(o, locations);
  if (!p || o.fixed) return o;
  return {
    ...p.item,
    fixed: true,
    role: "decoration",
    x: p.x + p.k * p.item.x,
    y: p.y + p.k * p.item.y,
    w: p.k * p.item.w,
    h: p.k * p.item.h,
    contentScale: (o.contentScale ?? 1) * p.k,
  };
}
export function bind(o: Item, id: string): Item {
  return {
    ...o,
    ...(id === "tray" && target(o) !== "tray" ? { priorSlot: target(o) } : {}),
    slot: id,
  };
}
export function structureSlide(master: Master, s: Slide, grid?: Grid): Slide {
  const old = slots(master, s),
    area = old.find((v) => v.cell.type === "area");
  if (!area) throw Error("Схема не содержит области слайда");
  const next = { ...s };
  if (grid) next.structure = structuredClone(grid);
  else delete next.structure;
  const root = fitArea(area.box),
    scale = root.w / 1280;
  next.items = s.items.map((o) => {
    if (o.fixed || target(o).startsWith("m/") || target(o) === "tray") return o;
    if (grid) return bind(o, "tray");
    const p = pose(o, old);
    if (!p) return bind(o, "tray");
    const ratio = p.k / scale;
    return {
      ...p.item,
      slot: "free",
      x: (p.x + p.item.x * p.k - root.x) / scale,
      y: (p.y + p.item.y * p.k - root.y) / scale,
      w: p.item.w * ratio,
      h: p.item.h * ratio,
      ...(ratio !== 1
        ? { contentScale: (p.item.contentScale ?? 1) * ratio }
        : {}),
    };
  });
  return next;
}
function templateResources(deck: Deck, template: Deck) {
  const imported = structuredClone(template);
  const fonts = [...deck.resources.fonts],
    styles = [...deck.theme.styles];
  const fontMap = new Map<string, string>(),
    styleMap = new Map<string, string>();
  for (const f of imported.resources.fonts) {
    const same = fonts.find((v) => v.data === f.data);
    let id = same?.id ?? f.id;
    if (!same) {
      if (fonts.some((v) => v.id === id)) id = "f" + crypto.randomUUID();
      fonts.push({ ...f, id });
    }
    fontMap.set(f.id, id);
  }
  const remap = (style: { font?: string }) => {
    if (style.font && fontMap.has(style.font))
      style.font = fontMap.get(style.font);
  };
  for (const def of imported.theme.styles) {
    remap(def.values);
    const present = styles.find((v) => v.id === def.id);
    if (
      present &&
      JSON.stringify(present.values) === JSON.stringify(def.values)
    )
      continue;
    const same = styles.find(
      (v) =>
        v.label === def.label &&
        JSON.stringify(v.values) === JSON.stringify(def.values),
    );
    if (present && same) {
      styleMap.set(def.id, same.id);
      continue;
    }
    const id = present ? "s" + crypto.randomUUID() : def.id;
    styles.push({ ...def, id });
    styleMap.set(def.id, id);
  }
  if (fonts.length > 32 || styles.length > 128)
    throw Error("После объединения превышен лимит стилей или шрифтов.");
  const master = imported.master;
  for (const g of [
    ...Object.values(master.schemes),
    ...imported.slides.flatMap((s) => (s.structure ? [s.structure] : [])),
  ])
    for (const c of g.cells) if (c.style) remap(c.style);
  for (const s of imported.slides)
    for (const o of s.items) {
      if (o.style && styleMap.has(o.style)) o.style = styleMap.get(o.style);
      if (o.overrides) remap(o.overrides);
      o.paragraphs?.forEach((p) => p.runs.forEach(remap));
    }

  return { imported, fonts, styles };
}
export function setStructure(deck: Deck, slide: Slide, template?: Deck): Deck {
  const merged = template ? templateResources(deck, template) : undefined;
  const next = structureSlide(
    deck.master,
    slide,
    merged?.imported.slides[0].structure,
  );
  return {
    ...deck,
    resources: merged ? { fonts: merged.fonts } : deck.resources,
    slides: deck.slides.map((s) => (s.id === next.id ? next : s)),
  };
}
export function mediaSlides(deck: Deck): Slide[] {
  return [...deck.slides, ...Object.values(deck.master.art ?? {})];
}
export function rememberArt(deck: Deck) {
  const art: Partial<Record<Kind, Slide>> = {};
  for (const kind of kinds) {
    const s = deck.slides.find((s) => (s.kind ?? "normal") === kind);
    if (!s) continue;
    const locations = slots(deck.master, s);
    const items = s.items
      .filter(
        (o) => target(o) !== "tray" && (o.fixed || o.role === "decoration"),
      )
      .map((o) => ({
        ...freezeDecoration(o, locations),
        id: crypto.randomUUID(),
      }));
    if (items.length || s.background || s.color.toLowerCase() !== "#ffffff")
      art[kind] = {
        id: crypto.randomUUID(),
        kind,
        color: s.color,
        ...(s.effects ? { effects: s.effects } : {}),
        background: s.background,
        items,
        notes: "",
      };
  }
  deck.master.art = art;
}
export function inheritedBackground(s: Slide, sample?: Slide): Slide {
  const next = {
    ...s,
    color: sample?.color ?? "#ffffff",
    background: sample?.background ?? null,
  };
  delete next.effects;
  delete next.ownBackground;
  if (sample?.effects) next.effects = { ...sample.effects };
  return next;
}
export function applyKind(master: Master, s: Slide, kind: Kind): Slide {
  const sample = master.art?.[kind];
  if (!master.art) return repairSlots(master, { ...s, kind });
  return repairSlots(master, {
    ...(s.ownBackground ? s : inheritedBackground(s, sample)),
    kind,
    items: [
      ...(sample?.items ?? []).map((o) => ({
        ...structuredClone(o),
        id: crypto.randomUUID(),
      })),
      ...s.items.filter((o) => !o.fixed),
    ],
  });
}
export function switchMaster(deck: Deck, template: Deck): Deck {
  const { imported, fonts, styles } = templateResources(deck, template),
    master = imported.master;
  rememberArt(imported);
  const slides = deck.slides.map((s) => {
    const kind = s.kind ?? "normal",
      sample = imported.slides.find((v) => v.kind === kind);
    const next = {
      ...(s.ownBackground ? s : inheritedBackground(s, sample)),
    };
    const old = slots(deck.master, s),
      available = slots(master, s),
      occupied = new Set<string>();
    const reserved = new Set(
      s.items
        .filter(
          (o) =>
            !o.fixed &&
            available.some(
              (v) =>
                v.id === target(o) &&
                v.cell.type === old.find((p) => p.id === v.id)?.cell.type,
            ),
        )
        .map(target),
    );
    const items = s.items
      .filter((o) => !o.fixed)
      .map((o) => {
        const id = target(o);
        if (id === "tray" || deck.migrated) return bind(o, "tray");
        const prev = old.find((v) => v.id === id);
        const valid = (v: Slot) =>
          v.cell.type === prev?.cell.type &&
          accepts(v.cell.type, o) &&
          ((!occupied.has(v.id) && (!reserved.has(v.id) || v.id === id)) ||
            v.cell.type === "free") &&
          v.id.split("/")[0] === id.split("/")[0];
        const candidates = available.filter(valid);
        const dest =
          candidates.find((v) => v.id === id) ??
          (candidates.length === 1 ? candidates[0] : undefined);
        if (!dest) return bind(o, "tray");
        occupied.add(dest.id);
        return bind(o, dest.id);
      });
    return {
      ...next,
      items: [
        ...(sample?.items
          .filter(
            (o) => target(o) !== "tray" && (o.fixed || o.role === "decoration"),
          )
          .map((o) => ({
            ...freezeDecoration(o, slots(master, sample!)),
            id: crypto.randomUUID(),
            fixed: true,
          })) ?? []),
        ...items,
      ],
    };
  });
  return {
    ...deck,
    master,
    migrated: false,
    slides,
    theme: { styles, palette: imported.theme.palette },
    resources: { fonts },
  };
}
export function checkBindings(d: Deck, s: Slide) {
  const all = slots(d.master, s),
    taken = new Set<string>();
  for (const o of s.items) {
    if (o.fixed || target(o) === "tray") continue;
    const v = all.find((v) => v.id === target(o));
    if (
      !v ||
      !accepts(v.cell.type, o) ||
      (v.cell.type !== "free" && taken.has(v.id))
    )
      throw Error("Объект " + o.id + " несовместим со слотом " + target(o));
    taken.add(v.id);
  }
}

export function repairSlots(master: Master, s: Slide): Slide {
  const all = slots(master, s),
    used = new Set<string>();
  return {
    ...s,
    items: s.items.map((o) => {
      if (o.fixed || target(o) === "tray") return o;
      const dest = all.find(
        (v) => v.id === target(o) && accepts(v.cell.type, o),
      );
      if (!dest || (dest.cell.type !== "free" && used.has(dest.id)))
        return bind(o, "tray");
      used.add(dest.id);
      return o;
    }),
  };
}

// A caption directly below a single image cell belongs to that image.
export function linkCaptions(master: Master, s: Slide): Slide {
  const all = slots(master, s),
    items = [...s.items];
  for (const cap of all.filter((v) => v.cell.type === "caption")) {
    const images = all.filter(
      (v) =>
        v.cell.type === "image" &&
        v.id[0] === cap.id[0] &&
        v.cell.col === cap.cell.col &&
        v.cell.cols === cap.cell.cols &&
        v.cell.row + v.cell.rows === cap.cell.row,
    );
    if (images.length !== 1) continue;
    const i = items.findIndex((o) => target(o) === images[0].id),
      j = items.findIndex((o) => target(o) === cap.id);
    if (i < 0 || j < 0 || (items[i].relation && items[j].relation)) continue;
    const relation =
      items[i].relation ?? items[j].relation ?? "r" + crypto.randomUUID();
    items[i] = { ...items[i], relation };
    items[j] = { ...items[j], relation };
  }
  return { ...s, items };
}

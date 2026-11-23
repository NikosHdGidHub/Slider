import { newShape, type Item, type PathNode, type Point } from "./model";
const geometry: Record<string, string[]> = {
  svg: ["viewBox", "xmlns", "width", "height"],
  g: [],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
  path: ["d"],
};
const paints = ["fill", "stroke", "stroke-width"];
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function scalar(s: string) {
  if (!numeric.test(s) || !Number.isFinite(+s) || Math.abs(+s) > 1e6)
    throw new Error("Некорректная координата SVG.");
  return +s;
}
function paint(s: string) {
  if (s === "none") return s;
  if (/^#[\da-f]{3}$/i.test(s))
    return "#" + [...s.slice(1)].map((c) => c + c).join("");
  if (/^#[\da-f]{6}$/i.test(s)) return s;
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#008000",
  };
  if (Object.hasOwn(named, s)) return named[s];
  throw new Error("Для цвета SVG используйте #RRGGBB.");
}
function pathNodes(d: string) {
  const matches =
    d.match(/[a-z]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  if (
    d.replace(/[a-z]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[\s,]/gi, "") ||
    matches.length > 4096
  )
    throw new Error("Сложный или некорректный контур SVG.");
  const nodes: PathNode[] = [];
  let i = 0,
    cmd = "",
    closed = false;
  const read = () => scalar(matches[i++] ?? "");
  while (i < matches.length) {
    if (/^[a-z]$/i.test(matches[i])) cmd = matches[i++];
    const code = cmd.toUpperCase(),
      rel = code !== cmd;
    if (!nodes.length && code !== "M")
      throw new Error("Контур должен начинаться с M.");
    const prev = nodes.at(-1) ?? { x: 0, y: 0 };
    const point = (): Point => ({
      x: read() + (rel ? prev.x : 0),
      y: read() + (rel ? prev.y : 0),
    });
    if (code === "M" && !nodes.length) {
      nodes.push(point());
      cmd = rel ? "l" : "L";
    } else if (code === "L") nodes.push(point());
    else if (code === "H")
      nodes.push({ x: read() + (rel ? prev.x : 0), y: prev.y });
    else if (code === "V")
      nodes.push({ x: prev.x, y: read() + (rel ? prev.y : 0) });
    else if (code === "C") {
      prev.out = point();
      const control = point();
      nodes.push({ ...point(), in: control });
    } else if (code === "Q") {
      const q = point(),
        end = point();
      prev.out = {
        x: prev.x + ((q.x - prev.x) * 2) / 3,
        y: prev.y + ((q.y - prev.y) * 2) / 3,
      };
      nodes.push({
        ...end,
        in: {
          x: end.x + ((q.x - end.x) * 2) / 3,
          y: end.y + ((q.y - end.y) * 2) / 3,
        },
      });
    } else if (code === "Z" && i === matches.length) {
      closed = true;
      break;
    } else
      throw new Error(
        "Поддерживается один контур с командами M, L, H, V, Q, C, Z. Разделите составной путь в векторном редакторе.",
      );
  }
  if (nodes.length < 2 || nodes.length > 512)
    throw new Error("Допустимо 2–512 узлов.");
  return { nodes, closed };
}
export async function importSVG(file: Blob): Promise<Item[]> {
  if (!file.size || file.size > 1024 * 1024)
    throw new Error("Выберите SVG до 1 МиБ.");
  const xml = await file.text();
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(xml))
    throw new Error("Служебные конструкции SVG не поддерживаются.");
  const parsed = new DOMParser().parseFromString(xml, "image/svg+xml"),
    root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror"))
    throw new Error("Некорректный SVG.");
  const all = Array.from(root.querySelectorAll("*"));
  if (all.length > 500) throw new Error("SVG содержит более 500 элементов.");
  for (const el of [root, ...all]) {
    if (
      el.namespaceURI !== "http://www.w3.org/2000/svg" ||
      !Object.hasOwn(geometry, el.localName) ||
      (el !== root && el.localName === "svg")
    )
      throw new Error("Элемент SVG не поддерживается: " + el.localName);
    for (const a of el.attributes)
      if (![...geometry[el.localName], ...paints].includes(a.name))
        throw new Error("Атрибут SVG не поддерживается: " + a.name);
  }
  const view = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(scalar) ?? [
    0,
    0,
    scalar(root.getAttribute("width") ?? "300"),
    scalar(root.getAttribute("height") ?? "150"),
  ];
  if (view.length !== 4 || view[2] <= 0 || view[3] <= 0)
    throw new Error("Проверьте viewBox SVG.");
  const scale = Math.min(700 / view[2], 460 / view[3]),
    ox = (1280 - view[2] * scale) / 2,
    oy = (720 - view[3] * scale) / 2;
  const result: Item[] = [];
  for (const el of all.filter((e) => e.localName !== "g")) {
    const n = (key: string, def = 0) =>
      scalar(el.getAttribute(key) ?? String(def));
    const inherited = (key: string, fallback: string) =>
      el.closest("[" + key + "]")?.getAttribute(key) ?? fallback;
    const fill = paint(inherited("fill", "black")),
      stroke = paint(inherited("stroke", "none")),
      sw = scalar(inherited("stroke-width", "1"));
    let item = newShape("path"),
      x = 0,
      y = 0,
      w = 0,
      h = 0;
    if (el.localName === "rect") {
      x = n("x");
      y = n("y");
      w = n("width");
      h = n("height");
      item = newShape("rect");
      item.radius = n("rx", n("ry")) * scale;
      if (n("ry", n("rx")) !== n("rx", n("ry")))
        throw new Error("Разные rx и ry у прямоугольника не поддерживаются.");
    } else if (el.localName === "circle" || el.localName === "ellipse") {
      const rx = n("rx", n("r")),
        ry = n("ry", n("r"));
      x = n("cx") - rx;
      y = n("cy") - ry;
      w = 2 * rx;
      h = 2 * ry;
      item = newShape("ellipse");
    } else {
      const d =
        el.localName === "path"
          ? (el.getAttribute("d") ?? "")
          : el.localName === "line"
            ? "M " + n("x1") + " " + n("y1") + " L " + n("x2") + " " + n("y2")
            : "M " +
              el.getAttribute("points") +
              (el.localName === "polygon" ? " Z" : "");
      const { nodes, closed } = pathNodes(d);
      const pts = nodes.flatMap((p) => [
        p,
        ...(p.in ? [p.in] : []),
        ...(p.out ? [p.out] : []),
      ]);
      x = Math.min(...pts.map((p) => p.x));
      y = Math.min(...pts.map((p) => p.y));
      w = Math.max(1 / scale, Math.max(...pts.map((p) => p.x)) - x);
      h = Math.max(1 / scale, Math.max(...pts.map((p) => p.y)) - y);
      const normal = (p: Point) => ({
        x: ((p.x - x) * 100) / w,
        y: ((p.y - y) * 100) / h,
      });
      item.nodes = nodes.map((p) => ({
        ...normal(p),
        ...(p.in ? { in: normal(p.in) } : {}),
        ...(p.out ? { out: normal(p.out) } : {}),
      }));
      item.closed = closed;
      if (!closed && fill !== "none" && el.localName !== "line")
        throw new Error('У открытого пути укажите fill="none".');
    }
    if (w <= 0 || h <= 0) throw new Error("Пустой объект в SVG.");
    Object.assign(item, {
      x: ox + (x - view[0]) * scale,
      y: oy + (y - view[1]) * scale,
      w: w * scale,
      h: h * scale,
      stroke: stroke === "none" ? "#000000" : stroke,
      strokeWidth: stroke === "none" ? 0 : sw * scale,
      fill: fill === "none" ? { type: "none" } : { type: "solid", color: fill },
    });
    result.push(item);
  }
  if (!result.length) throw new Error("SVG не содержит фигур.");
  return result;
}

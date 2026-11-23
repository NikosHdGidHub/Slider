import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  paragraphs,
  richText,
  typography,
  type Characters,
  type Deck,
  type FontAsset,
  type Item,
  type PathNode,
} from "./model";
const families: Record<string, string> = {
  sans: "Atlas Sans",
  serif: "Atlas Serif",
  mono: "Atlas Mono",
  legacy: "Arial",
};
const assets = new WeakMap<FontAsset, string>();
export function fontFamily(id: string | undefined, deck?: Deck) {
  const font = deck?.resources.fonts.find((f) => f.id === id);
  if (!font)
    return (
      (id && Object.hasOwn(families, id) ? families[id] : families.sans) +
      ", Arial, sans-serif"
    );
  if (!assets.has(font)) assets.set(font, "AtlasUser" + crypto.randomUUID());
  return assets.get(font) + ", Atlas Sans, sans-serif";
}
const registered = new WeakMap<
  Document,
  Map<string, { face: FontFace; count: number }>
>();
export function useFonts(
  host: React.RefObject<HTMLDivElement | null>,
  deck?: Deck,
) {
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const doc = host.current?.ownerDocument;
    if (!doc || !deck) return;
    let active = true;
    setError("");
    const cache = registered.get(doc) ?? new Map();
    registered.set(doc, cache);
    const keys = deck.resources.fonts.map((f) => {
      const key = fontFamily(f.id, deck).split(",")[0];
      if (!cache.has(key)) {
        const face = new FontFace(
          key,
          "url(data:font/" + f.format + ";base64," + f.data + ")",
        );
        doc.fonts.add(face);
        cache.set(key, { face, count: 0 });
      }
      const entry = cache.get(key)!;
      entry.count++;
      entry.face.load().catch(() => {
        if (active)
          setError(
            "Шрифт «" + f.label + "» недоступен. Используется DejaVu Sans.",
          );
      });
      return key;
    });
    return () => {
      active = false;
      for (const key of keys) {
        const e = cache.get(key)!;
        if (!--e.count) {
          doc.fonts.delete(e.face);
          cache.delete(key);
        }
      }
    };
  }, [deck?.resources.fonts, host]);
  return error;
}
function chars(s: Characters, deck?: Deck): CSSProperties {
  return {
    fontFamily: s.font ? fontFamily(s.font, deck) : undefined,
    color: s.color,
    fontWeight: s.bold === undefined ? undefined : s.bold ? 700 : 400,
    fontStyle:
      s.italic === undefined ? undefined : s.italic ? "italic" : "normal",
    textDecoration:
      [s.underline ? "underline" : "", s.strike ? "line-through" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    backgroundColor: s.highlight,
    letterSpacing: s.tracking,
  };
}
export function TextBlock({
  item,
  deck,
  editing,
  onText,
}: {
  item: Item;
  deck?: Deck;
  editing: boolean;
  onText?: (fields: Partial<Item>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const style = typography(item, deck);
  const [editingRun, setEditingRun] = useState("");
  const canceled = useRef(false);
  function commit(i: number, j: number, text: string) {
    setEditingRun("");
    if (canceled.current || !onText) return;
    const parts = [...paragraphs(item)];
    if (parts[i].runs[j].text === text) return;
    parts[i] = {
      ...parts[i],
      runs: parts[i].runs.map((r, k) => (j === k ? { ...r, text } : r)),
    };
    const fields = richText(parts);
    onText(item.paragraphs ? fields : { text: fields.text });
  }
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = box.current!;
    const content = el.firstElementChild as HTMLElement;
    let live = true;
    function measure() {
      if (!live) return;
      function fits(size: number) {
        content.style.fontSize = size + "px";
        return (
          content.scrollHeight <= el.clientHeight - 2 * style.padding + 1 &&
          content.scrollWidth <= el.clientWidth - 2 * style.padding + 1
        );
      }
      let ok = fits(style.size);
      if (!ok && style.fit) {
        let low = Math.min(style.minSize, style.size),
          high = style.size;
        ok = fits(low);
        if (ok) {
          for (let i = 0; i < 10; i++) {
            const mid = (low + high) / 2;
            if (fits(mid)) low = mid;
            else high = mid;
          }
          fits(low);
        }
      }
      setOverflow(!ok);
    }
    measure();
    const fonts = el.ownerDocument.fonts;
    void fonts.ready.then(measure);
    fonts.addEventListener("loadingdone", measure);
    return () => {
      live = false;
      fonts.removeEventListener("loadingdone", measure);
    };
  }, [item, deck?.theme, deck?.resources]);
  let number = 0;
  return (
    <>
      <div
        ref={box}
        className="atlas-slide-text"
        data-overflow={overflow || undefined}
        style={{
          padding: style.padding,
          boxSizing: "border-box",
          textAlign: style.align,
          lineHeight: style.leading,
        }}
      >
        <div
          style={{
            fontSize: style.size,
            fontFamily: fontFamily(style.font, deck),
            color: style.color,
          }}
        >
          {paragraphs(item).map((p, i) => {
            number = p.list === "number" ? number + 1 : 0;
            return (
              <div
                key={i}
                style={{
                  paddingLeft: p.indent,
                  marginBottom: p.after,
                  display: "flex",
                  justifyContent:
                    style.align === "center"
                      ? "center"
                      : style.align === "right"
                        ? "flex-end"
                        : "flex-start",
                }}
              >
                {p.list && (
                  <span style={{ marginRight: ".35em" }}>
                    {p.list === "bullet" ? "•" : number + "."}
                  </span>
                )}
                <div style={{ minWidth: 0, whiteSpace: "pre-wrap" }}>
                  {p.runs.map((r, j) => (
                    <span
                      key={j}
                      contentEditable={
                        editingRun === i + "." + j
                          ? "plaintext-only"
                          : undefined
                      }
                      suppressContentEditableWarning
                      onDoubleClick={(e) => {
                        if (!onText) return;
                        e.stopPropagation();
                        const el = e.currentTarget;
                        canceled.current = false;
                        setEditingRun(i + "." + j);
                        requestAnimationFrame(() => el.focus());
                      }}
                      onPointerDown={(e) => {
                        if (editingRun === i + "." + j) e.stopPropagation();
                      }}
                      onBlur={(e) => {
                        if (editingRun === i + "." + j)
                          commit(
                            i,
                            j,
                            e.currentTarget.innerText.replace(/\u200b/g, ""),
                          );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          canceled.current = true;
                          e.currentTarget.textContent = r.text;
                          e.currentTarget.blur();
                        } else if (
                          e.key === "Enter" &&
                          (e.ctrlKey || e.metaKey)
                        )
                          e.currentTarget.blur();
                      }}
                      style={{
                        ...chars({ ...style, ...r }, deck),
                        fontSize: r.size
                          ? r.size / style.size + "em"
                          : undefined,
                      }}
                    >
                      {r.text || "\u200b"}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {overflow && editing && (
        <span className="overflow-badge">Текст не помещается</span>
      )}
    </>
  );
}
export function pathData(
  nodes: PathNode[],
  w: number,
  h: number,
  closed = false,
) {
  const point = (p: PathNode) => (p.x * w) / 100 + " " + (p.y * h) / 100;
  const edge = (a: PathNode, b: PathNode) =>
    a.out || b.in
      ? "C" + point(a.out ?? a) + " " + point(b.in ?? b) + " " + point(b)
      : "L" + point(b);
  return (
    "M" +
    point(nodes[0]) +
    nodes
      .slice(1)
      .map((p, i) => edge(nodes[i], p))
      .join("") +
    (closed ? edge(nodes[nodes.length - 1], nodes[0]) + "Z" : "")
  );
}
export function VectorShape({ item }: { item: Item }) {
  const gid = "g" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { w, h, shape, fill } = item;
  const open =
    ["line", "polyline", "curve"].includes(shape!) ||
    (shape === "path" && !item.closed);
  const points = (v: number[][]) =>
    v.map(([x, y]) => x * w + "," + y * h).join(" ");
  const rotation =
    ((fill?.type === "linear" ? (fill.angle ?? 0) : 0) * Math.PI) / 180;
  const gradient = fill && "stops" in fill;
  const stops = gradient
    ? fill.stops.map((s, i) => (
        <stop key={i} offset={s.offset} stopColor={s.color} />
      ))
    : null;
  let body;
  switch (shape) {
    case "circle":
      body = <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2} />;
      break;
    case "ellipse":
      body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />;
      break;
    case "triangle":
      body = (
        <polygon
          points={points([
            [0.5, 0],
            [1, 1],
            [0, 1],
          ])}
        />
      );
      break;
    case "polygon":
      body = (
        <polygon
          points={points([
            [0.25, 0],
            [0.75, 0],
            [1, 0.5],
            [0.75, 1],
            [0.25, 1],
            [0, 0.5],
          ])}
        />
      );
      break;
    case "star":
      body = (
        <polygon
          points={points(
            Array.from({ length: 10 }, (_, i) => {
              const a = (i * Math.PI) / 5 - Math.PI / 2,
                r = i % 2 ? 0.22 : 0.5;
              return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
            }),
          )}
        />
      );
      break;
    case "arrow":
      body = (
        <polygon
          points={points([
            [0, 0.33],
            [0.63, 0.33],
            [0.63, 0],
            [1, 0.5],
            [0.63, 1],
            [0.63, 0.67],
            [0, 0.67],
          ])}
        />
      );
      break;
    case "line":
      body = <line x1={0} y1={h / 2} x2={w} y2={h / 2} />;
      break;
    case "polyline":
      body = (
        <polyline
          points={points([
            [0, 0.8],
            [0.32, 0.25],
            [0.65, 0.65],
            [1, 0.12],
          ])}
        />
      );
      break;
    case "curve":
      body = (
        <path
          d={pathData(
            [
              { x: 0, y: 80, out: { x: 25, y: -40 } },
              { x: 100, y: 20, in: { x: 75, y: 140 } },
            ],
            w,
            h,
          )}
        />
      );
      break;
    case "path":
      body = <path d={pathData(item.nodes!, w, h, item.closed)} />;
      break;
    default:
      body = (
        <rect
          width={w}
          height={h}
          rx={item.radius ?? (shape === "rounded" ? 24 : 0)}
        />
      );
  }
  return (
    <svg className="atlas-shape" width={w} height={h} aria-hidden="true">
      <defs>
        {gradient &&
          (fill.type === "linear" ? (
            <linearGradient
              id={gid}
              x1={0.5 - Math.cos(rotation) / 2}
              y1={0.5 - Math.sin(rotation) / 2}
              x2={0.5 + Math.cos(rotation) / 2}
              y2={0.5 + Math.sin(rotation) / 2}
            >
              {stops}
            </linearGradient>
          ) : (
            <radialGradient id={gid}>{stops}</radialGradient>
          ))}
      </defs>
      <g
        fill={
          open || fill?.type === "none"
            ? "none"
            : gradient
              ? "url(#" + gid + ")"
              : fill?.type === "solid"
                ? fill.color
                : "#bde6dd"
        }
        stroke={item.stroke ?? "#275b68"}
        strokeWidth={item.strokeWidth ?? 0}
        strokeDasharray={item.dash?.join(" ")}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {body}
      </g>
    </svg>
  );
}

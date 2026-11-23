import { fontFamily } from "./Artwork";
import { useRef, useState } from "react";
import { installStyle, type StyleLibrary } from "./styleLibrary";
import { builtinFonts, shapes } from "./schema";
import {
  newShape,
  paragraphs,
  richText,
  typography,
  verifyFont,
  type Characters,
  type Deck,
  type FontAsset,
  type Item,
  type Paragraph,
  type TextStyle,
} from "./model";
type Change = (fn: (d: Deck) => Deck) => void;
export function Num({
  label,
  value,
  min,
  max,
  change,
  step = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  change: (v: number) => void;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
            change(Math.min(max, Math.max(min, e.target.valueAsNumber)));
        }}
      />
    </label>
  );
}
function Color({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}
function Toggle({
  label,
  value,
  change,
}: {
  label: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
      />
      {label}
    </label>
  );
}
function CharacterFields({
  values,
  onChange,
  deck,
}: {
  values: Characters;
  onChange: (s: Characters) => void;
  deck: Deck;
}) {
  return (
    <>
      <label>
        Гарнитура
        <select
          aria-label="Гарнитура"
          value={values.font ?? "sans"}
          onChange={(e) => onChange({ font: e.target.value })}
        >
          {Object.entries(builtinFonts).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {deck.resources.fonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <Num
        label="Размер шрифта"
        value={values.size ?? 32}
        min={1}
        max={1024}
        change={(size) => onChange({ size })}
      />
      <Color
        label="Цвет текста"
        value={values.color ?? "#163e49"}
        change={(color) => onChange({ color })}
      />
      <div className="switches">
        {(
          [
            ["bold", "Полужирный"],
            ["italic", "Курсив"],
            ["underline", "Подчёркивание"],
            ["strike", "Зачёркивание"],
          ] as const
        ).map(([key, label]) => (
          <Toggle
            key={key}
            label={label}
            value={!!values[key]}
            change={(v) => onChange({ [key]: v })}
          />
        ))}
      </div>
      <Color
        label="Выделение маркером"
        value={values.highlight ?? "#fff4aa"}
        change={(highlight) => onChange({ highlight })}
      />
      <Num
        label="Интервал между буквами"
        value={values.tracking ?? 0}
        min={-3}
        max={40}
        step={0.25}
        change={(tracking) => onChange({ tracking })}
      />
    </>
  );
}
function StyleFields({
  deck,
  values,
  change,
}: {
  deck: Deck;
  values: TextStyle;
  change: (v: TextStyle) => void;
}) {
  return (
    <>
      <CharacterFields deck={deck} values={values} onChange={change} />
      <label>
        Выравнивание
        <select
          aria-label="Выравнивание"
          value={values.align ?? "left"}
          onChange={(e) => change({ align: e.target.value as Item["align"] })}
        >
          <option value="left">Слева</option>
          <option value="center">По центру</option>
          <option value="right">Справа</option>
        </select>
      </label>
      <Num
        label="Межстрочный интервал"
        min={0.6}
        max={4}
        step={0.05}
        value={values.leading ?? 1.18}
        change={(leading) => change({ leading })}
      />
      <Num
        label="Внутренний отступ"
        min={0}
        max={512}
        value={values.padding ?? 0}
        change={(padding) => change({ padding })}
      />
      <Toggle
        label="Автоподгонка"
        value={values.fit ?? true}
        change={(fit) => change({ fit })}
      />
      <Num
        label="Минимальный размер"
        min={1}
        max={1024}
        value={values.minSize ?? 16}
        change={(minSize) => change({ minSize })}
      />
    </>
  );
}
async function fontFile(file: File): Promise<FontAsset> {
  const format = file.name
    .split(".")
    .pop()
    ?.toLowerCase() as FontAsset["format"];
  if (
    !["woff2", "woff", "ttf", "otf"].includes(format) ||
    !file.size ||
    file.size > 4194304
  )
    throw new Error("Выберите WOFF2, WOFF, TTF или OTF до 4 МиБ.");
  const buffer = await file.arrayBuffer(),
    digest = await crypto.subtle.digest("SHA-256", buffer);
  const id =
    "font-" +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const f = { id, label: file.name.slice(0, 100), format, data };
  verifyFont(f);
  try {
    await new FontFace("AtlasTest", buffer).load();
  } catch {
    throw new Error("Браузер не смог прочитать шрифт.");
  }
  return f;
}
export function StylesPanel({
  deck,
  change,
  notice,
  library,
}: {
  library?: StyleLibrary;
  deck: Deck;
  change: Change;
  notice: (v: string) => void;
}) {
  const [id, setID] = useState(deck.theme.styles[0]?.id ?? "");
  const selected = deck.theme.styles.find((s) => s.id === id);
  const [previewFont, setPreviewFont] = useState("");
  return (
    <details>
      <summary>Шрифты и общие стили</summary>
      <details>
        <summary>Палитра темы</summary>
        {deck.theme.palette.map((value, index) => (
          <Color
            key={index}
            value={value}
            label={"Цвет палитры " + (index + 1)}
            change={(color) =>
              change((d) => ({
                ...d,
                theme: {
                  ...d.theme,
                  palette: d.theme.palette.map((v, j) =>
                    j === index ? color : v,
                  ),
                },
              }))
            }
          />
        ))}
        <button
          disabled={deck.theme.palette.length >= 32}
          onClick={() =>
            change((d) => ({
              ...d,
              theme: { ...d.theme, palette: [...d.theme.palette, "#ffffff"] },
            }))
          }
        >
          Добавить цвет палитры
        </button>
      </details>
      <label>
        Загрузить шрифт
        <input
          type="file"
          accept=".woff2,.woff,.ttf,.otf"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const f = await fontFile(file);
              if (
                deck.resources.fonts.length >= 32 &&
                !deck.resources.fonts.some((font) => font.id === f.id)
              )
                throw new Error("В документе уже 32 шрифта.");
              setPreviewFont(f.id);
              change((d) =>
                d.resources.fonts.some((v) => v.id === f.id)
                  ? d
                  : { ...d, resources: { fonts: [...d.resources.fonts, f] } },
              );
              notice("Шрифт доступен в списке гарнитур.");
            } catch (err) {
              notice((err as Error).message);
            }
          }}
        />
      </label>
      {previewFont && (
        <p
          aria-label="Образец шрифта"
          style={{ fontFamily: fontFamily(previewFont, deck) }}
        >
          {deck.resources.fonts.find((f) => f.id === previewFont)?.label}
          <br />
          Съешь ещё этих мягких французских булок. 012345
        </p>
      )}
      {library && (
        <label>
          Добавить из библиотеки
          <select
            aria-label="Добавить из библиотеки"
            value=""
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              try {
                const next = installStyle(
                  deck,
                  library,
                  kind === "font" ? { font: id } : { style: id },
                );
                change(() => next);
                notice("Добавлено в документ.");
              } catch (err) {
                notice((err as Error).message);
              }
            }}
          >
            <option value="">Стиль или шрифт</option>
            <optgroup label="Стили">
              {library.styles.map((s) => (
                <option key={s.id} value={"style:" + s.id}>
                  {s.label} · {s.id}
                </option>
              ))}
            </optgroup>
            <optgroup label="Шрифты">
              {library.fonts.map((f) => (
                <option key={f.id} value={"font:" + f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      <label>
        Общий стиль
        <select
          aria-label="Общий стиль"
          value={id}
          onChange={(e) => setID(e.target.value)}
        >
          {deck.theme.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          if (deck.theme.styles.length >= 128) {
            notice("В документе уже 128 стилей.");
            return;
          }
          const label = prompt("Название стиля")?.trim();
          if (!label) return;
          const key = "s" + crypto.randomUUID();
          change((d) => ({
            ...d,
            theme: {
              ...d.theme,
              styles: [
                ...d.theme.styles,
                {
                  id: key,
                  label: label.slice(0, 100),
                  values: { font: "sans", size: 32 },
                },
              ],
            },
          }));
          setID(key);
        }}
      >
        Создать стиль
      </button>
      {selected && (
        <StyleFields
          values={selected.values}
          deck={deck}
          change={(v) =>
            change((d) => ({
              ...d,
              theme: {
                ...d.theme,
                styles: d.theme.styles.map((s) =>
                  s.id === id ? { ...s, values: { ...s.values, ...v } } : s,
                ),
              },
            }))
          }
        />
      )}
    </details>
  );
}
export function TextPanel({
  item,
  deck,
  patch,
}: {
  item: Item;
  deck: Deck;
  patch: (v: Partial<Item>) => void;
}) {
  const [pi, paragraph] = useState(0),
    [ri, run] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const parts = paragraphs(item),
    p = Math.min(pi, parts.length - 1),
    r = Math.min(ri, parts[p].runs.length - 1),
    part = parts[p],
    span = part.runs[r];
  const update = (val: Partial<Paragraph>) =>
    patch(richText(parts.map((v, i) => (i === p ? { ...v, ...val } : v))));
  const marked = (val: Partial<typeof span>) =>
    update({ runs: part.runs.map((s, i) => (i === r ? { ...s, ...val } : s)) });
  const style = typography(item, deck);
  return (
    <>
      <label>
        {item.paragraphs ? "Текст фрагмента" : "Текст"}
        <textarea
          aria-label={item.paragraphs ? "Текст фрагмента" : "Текст"}
          id="atlas-edit-text"
          ref={input}
          value={item.paragraphs ? span.text : item.text}
          onChange={(e) =>
            item.paragraphs
              ? marked({ text: e.target.value })
              : patch({ text: e.target.value })
          }
        />
      </label>
      <details>
        <summary>Абзацы и фрагменты</summary>
        <label>
          Абзац
          <select
            aria-label="Абзац"
            value={p}
            onChange={(e) => {
              paragraph(+e.target.value);
              run(0);
            }}
          >
            {parts.map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          Фрагмент
          <select
            aria-label="Фрагмент"
            value={r}
            onChange={(e) => run(+e.target.value)}
          >
            {part.runs.map((s, i) => (
              <option key={i} value={i}>
                {i + 1}. {s.text.slice(0, 22)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            if (!item.paragraphs && parts.length > 1) {
              patch(richText(parts));
              paragraph(0);
              run(0);
              return;
            }
            const start = input.current!.selectionStart,
              end = input.current!.selectionEnd;
            if (start === end) {
              update({ runs: [...part.runs, { text: "Фрагмент" }] });
              run(part.runs.length);
              return;
            }
            const before = span.text.slice(0, start),
              middle = span.text.slice(start, end),
              after = span.text.slice(end);
            update({
              runs: [
                ...part.runs.slice(0, r),
                ...[before, middle, after]
                  .filter(Boolean)
                  .map((text) => ({ ...span, text })),
                ...part.runs.slice(r + 1),
              ],
            });
            run(r + (before ? 1 : 0));
          }}
        >
          Выделить фрагмент
        </button>
        <button
          onClick={() => {
            patch(richText([...parts, { runs: [{ text: "Абзац" }] }]));
            paragraph(parts.length);
            run(0);
          }}
        >
          Добавить абзац
        </button>
        <button
          disabled={parts.length === 1}
          onClick={() => {
            patch(richText(parts.filter((_, i) => i !== p)));
            paragraph(0);
            run(0);
          }}
        >
          Удалить абзац
        </button>
        <button
          disabled={part.runs.length === 1}
          onClick={() => {
            update({ runs: part.runs.filter((_, i) => i !== r) });
            run(0);
          }}
        >
          Удалить фрагмент
        </button>
        <label>
          Список
          <select
            aria-label="Список"
            value={part.list ?? ""}
            onChange={(e) => {
              const next = { ...part };
              if (e.target.value)
                next.list = e.target.value as Paragraph["list"];
              else delete next.list;
              patch(richText(parts.map((v, i) => (i === p ? next : v))));
            }}
          >
            <option value="">Без маркера</option>
            <option value="bullet">Маркированный</option>
            <option value="number">Нумерованный</option>
          </select>
        </label>
        <Num
          label="Отступ абзаца"
          min={0}
          max={512}
          value={part.indent ?? 0}
          change={(indent) => update({ indent })}
        />
        <Num
          label="После абзаца"
          min={0}
          max={256}
          value={part.after ?? 0}
          change={(after) => update({ after })}
        />
        <CharacterFields
          values={{ ...style, ...span }}
          deck={deck}
          onChange={marked}
        />
      </details>
      <label>
        Стиль текста
        <select
          aria-label="Стиль текста"
          value={item.style ?? ""}
          onChange={(e) => patch({ style: e.target.value || undefined })}
        >
          <option value="">Свой стиль</option>
          {deck.theme.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <StyleFields
        deck={deck}
        values={style}
        change={(v) => {
          const base = !item.style
            ? {
                ...(v.size !== undefined ? { size: v.size } : {}),
                ...(v.color ? { color: v.color } : {}),
                ...(v.align ? { align: v.align } : {}),
              }
            : {};
          patch({ ...base, overrides: { ...item.overrides, ...v } });
        }}
      />
      <button onClick={() => patch({ overrides: undefined })}>
        Сбросить переопределения
      </button>
    </>
  );
}
export function ShapePanel({
  item,
  patch,
}: {
  item: Item;
  patch: (v: Partial<Item>) => void;
}) {
  const f = item.fill ?? { type: "solid", color: "#bde6dd" };
  return (
    <>
      <label>
        Форма
        <select
          aria-label="Форма"
          value={item.shape}
          onChange={(e) => {
            const shape = e.target.value as Item["shape"];
            patch({
              shape,
              nodes:
                shape === "path"
                  ? (item.nodes ?? newShape("path").nodes)
                  : undefined,
              closed: shape === "path" ? !!item.closed : undefined,
            });
          }}
        >
          {Object.entries(shapes).map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Заливка
        <select
          aria-label="Заливка"
          value={f.type}
          onChange={(e) => {
            const type = e.target.value as typeof f.type;
            patch({
              fill:
                type === "none"
                  ? { type }
                  : type === "solid"
                    ? { type, color: "#bde6dd" }
                    : {
                        type,
                        stops:
                          "stops" in f
                            ? f.stops
                            : [
                                { offset: 0, color: "#bde6dd" },
                                { offset: 1, color: "#4792a0" },
                              ],
                      },
            });
          }}
        >
          <option value="none">Прозрачная</option>
          <option value="solid">Сплошная</option>
          <option value="linear">Линейный градиент</option>
          <option value="radial">Радиальный градиент</option>
        </select>
      </label>
      {f.type === "solid" && (
        <Color
          label="Цвет заливки"
          value={f.color}
          change={(color) => patch({ fill: { ...f, color } })}
        />
      )}
      {"stops" in f && (
        <>
          {f.type === "linear" && (
            <Num
              label="Угол градиента"
              value={f.angle ?? 0}
              min={-360}
              max={360}
              change={(angle) => patch({ fill: { ...f, angle } })}
            />
          )}
          {f.stops.map((s, i) => (
            <div className="field-pair" key={i}>
              <Color
                label={"Цвет " + (i + 1)}
                value={s.color}
                change={(color) =>
                  patch({
                    fill: {
                      ...f,
                      stops: f.stops.map((v, j) =>
                        j === i ? { ...v, color } : v,
                      ),
                    },
                  })
                }
              />
              <Num
                label="Позиция"
                value={s.offset}
                min={f.stops[i - 1]?.offset ?? 0}
                max={f.stops[i + 1]?.offset ?? 1}
                step={0.01}
                change={(offset) =>
                  patch({
                    fill: {
                      ...f,
                      stops: f.stops.map((v, j) =>
                        j === i ? { ...v, offset } : v,
                      ),
                    },
                  })
                }
              />
              <button
                disabled={f.stops.length <= 2}
                onClick={() =>
                  patch({
                    fill: { ...f, stops: f.stops.filter((_, j) => i !== j) },
                  })
                }
              >
                Убрать
              </button>
            </div>
          ))}
          <button
            disabled={f.stops.length >= 16}
            onClick={() =>
              patch({
                fill: {
                  ...f,
                  stops: [...f.stops, { offset: 1, color: "#ffffff" }],
                },
              })
            }
          >
            Добавить цвет
          </button>
        </>
      )}
      <Color
        label="Цвет контура"
        value={item.stroke ?? "#275b68"}
        change={(stroke) => patch({ stroke })}
      />
      <Num
        label="Толщина контура"
        min={0}
        max={100}
        value={item.strokeWidth ?? 0}
        change={(strokeWidth) => patch({ strokeWidth })}
      />
      <Toggle
        label="Пунктир"
        value={!!item.dash}
        change={(on) => patch({ dash: on ? [12, 8] : undefined })}
      />
      {["rounded", "rect"].includes(item.shape!) && (
        <Num
          label="Скругление"
          min={0}
          max={4096}
          value={item.radius ?? (item.shape === "rounded" ? 24 : 0)}
          change={(radius) => patch({ radius })}
        />
      )}
      <Toggle
        label="Тень"
        value={!!item.shadow}
        change={(on) =>
          patch({
            shadow: on ? { x: 4, y: 6, blur: 8, color: "#799390" } : undefined,
          })
        }
      />
      {item.shadow && (
        <>
          <Color
            label="Цвет тени"
            value={item.shadow.color}
            change={(color) => patch({ shadow: { ...item.shadow!, color } })}
          />
          {(["x", "y", "blur"] as const).map((k) => (
            <Num
              key={k}
              label={{ x: "Смещение X", y: "Смещение Y", blur: "Размытие" }[k]}
              min={k === "blur" ? 0 : -200}
              max={k === "blur" ? 100 : 200}
              value={item.shadow![k]}
              change={(v) => patch({ shadow: { ...item.shadow!, [k]: v } })}
            />
          ))}
        </>
      )}
      {item.shape === "path" && (
        <>
          <Toggle
            label="Замкнуть контур"
            value={!!item.closed}
            change={(closed) => patch({ closed })}
          />
          <small>Перетаскивайте узлы и круглые ручки на холсте.</small>
          {item.nodes!.map((n, i) => (
            <div key={i} className="field-pair">
              <span>Узел {i + 1}</span>
              <button
                onClick={() =>
                  patch({
                    nodes: item.nodes!.map((p, j) =>
                      j !== i
                        ? p
                        : p.in || p.out
                          ? { x: p.x, y: p.y }
                          : {
                              ...p,
                              in: { x: p.x - 12, y: p.y },
                              out: { x: p.x + 12, y: p.y },
                            },
                    ),
                  })
                }
              >
                {n.in || n.out ? "Прямой" : "Безье"}
              </button>
              <button
                disabled={item.nodes!.length <= 2}
                onClick={() =>
                  patch({ nodes: item.nodes!.filter((_, j) => j !== i) })
                }
              >
                Удалить
              </button>
            </div>
          ))}
          <button
            onClick={() => patch({ nodes: [...item.nodes!, { x: 50, y: 50 }] })}
          >
            Добавить узел
          </button>
        </>
      )}
    </>
  );
}
export function GeometryPanel({
  item,
  patch,
}: {
  item: Item;
  patch: (v: Partial<Item>) => void;
}) {
  return (
    <details>
      <summary>Геометрия и слой</summary>
      <div className="field-pair">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <Num
            key={k}
            label={{ x: "X", y: "Y", w: "Ширина", h: "Высота" }[k]}
            min={k === "x" || k === "y" ? -8192 : 0.01}
            max={8192}
            value={item[k]}
            change={(v) => patch({ [k]: v })}
          />
        ))}
      </div>
      <Num
        label="Поворот"
        min={-360}
        max={360}
        value={item.rotation ?? 0}
        change={(rotation) => patch({ rotation })}
      />
      <Num
        label="Непрозрачность"
        min={0}
        max={1}
        step={0.05}
        value={item.opacity ?? 1}
        change={(opacity) => patch({ opacity })}
      />
      <Toggle
        label="Отразить по горизонтали"
        value={!!item.flipX}
        change={(flipX) => patch({ flipX })}
      />
      <Toggle
        label="Отразить по вертикали"
        value={!!item.flipY}
        change={(flipY) => patch({ flipY })}
      />
      <Toggle
        label="Оформление шаблона"
        value={item.role === "decoration"}
        change={(on) => patch({ role: on ? "decoration" : "content" })}
      />
    </details>
  );
}

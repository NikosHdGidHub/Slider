import {
  MAX_DOCUMENT_BYTES,
  newDeck,
  newSlide,
  newText,
  newShape,
  validateDeck,
  type Box,
  type Deck,
  type Item,
  type Slide,
  type PathNode,
} from "./model.ts";

export interface Template {
  kind: "presentation" | "layout";
  description: string;
  deck: Deck;
}
export function validateTemplate(value: unknown): Template {
  if (
    !value ||
    typeof value !== "object" ||
    !("deck" in value) ||
    !("kind" in value) ||
    !("description" in value) ||
    Object.keys(value).some(
      (k) => !["deck", "kind", "description"].includes(k),
    ) ||
    !["presentation", "layout"].includes(String(value.kind)) ||
    typeof value.description !== "string" ||
    value.description.length > 2000
  )
    throw new Error("Ожидается шаблон с полями kind, description и deck.");
  if (new Blob([JSON.stringify(value)]).size > MAX_DOCUMENT_BYTES)
    throw new Error("Шаблон превышает 64 МиБ.");
  const deck = validateDeck(value.deck);
  const isDeck = value.kind === "presentation";
  if (deck.slides.length !== (isDeck ? 3 : 1))
    throw new Error(
      isDeck
        ? "В шаблоне презентации должно быть ровно три слайда."
        : "Компоновка должна содержать один слайд.",
    );
  deck.slides.forEach((s, i) => {
    s.kind = isDeck ? (["title", "normal", "end"] as const)[i] : "normal";
  });
  if (!isDeck && deck.slides[0].items.some((o) => o.role === "decoration"))
    throw new Error(
      "Компоновка содержит только заменяемые объекты. Измените роль оформления на содержимое.",
    );
  return {
    kind: isDeck ? "presentation" : "layout",
    description: value.description,
    deck,
  };
}
export function copyDeck(source: Deck, title = source.title) {
  const d = structuredClone(source);
  d.id = crypto.randomUUID();
  d.title = title;
  for (const s of d.slides) {
    s.id = crypto.randomUUID();
    for (const o of s.items) o.id = crypto.randomUUID();
  }
  return d;
}
export function applyLayout(d: Deck, sid: string, template: Template): Deck {
  const slide = d.slides.find((s) => s.id === sid);
  if (
    !slide ||
    (slide.kind ?? "normal") !== "normal" ||
    template.kind !== "layout"
  )
    throw new Error("Выберите обычный слайд и компоновку.");
  const layout = copyDeck(template.deck);
  const fonts = [...d.resources.fonts];
  const mapping = new Map<string, string>();
  for (const font of layout.resources.fonts) {
    const existing = fonts.find((f) => f.id === font.id);
    if (existing?.data === font.data) continue;
    if (existing) {
      const id = "f" + crypto.randomUUID();
      mapping.set(font.id, id);
      font.id = id;
    }
    fonts.push(font);
  }
  const remap = (s: { font?: string }) => {
    if (s.font && mapping.has(s.font)) s.font = mapping.get(s.font);
  };
  layout.theme.styles.forEach((s) => remap(s.values));
  const styles = [
    ...d.theme.styles,
    ...layout.theme.styles.filter(
      (s) => !d.theme.styles.some((t) => t.id === s.id),
    ),
  ];
  const src = layout.slides[0],
    area = slide.area ?? { x: 0, y: 0, w: 1280, h: 720 },
    from = src.area ?? { x: 0, y: 0, w: 1280, h: 720 };
  const items = src.items.map((o) => {
    if (o.overrides) remap(o.overrides);
    o.paragraphs?.forEach((p) => p.runs.forEach(remap));
    return {
      ...o,
      x: area.x + ((o.x - from.x) * area.w) / from.w,
      y: area.y + ((o.y - from.y) * area.h) / from.h,
      w: (o.w * area.w) / from.w,
      h: (o.h * area.h) / from.h,
    };
  });
  return validateDeck({
    ...d,
    resources: { fonts },
    theme: { ...d.theme, styles },
    slides: d.slides.map((s) =>
      s.id !== sid
        ? s
        : {
            ...s,
            items: [
              ...s.items.filter((o) => o.role === "decoration"),
              ...items,
            ],
          },
    ),
  });
}
const box = (x: number, y: number, w: number, h: number): Box => ({
  x,
  y,
  w,
  h,
});
function label(
  text: string,
  b: Box,
  style = "body",
  extra: Partial<Item> = {},
): Item {
  return { ...newText(), ...b, style, text, ...extra };
}
function figure(
  shape: NonNullable<Item["shape"]>,
  b: Box,
  color: string,
  extra: Partial<Item> = {},
): Item {
  return { ...newShape(shape), ...b, fill: { type: "solid", color }, ...extra };
}
function stable(d: Deck, group: number) {
  let seq = 0;
  const next = () =>
    "a7100000-" +
    String(group).padStart(4, "0") +
    "-4000-8000-" +
    String(++seq).padStart(12, "0");
  d.id = next();
  for (const s of d.slides) {
    s.id = next();
    s.items.forEach((o) => (o.id = next()));
  }
  return d;
}
const safe = box(72, 72, 1136, 576);
function theme(
  title: string,
  description: string,
  group: number,
  palette: string[],
  font: string,
): Template {
  const d = newDeck(title);
  d.theme.palette = palette;
  d.theme.styles.forEach((s) =>
    Object.assign(s.values, { font, color: palette[0] }),
  );
  d.slides = ["Тема занятия", "Что мы узнаем?", "Что запомнилось?"].map(
    (t, i) => ({
      ...newSlide(),
      color: palette[1],
      area: { ...safe },
      items: [
        figure("rect", box(0, 0, 18, 720), palette[2], { role: "decoration" }),
        figure("line", box(72, 659, 1136, 4), palette[2], {
          role: "decoration",
          stroke: palette[2],
          strokeWidth: 2,
        }),
        label(t, box(72, i === 1 ? 76 : 210, 1110, 104), "title"),
        label(
          [
            "Вопрос для начала разговора",
            "Короткое объяснение с примером",
            "Поделитесь одним открытием",
          ][i],
          box(72, i === 1 ? 222 : 348, 1080, 130),
        ),
      ],
    }),
  );
  stable(d, group);
  return validateTemplate({ kind: "presentation", description, deck: d });
}
function layout(
  title: string,
  description: string,
  group: number,
  items: Item[],
): Template {
  const d = newDeck(title);
  d.slides[0].area = { ...safe };
  d.slides[0].items = items;
  stable(d, group);
  return validateTemplate({ kind: "layout", description, deck: d });
}
function card(text: string, x: number, w: number, color: string): Item {
  return figure("rounded", box(x, 230, w, 226), color, {
    text,
    style: "accent",
    overrides: { align: "center", padding: 32 },
    radius: 36,
  });
}
export const builtins: Template[] = [
  theme(
    "Живая природа",
    "Светлая мятная бумага и тёплый акцент для наблюдений и уроков о природе.",
    1,
    ["#163e49", "#eff8f4", "#db9d36"],
    "sans",
  ),
  theme(
    "Книжная полка",
    "Кремовый фон, бордовая линия и книжная антиква для чтения и истории.",
    2,
    ["#522d3d", "#fff8ed", "#a75c60"],
    "serif",
  ),
  layout("Три карточки", "Три признака или примера одинаковой важности.", 3, [
    label("Три примера", box(72, 72, 1136, 100), "title"),
    card("Первый", 72, 352, "#d6eede"),
    card("Второй", 464, 352, "#f7dfb8"),
    card("Третий", 856, 352, "#d6eaf4"),
  ]),
  layout("Сравнение", "Два понятия в параллельных колонках.", 4, [
    label("Сравним", box(72, 72, 1136, 100), "title"),
    card("Первое понятие", 72, 548, "#d6eede"),
    card("Второе понятие", 660, 548, "#d6eaf4"),
  ]),
  layout("Шаг за шагом", "Последовательность из трёх этапов со стрелками.", 5, [
    label("Как это происходит?", box(72, 72, 1136, 100), "title"),
    ...["Начало", "Действие", "Итог"].flatMap((t, i) => [
      card(t, 72 + 410 * i, 300, "#daede7"),
      ...(i < 2
        ? [figure("arrow", box(391 + i * 410, 305, 68, 48), "#368282")]
        : []),
    ]),
  ]),
];
function contour(b: Box, nodes: PathNode[], color: string): Item {
  return figure("path", b, color, { nodes, closed: true, strokeWidth: 0 });
}
function drop(x: number, y: number, w: number, h: number) {
  return contour(
    box(x, y, w, h),
    [
      { x: 50, y: 0, out: { x: 64, y: 33 } },
      { x: 98, y: 68, in: { x: 95, y: 48 }, out: { x: 98, y: 111 } },
      { x: 2, y: 68, in: { x: 2, y: 111 }, out: { x: 2, y: 47 } },
      { x: 50, y: 0, in: { x: 38, y: 26 } },
    ],
    "#3c9dc0",
  );
}
function cloud(x: number, y: number, w: number, h: number) {
  return contour(
    box(x, y, w, h),
    [
      { x: 15, y: 92, out: { x: -7, y: 92 } },
      { x: 18, y: 46, in: { x: -5, y: 43 }, out: { x: 18, y: 15 } },
      { x: 48, y: 28, in: { x: 33, y: 5 }, out: { x: 63, y: -16 } },
      { x: 81, y: 43, in: { x: 85, y: 4 }, out: { x: 106, y: 33 } },
      { x: 86, y: 92, in: { x: 112, y: 92 } },
    ],
    "#b9dfe9",
  );
}
function sun(x: number, y: number, size: number) {
  return figure("circle", box(x, y, size, size), "#f3b547", {
    fill: {
      type: "radial",
      stops: [
        { offset: 0, color: "#ffe6a2" },
        { offset: 1, color: "#f2b244" },
      ],
    },
  });
}
function water(): Deck {
  const d = copyDeck(builtins[0].deck, "Круговорот воды в природе");
  const scenes = [
    [
      "Путешествие\nкапельки",
      "Как капелька возвращается в реку?",
      [cloud(756, 178, 340, 168), drop(840, 380, 100, 154), sun(1044, 94, 132)],
    ],
    [
      "Солнце греет воду",
      "Из реки поднимается невидимый пар.",
      [
        sun(914, 100, 170),
        figure("ellipse", box(692, 497, 480, 78), "#65bad3"),
        figure("arrow", box(769, 345, 136, 64), "#4b9d99", { rotation: -90 }),
        figure("arrow", box(932, 324, 158, 66), "#4b9d99", { rotation: -90 }),
      ],
    ],
    [
      "Рождается облако",
      "В прохладном воздухе пар превращается в маленькие капли.",
      [
        cloud(714, 156, 445, 264),
        drop(824, 462, 38, 56),
        drop(921, 448, 46, 64),
        drop(1026, 470, 36, 52),
      ],
    ],
    [
      "Дождик над рекой",
      "Капли становятся крупнее и падают на землю.",
      [
        cloud(717, 146, 414, 188),
        drop(766, 380, 56, 88),
        drop(904, 350, 68, 108),
        drop(1044, 399, 52, 84),
        figure("ellipse", box(685, 530, 482, 60), "#68b9cf"),
      ],
    ],
    [
      "И снова в путь!",
      "Ручейки несут воду в реку. Что сделает солнышко дальше?",
      [
        sun(974, 102, 145),
        cloud(735, 188, 252, 134),
        drop(852, 372, 72, 112),
        figure("arrow", box(968, 416, 134, 57), "#438b88", { rotation: -58 }),
      ],
    ],
  ] as const;
  const base = d.slides;
  d.slides = scenes.map(([title, body, art], i) => {
    const s = structuredClone(
      base[i === 0 ? 0 : i === scenes.length - 1 ? 2 : 1],
    );
    s.kind = i === 0 ? "title" : i === 4 ? "end" : "normal";
    s.items = [
      ...s.items.filter((o) => o.role === "decoration"),
      label(
        "ПУТЕШЕСТВИЕ ВОДЫ   /   " + String(i + 1).padStart(2, "0"),
        box(72, 100, 620, 48),
        "caption",
        { overrides: { size: 23, tracking: 2, color: "#38716f", bold: true } },
      ),
      label(title, box(72, 208, 607, 198), "title", {
        overrides: { size: 67, leading: 1.08 },
      }),
      label(body, box(76, 426, 562, 150), "body", {
        overrides: { size: 36, leading: 1.25 },
      }),
      ...art,
    ];
    s.notes = [
      "Спросите, видели ли дети, как высыхает лужа.",
      "Попросите показать руками, куда поднимается пар.",
      "Обсудите, из чего состоит облако.",
      "Покажите пальцами, как капли летят вниз.",
      "Предложите рассказать путешествие заново.",
    ][i];
    return s;
  });
  return validateDeck(stable(d, 9));
}
export const waterExample = water();

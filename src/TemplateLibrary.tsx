import { useRef, useState } from "react";
import { Copy, Plus, Upload } from "lucide-react";
import { Stage } from "./Stage";
import { copyDeck, builtins, validateTemplate, type Template } from "./catalog";
import { newDeck, MAX_DOCUMENT_BYTES, readJSON, type Deck } from "./model";
import {
  deleteTemplate,
  saveLocal,
  syncTemplate,
  type CatalogRow,
} from "./templateStore";
import { download } from "./instructions";
type Props = {
  kind: Template["kind"];
  setKind: (kind: Template["kind"]) => void;
  rows: CatalogRow[];
  allowed: boolean;
  onlineOwner: boolean;
  edit: (t: Template, row?: CatalogRow) => void;
  create: (d: Deck) => Promise<void>;
  view: (d: Deck) => void;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
};
export function TemplateLibrary({
  kind,
  setKind,
  rows,
  allowed,
  onlineOwner,
  edit,
  create,
  view,
  refresh,
  notice,
}: Props) {
  const [busy, working] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function act(fn: () => Promise<void>) {
    working(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      working(false);
    }
  }
  return (
    <section className="template-library">
      <div className="catalog-bar">
        <div className="catalog-tabs">
          {(["presentation", "layout"] as const).map((k, i) => (
            <button
              className={kind === k ? "active" : ""}
              key={k}
              onClick={() => setKind(k)}
            >
              {i ? "Компоновки" : "Презентации"}
            </button>
          ))}
        </div>
        {allowed && (
          <>
            <button
              className="secondary"
              onClick={() => {
                const d =
                  kind === "presentation"
                    ? copyDeck(builtins[0].deck, "Новый шаблон")
                    : newDeck("Новая компоновка");
                edit({ kind, description: "", deck: d });
              }}
            >
              <Plus size={16} />
              Создать шаблон
            </button>
            <button className="secondary" onClick={() => file.current?.click()}>
              <Upload size={16} />
              Импорт шаблона
            </button>
          </>
        )}
      </div>
      <div className="template-grid">
        {rows
          .filter((r) => r.template.kind === kind)
          .map((row) => {
            const t = row.template,
              d = t.deck;
            return (
              <article className="template-card" key={d.id}>
                <button
                  className="template-cover"
                  aria-label={"Просмотреть " + d.title}
                  onClick={() => view(d)}
                >
                  <Stage slide={d.slides[0]} deck={d} />
                </button>
                <div className="template-info">
                  <small>
                    {row.builtin
                      ? "Встроенный"
                      : row.entry?.dirty
                        ? row.entry.cloudRevision
                          ? "Есть локальные изменения"
                          : "На устройстве"
                        : row.remote
                          ? "На устройстве и в облаке"
                          : "На устройстве"}
                  </small>
                  <h2>{d.title}</h2>
                  {t.description && <p>{t.description}</p>}
                  {allowed && (
                    <fieldset disabled={busy}>
                      <div className="catalog-actions">
                        {kind === "presentation" && (
                          <button
                            className="primary"
                            onClick={() => act(() => create(copyDeck(d)))}
                          >
                            Создать презентацию
                          </button>
                        )}
                        <button
                          className="secondary"
                          onClick={() =>
                            edit(
                              row.builtin
                                ? {
                                    ...t,
                                    deck: copyDeck(d, d.title + " — копия"),
                                  }
                                : structuredClone(t),
                              row.builtin ? undefined : row,
                            )
                          }
                        >
                          {row.builtin
                            ? "Редактировать копию"
                            : "Редактировать"}
                        </button>
                        <details>
                          <summary>Действия</summary>
                          <div>
                            <button
                              onClick={() =>
                                act(() =>
                                  saveLocal({
                                    ...t,
                                    deck: copyDeck(d, d.title + " — копия"),
                                  }),
                                )
                              }
                            >
                              <Copy size={15} />
                              Копировать
                            </button>
                            <button
                              onClick={() =>
                                download(
                                  d.title + ".atlas.json",
                                  JSON.stringify(validateTemplate(t), null, 2),
                                )
                              }
                            >
                              Экспорт шаблона
                            </button>
                            {!row.builtin && (
                              <>
                                <button
                                  onClick={() => {
                                    const title = prompt(
                                      "Название шаблона",
                                      d.title,
                                    )?.trim();
                                    if (title)
                                      void act(() =>
                                        saveLocal(
                                          { ...t, deck: { ...d, title } },
                                          row,
                                        ),
                                      );
                                  }}
                                >
                                  Переименовать
                                </button>
                                {onlineOwner && (
                                  <button
                                    onClick={() => act(() => syncTemplate(row))}
                                  >
                                    Сохранить в облаке
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Удалить шаблон «" +
                                          d.title +
                                          "» и его сохранённые копии? Созданные уроки сохранятся.",
                                      )
                                    )
                                      void act(() => deleteTemplate(row));
                                  }}
                                >
                                  Удалить шаблон
                                </button>
                              </>
                            )}
                          </div>
                        </details>
                      </div>
                    </fieldset>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      <input
        hidden
        type="file"
        ref={file}
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void act(async () => {
            if (f.size > MAX_DOCUMENT_BYTES)
              throw new Error("Шаблон превышает 64 МиБ.");
            const t = validateTemplate(readJSON(await f.text()));
            await saveLocal({ ...t, deck: copyDeck(t.deck) });
            setKind(t.kind);
          });
        }}
      />
    </section>
  );
}

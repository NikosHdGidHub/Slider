import { useHistory } from "./StudioTools";
import { GridDesigner } from "./GridDesigner";
import { templateFrom } from "./catalog";
import { templateInstructions } from "./instructions";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Library,
  Globe2,
  BookOpenText,
  Plus,
  Upload,
  Play,
  ArrowUpRight,
  Monitor,
  UserRound,
  Layers3,
  FolderOpen,
  FileJson,
  Trash2,
  Link2,
  LogOut,
  CloudOff,
  Menu,
  X,
  ChevronRight,
  Compass,
} from "lucide-react";
import { newDeck, validateDeck, type Deck, MAX_DOCUMENT_BYTES } from "./model";
import { embedImages } from "./media";
import { adminId, client, listPublished, readPublic, unpublish } from "./cloud";
import { entries, saveEntry, type Entry } from "./storage";
import { publish } from "./publication";
import { collectStyles } from "./styleLibrary";
import { TemplateLibrary } from "./TemplateLibrary";
import { ImportPreview } from "./ImportPreview";
import { builtins, validateTemplate, type Template } from "./catalog";
import { getCatalog, saveLocal, type CatalogRow } from "./templateStore";
import { instructions, download } from "./instructions";
import { Editor } from "./Editor";
import { Viewer } from "./Viewer";
import { Stage } from "./Stage";
import { example } from "./example";
import relief from "./assets/relief.webp";
import { registerShell, ensureShell } from "./offline";
import guide from "../docs/USER_GUIDE.md?raw";
import "./style.css";

registerShell();
const localMode =
  !client && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
const ownerKey = "atlas-owner-" + adminId;
const link = (id: string) => location.href.split("#")[0] + "#p/" + id;
const errorText = (err: unknown) =>
  err instanceof Error ? err.message : "Не удалось выполнить действие.";
function App() {
  const [owner, setOwner] = useState(false),
    [list, setList] = useState<Entry[]>([]),
    [page, setPage] = useState("library"),
    [drawer, setDrawer] = useState(false);
  const [doc, setDoc] = useState<Deck | null>(null),
    [watch, setWatch] = useState<Deck | null>(null),
    [status, setStatus] = useState("Сохранено");
  const current = useRef<Deck | null>(null),
    rev = useRef(0),
    queue = useRef(Promise.resolve()),
    failure = useRef<unknown>(null);
  const [modal, setModal] = useState(""),
    [message, notice] = useState(""),
    [busy, setBusy] = useState(""),
    [value, setValue] = useState(""),
    [pw, password] = useState("");
  const [pubs, setPubs] = useState<string[]>([]),
    [publicError, pubError] = useState(""),
    [hash, setHash] = useState(location.hash),
    [publicDeck, setPublicDeck] = useState<Deck | null>(null);
  const [online, setOnline] = useState(navigator.onLine),
    [libraryError, libError] = useState(""),
    importer = useRef<HTMLInputElement>(null);
  const allowed = localMode || owner;
  const [catalog, setCatalog] = useState<CatalogRow[]>(
    builtins.map((template) => ({ template, builtin: true })),
  );
  const [catalogKind, setCatalogKind] =
    useState<Template["kind"]>("presentation");
  const [art, setArt] = useState(false);
  const [scope, setScope] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<{
    t: Template;
    row?: CatalogRow;
  } | null>(null);
  const templateHistory = useHistory(
    editingTemplate?.t,
    (t) => {
      if (t)
        setEditingTemplate((v) =>
          v && v.t.deck.id === t.deck.id ? { ...v, t } : v,
        );
    },
    editingTemplate?.t.deck.id,
  );
  const lessonHistory = useHistory(
    doc,
    (d) => {
      if (d) change((prev) => (prev.id === d.id ? d : prev));
    },
    doc?.id,
  );
  const [preview, setPreview] = useState<Deck | null>(null);
  const access = useRef(allowed);
  access.current = allowed;
  async function refreshCatalog() {
    const result = await getCatalog(allowed, owner);
    if (access.current === allowed) {
      setCatalog(result.rows);
      setScope(result.scope);
    }
    return result;
  }
  const visibleRows = allowed
    ? catalog
    : builtins.map((template) => ({ template, builtin: true }));
  useEffect(() => {
    void refreshCatalog().catch((e) => notice(errorText(e)));
    if (!allowed) setEditingTemplate(null);
  }, [allowed, online]);
  const styleLibrary = useMemo(
    () =>
      collectStyles([
        ...visibleRows.map((r) => r.template.deck),
        ...(allowed ? list.map((e) => e.deck) : []),
      ]),
    [catalog, allowed, list],
  );
  async function getInstructions() {
    await task("Формируем инструкцию…", async () => {
      const result = await refreshCatalog();
      if (allowed !== access.current) return;
      const templates = await Promise.all(
        result.rows.map(async ({ template }) => {
          if (
            !navigator.onLine ||
            !template.deck.slides.some(
              (s) =>
                s.background?.startsWith("https:") ||
                s.items.some((o) => o.src.startsWith("https:")),
            )
          )
            return template;
          try {
            return { ...template, deck: await embedImages(template.deck) };
          } catch {
            return template;
          }
        }),
      );
      if (allowed !== access.current) return;
      const styleCatalog = collectStyles([
        ...templates.map((t) => t.deck),
        ...(allowed ? (await entries()).map((e) => e.deck) : []),
      ]);
      download(
        page === "templates"
          ? "atlas-template-instructions.txt"
          : "atlas-presentation-instructions.txt",
        page === "templates"
          ? templateInstructions(templates, result.scope, styleCatalog)
          : instructions(templates, result.scope, styleCatalog),
        "text/plain",
      );
      notice(result.scope + ". Инструкция скачана.");
    });
  }
  async function refresh() {
    setList(await entries());
    libError("");
  }
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notice(errorText(e));
    } finally {
      setBusy("");
    }
  }
  function dialog(name: string) {
    setPreview(null);
    setValue("");
    password("");
    setModal(name);
  }
  function navigate(next: string) {
    setPage(next);
    setDrawer(false);
  }
  useEffect(() => {
    const network = () => setOnline(navigator.onLine),
      route = () => setHash(location.hash);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("hashchange", route);
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("hashchange", route);
    };
  }, []);
  useEffect(() => {
    if (!client) return;
    if (!online && localStorage.getItem(ownerKey) === "yes") setOwner(true);
    const { data } = client.auth.onAuthStateChange((evt, s) => {
      const ok = s?.user.id.toLowerCase() === adminId;
      if (ok) localStorage.setItem(ownerKey, "yes");
      if (evt === "SIGNED_OUT" && navigator.onLine)
        localStorage.removeItem(ownerKey);
      setOwner(
        ok || (!navigator.onLine && localStorage.getItem(ownerKey) === "yes"),
      );
    });
    return () => data.subscription.unsubscribe();
  }, [online]);
  useEffect(() => {
    if (allowed) refresh().catch((e) => libError(errorText(e)));
    else {
      setList([]);
      setDoc(null);
      current.current = null;
    }
  }, [allowed]);
  useEffect(() => {
    let live = true;
    pubError("");
    setPublicDeck(null);
    if (hash.startsWith("#p/"))
      readPublic(hash.slice(3))
        .then(validateDeck)
        .then((d) => {
          if (live) setPublicDeck(d);
        })
        .catch((e) => {
          if (live) pubError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [hash]);
  useEffect(() => {
    if (page === "published" && owner)
      listPublished()
        .then(setPubs)
        .catch((e) => notice(errorText(e)));
  }, [page, owner]);
  function open(d: Deck, revision: number) {
    current.current = d;
    rev.current = revision;
    queue.current = Promise.resolve();
    failure.current = null;
    setStatus("Сохранено");
    setDoc(d);
  }
  function change(fn: (d: Deck) => Deck) {
    const prev = current.current;
    if (!prev) return;
    const next = fn(prev);
    current.current = next;
    setDoc(next);
    setStatus("Сохранение…");
    const expected = rev.current++;
    queue.current = queue.current.then(async () => {
      if (failure.current) return;
      try {
        await saveEntry(next, expected);
        if (current.current === next) setStatus("Сохранено");
      } catch (e) {
        failure.current = e;
        setStatus("Ошибка записи");
        notice(errorText(e));
      }
    });
  }
  async function closeEditor() {
    await queue.current;
    if (
      failure.current &&
      !confirm("Последние изменения не записаны. Выйти без сохранения?")
    )
      return;
    current.current = null;
    setDoc(null);
    await refresh();
  }
  async function insert(d: Deck) {
    await saveEntry(d, 0);
    await refresh();
    open(d, 1);
    setModal("");
  }
  function need(name: string) {
    dialog(allowed ? name : "login");
  }
  async function importData(raw: string) {
    const d = validateDeck(raw);
    const used = new Set<string | undefined>(
      d.theme.styles.map((s) => s.values.font),
    );
    for (const s of d.slides)
      for (const o of s.items) {
        used.add(o.overrides?.font);
        o.paragraphs?.forEach((p) => p.runs.forEach((r) => used.add(r.font)));
      }
    for (const g of [
      ...Object.values(d.master.schemes),
      ...d.slides.flatMap((s) => (s.structure ? [s.structure] : [])),
    ])
      for (const c of g.cells) used.add(c.style?.font);
    for (const f of styleLibrary.fonts)
      if (used.has(f.id) && !d.resources.fonts.some((a) => a.id === f.id))
        d.resources.fonts.push(structuredClone(f));
    if (new Blob([JSON.stringify(d)]).size > MAX_DOCUMENT_BYTES)
      throw new Error("Со встроенными шрифтами файл превышает 64 МиБ.");
    validateDeck(d);
    setValue(raw);
    setPreview(d);
    setModal("preview");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await task("Подождите…", async () => {
      if (modal === "login") {
        if (!client)
          throw new Error(
            "Настройте Supabase по инструкции SUPABASE_SETUP.md. Для локальной работы запустите проект на localhost.",
          );
        const { data, error } = await client.auth.signInWithPassword({
          email: value.trim(),
          password: pw,
        });
        if (error)
          throw new Error(
            "Не удалось войти. Проверьте почту, пароль и подключение.",
          );
        if (data.user?.id !== adminId) {
          await client.auth.signOut({ scope: "local" });
          throw new Error("Для этого аккаунта доступ к редактору закрыт.");
        }
        setModal("");
      } else if (modal === "create") await insert(newDeck(value));
      else if (modal === "import") await importData(value);
    });
  }
  async function act(id: "export" | "publish" | "offline") {
    const d = current.current;
    if (!d) return;
    await task(
      id === "publish"
        ? "Публикация…"
        : id === "offline"
          ? "Проверяем файлы…"
          : "Подготовка JSON…",
      async () => {
        if (id === "export") {
          const data = validateDeck(d),
            file = new Blob([JSON.stringify(data)], {
              type: "application/json",
            });
          if (file.size > MAX_DOCUMENT_BYTES)
            throw new Error(
              "Для импорта файл должен быть меньше 64 МБ. Разделите занятие.",
            );
          const url = URL.createObjectURL(file),
            a = document.createElement("a");
          a.href = url;
          a.download =
            (d.title.replace(/[\\/]/g, "_") || "Методичка") + ".json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } else if (id === "offline") {
          await ensureShell();
          const prepared = await embedImages(d);
          await queue.current;
          if (current.current !== d)
            throw new Error("Методичка изменилась. Повторите подготовку.");
          change(() => prepared);
          await queue.current;
          if (failure.current) throw failure.current;
          notice(
            "Готово к офлайн-показу. Приложение и все изображения сохранены.",
          );
        } else {
          if (!owner)
            throw new Error(
              "Для публикации подключите Supabase и войдите как владелец.",
            );
          if (
            d.resources.fonts.length &&
            !confirm(
              "Шрифты будут встроены в публичную презентацию и доступны зрителям. Лицензия разрешает распространение?",
            )
          )
            return;
          await publish(d);
          setPubs((p) => Array.from(new Set([...p, d.id])));
          setValue(link(d.id));
          setModal("link");
        }
      },
    );
  }
  async function remove(en: Entry) {
    if (
      !confirm(
        "Удалить локальную методичку «" +
          en.deck.title +
          "»? Публикация останется доступна.",
      )
    )
      return;
    await task("Удаление…", async () => {
      await saveEntry(en.deck, en.revision, true);
      await refresh();
    });
  }
  async function logout() {
    await task("Выход…", async () => {
      if (client) {
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      localStorage.removeItem(ownerKey);
      setOwner(false);
      setPubs([]);
      navigate("library");
    });
  }
  const nav = [
    ["library", "Мои методички", Library],
    ["templates", "Шаблоны", Layers3],
    ["published", "Опубликованные", Globe2],
    ["guide", "Руководство", BookOpenText],
  ] as const;
  const home = (
    <div className="shell">
      <aside className={"sidebar " + (drawer ? "opened" : "")}>
        <div className="brand">
          <span className="brand-icon">
            <BookOpen />
          </span>
          Атлас уроков
        </div>
        <div className="side-rule" />
        <small className="nav-label">Рабочее пространство</small>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <div className="avatar">
            <UserRound size={20} />
          </div>
          <div>
            <b>
              {localMode
                ? "Локальный режим"
                : owner
                  ? "Преподаватель"
                  : "Гостевой режим"}
            </b>
            <small>
              {localMode
                ? "На этом устройстве"
                : owner
                  ? "Владелец"
                  : "Только просмотр"}
            </small>
          </div>
          {owner ? (
            <button title="Выйти" onClick={logout}>
              <LogOut size={17} />
            </button>
          ) : (
            !localMode && (
              <button title="Войти" onClick={() => dialog("login")}>
                <ArrowUpRight size={17} />
              </button>
            )
          )}
        </div>
      </aside>
      <div className="desk">
        <header className="top">
          <button
            className="hamb"
            aria-label="Навигация"
            onClick={() => setDrawer(!drawer)}
          >
            <Menu />
          </button>
          <span>Рабочее пространство</span>
          <ChevronRight size={14} />
          <b>{nav.find((n) => n[0] === page)?.[1]}</b>
          <div className="device">
            {online ? <Monitor size={15} /> : <CloudOff size={15} />}{" "}
            {online ? "На этом устройстве" : "Офлайн"}
          </div>
        </header>
        <main className="library">
          <div className="title-row">
            <h1>
              {page === "library"
                ? "Мои методички"
                : page === "guide"
                  ? "Руководство"
                  : page === "templates"
                    ? "Шаблоны"
                    : "Опубликованные"}
            </h1>
            {(page === "library" || page === "templates") && (
              <button
                className="secondary instructions-button"
                onClick={getInstructions}
              >
                <FileJson size={17} />
                {page === "templates"
                  ? "Скачать инструкцию для генерации шаблона"
                  : "Скачать инструкцию для генерации презентации"}
              </button>
            )}
            {page === "library" && (
              <button className="primary" onClick={() => need("create")}>
                <Plus size={18} />
                Создать методичку
              </button>
            )}
          </div>
          {page === "library" ? (
            <>
              <article className="feature">
                <div className="feature-copy">
                  <div className="feature-tag">
                    <Compass size={15} />
                    Пример методички
                  </div>
                  <h2>
                    Как читать
                    <br />
                    <em>рельеф</em>
                  </h2>
                  <div className="feature-meta">
                    <span>География</span>
                    <i />4 слайда
                  </div>
                  <button onClick={() => setWatch(example)}>
                    <Play size={15} fill="currentColor" />
                    Открыть пример
                  </button>
                </div>
                <div
                  className="plate"
                  style={{ backgroundImage: "url(" + relief + ")" }}
                >
                  <span className="plate-north">
                    N<br />↑
                  </span>
                  <div className="scale-line">
                    0<span>1 км</span>
                  </div>
                </div>
              </article>
              <section className="collection">
                <div className="section-title">
                  <h2>
                    Локальная библиотека <span>{list.length}</span>
                  </h2>
                  <button className="secondary" onClick={() => need("import")}>
                    <Upload size={16} />
                    Импорт JSON
                  </button>
                </div>
                {libraryError ? (
                  <p role="alert">{libraryError}</p>
                ) : list.length ? (
                  <div className="cards">
                    {list.map((en) => (
                      <article className="card" key={en.deck.id}>
                        <button
                          className="card-open"
                          onClick={() => open(en.deck, en.revision)}
                        >
                          <div className="card-preview">
                            <Stage deck={en.deck} slide={en.deck.slides[0]} />
                          </div>
                          <b>{en.deck.title}</b>
                          <small>
                            {en.deck.slides.length} слайд. ·{" "}
                            {new Date(en.updated).toLocaleDateString("ru-RU")}
                          </small>
                        </button>
                        <button
                          className="icon"
                          title="Удалить локальную методичку"
                          onClick={() => remove(en)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <span className="folder">
                      <FolderOpen strokeWidth={1.4} />
                    </span>
                    <h3>
                      {allowed
                        ? "Здесь появятся ваши методички"
                        : "Библиотека преподавателя"}
                    </h3>
                    <p>
                      {allowed
                        ? "Создайте первую методичку или импортируйте готовый JSON."
                        : "Войдите в аккаунт владельца, чтобы открыть локальные методички."}
                    </p>
                    {!allowed && (
                      <button
                        className="secondary"
                        onClick={() => dialog("login")}
                      >
                        Войти
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : page === "templates" ? (
            <>
              <p className="catalog-scope">{scope}</p>
              <TemplateLibrary
                kind={catalogKind}
                setKind={setCatalogKind}
                rows={visibleRows}
                allowed={allowed}
                onlineOwner={owner && online}
                create={insert}
                view={setWatch}
                edit={(t, row) => {
                  setArt(false);
                  setEditingTemplate({ t, row });
                }}
                refresh={async () => {
                  await refreshCatalog();
                }}
                notice={notice}
              />
            </>
          ) : page === "guide" ? (
            <article className="guide">
              {guide
                .split("\n")
                .filter(Boolean)
                .filter((l) => !l.startsWith("# "))
                .map((line, i) =>
                  line.startsWith("## ") ? (
                    <h2 key={i}>{line.slice(3)}</h2>
                  ) : (
                    <p key={i}>{line}</p>
                  ),
                )}
            </article>
          ) : (
            <section>
              {owner ? (
                pubs.length ? (
                  pubs.map((id) => (
                    <div className="pub" key={id}>
                      <Globe2 />
                      <div>
                        <strong>
                          {list.find((en) => en.deck.id === id)?.deck.title ||
                            "Опубликованная методичка"}
                        </strong>
                        <a href={link(id)}>{link(id)}</a>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm("Снять методичку с публикации?"))
                            task("Снимаем с публикации…", async () => {
                              await unpublish(id);
                              setPubs(await listPublished());
                            });
                        }}
                      >
                        Снять с публикации
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    <Globe2 />
                    <h3>Публикаций пока нет</h3>
                    <p>
                      В редакторе откройте меню действий и выберите
                      «Опубликовать».
                    </p>
                  </div>
                )
              ) : (
                <div className="empty">
                  <Globe2 />
                  <h3>Публикации владельца</h3>
                  <p>Гости открывают занятия по прямой ссылке.</p>
                  <button className="secondary" onClick={() => dialog("login")}>
                    Вход преподавателя
                  </button>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
  return (
    <>
      {hash.startsWith("#p/") ? (
        publicDeck ? (
          <Viewer
            initialMode="slides"
            deck={publicDeck}
            onClose={() => (location.hash = "")}
          />
        ) : (
          <main className="empty">
            <BookOpen />
            <p>{publicError || "Открываем методичку…"}</p>
            <button onClick={() => (location.hash = "")}>В библиотеку</button>
          </main>
        )
      ) : watch ? (
        <Viewer deck={watch} onClose={() => setWatch(null)} />
      ) : editingTemplate?.t.format === 3 && !art && allowed ? (
        <GridDesigner
          template={editingTemplate.t}
          set={templateHistory.set}
          history={templateHistory}
          notice={notice}
          art={() => setArt(true)}
          back={() => {
            if (
              confirm(
                "Закрыть конструктор? Изменения после последнего сохранения будут потеряны.",
              )
            )
              setEditingTemplate(null);
          }}
          save={() =>
            task("Сохраняем шаблон…", async () => {
              const t = validateTemplate(editingTemplate.t);
              t.deck.master.name = t.deck.title;
              await saveLocal(t, editingTemplate.row);
              await refreshCatalog();
              setEditingTemplate(null);
              setCatalogKind(t.kind);
              navigate("templates");
              notice("Шаблон сохранён.");
            })
          }
        />
      ) : editingTemplate && allowed ? (
        <Editor
          key={editingTemplate.t.deck.id}
          history={templateHistory}
          gridTemplateKind={
            editingTemplate.t.format === 3 ? editingTemplate.t.kind : undefined
          }
          deck={editingTemplate.t.deck}
          status="Редактор шаблона"
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          description={editingTemplate.t.description}
          describe={(description) =>
            templateHistory.update((t) => t && { ...t, description })
          }
          change={(fn) =>
            templateHistory.update((t) => t && { ...t, deck: fn(t.deck) })
          }
          back={() => {
            if (art) {
              setArt(false);
              return;
            }
            if (confirm("Закрыть редактор без сохранения шаблона?"))
              setEditingTemplate(null);
          }}
          saveTemplate={() =>
            task("Сохраняем шаблон…", async () => {
              const t = validateTemplate(editingTemplate.t);
              await saveLocal(t, editingTemplate.row);
              await refreshCatalog();
              setEditingTemplate(null);
              setCatalogKind(t.kind);
              navigate("templates");
              notice("Шаблон сохранён.");
            })
          }
          view={() => setWatch(editingTemplate.t.deck)}
          action={() => {}}
          notice={notice}
        />
      ) : doc && allowed ? (
        <Editor
          key={doc.id}
          history={lessonHistory}
          saveAs={() =>
            task("Создаём шаблон…", async () => {
              await queue.current;
              if (failure.current) throw failure.current;
              const t = templateFrom(current.current!);
              await saveLocal(t);
              const result = await refreshCatalog();
              const row = result.rows.find(
                (r) => r.template.deck.id === t.deck.id,
              );
              if (!row) throw Error("Не удалось открыть сохранённый шаблон");
              setDoc(null);
              current.current = null;
              setCatalogKind("presentation");
              navigate("templates");
              setArt(false);
              setEditingTemplate({ t, row });
            })
          }
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          deck={doc}
          change={(fn) => lessonHistory.update((d) => d && fn(d))}
          status={status}
          back={() => task("Сохранение…", closeEditor)}
          view={() => setWatch(doc)}
          action={act}
          notice={notice}
        />
      ) : (
        home
      )}
      {modal && (
        <div className="overlay">
          <section
            className={
              "dialog " + (modal === "preview" ? "import-preview" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="dismiss icon"
              aria-label="Закрыть"
              onClick={() => setModal("")}
            >
              <X size={19} />
            </button>
            <div className="dialog-icon">
              {modal === "import" ? (
                <FileJson />
              ) : modal === "link" ? (
                <Link2 />
              ) : modal === "login" ? (
                <UserRound />
              ) : (
                <Layers3 />
              )}
            </div>
            <h2 id="dialog-title">
              {
                {
                  preview: "Предпросмотр импорта",
                  create: "Новая методичка",
                  import: "Импорт JSON",
                  login: "Вход преподавателя",
                  link: "Методичка опубликована",
                }[modal]
              }
            </h2>
            {modal === "preview" && preview ? (
              <ImportPreview
                deck={preview}
                back={() => setModal("import")}
                accept={() =>
                  task("Импорт…", async () => {
                    await insert({ ...preview, id: crypto.randomUUID() });
                    setPreview(null);
                  })
                }
              />
            ) : modal === "link" ? (
              <>
                <p>По ссылке доступны слайды и заметки преподавателя.</p>
                <input
                  readOnly
                  value={value}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="primary"
                  onClick={() =>
                    task("Копирование…", async () => {
                      await navigator.clipboard.writeText(value);
                      notice("Ссылка скопирована.");
                    })
                  }
                >
                  Скопировать ссылку
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                {modal === "import" ? (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => importer.current?.click()}
                    >
                      <Upload />
                      Выбрать файл JSON
                    </button>
                    <label>
                      Или вставьте JSON
                      <textarea
                        required
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    {modal === "login" ? "Электронная почта" : "Название"}
                    <input
                      autoFocus
                      required
                      type={modal === "login" ? "email" : "text"}
                      maxLength={200}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={
                        modal === "login"
                          ? "teacher@example.org"
                          : "Например, Тестовый урок"
                      }
                    />
                  </label>
                )}
                {modal === "login" && (
                  <label>
                    Пароль
                    <input
                      required
                      type="password"
                      autoComplete="current-password"
                      value={pw}
                      onChange={(e) => password(e.target.value)}
                    />
                  </label>
                )}
                <button className="primary" type="submit">
                  {modal === "create"
                    ? "Создать"
                    : modal === "import"
                      ? "Импортировать"
                      : "Войти"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
      <input
        type="file"
        hidden
        ref={importer}
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            task("Импорт…", async () => {
              if (f.size > MAX_DOCUMENT_BYTES)
                throw new Error("Файл превышает 64 МБ.");
              const raw = await f.text();
              setValue(raw);
              await importData(raw);
            });
        }}
      />
      {busy && (
        <div className="working" role="status">
          {busy}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button aria-label="Закрыть уведомление" onClick={() => notice("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

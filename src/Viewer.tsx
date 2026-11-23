import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Deck } from "./model";
import { Stage } from "./Stage";

interface ViewerProps {
  deck: Deck;
  onClose: () => void;
  initialMode?: "teacher" | "slides";
}

export function Viewer({
  deck,
  onClose,
  initialMode = "teacher",
}: ViewerProps) {
  const [mode, setMode] = useState(initialMode);
  const [index, setIndex] = useState(0);
  const [screen, setScreen] = useState<Window | null>(null);
  const [error, setError] = useState("");
  const [tools, setTools] = useState(true);
  const surface = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slide = deck.slides[index];
  const go = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(deck.slides.length - 1, Math.max(0, i + delta))),
    [deck.slides.length],
  );
  const showControls = useCallback(() => {
    setTools(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTools(false), 2200);
  }, []);
  useEffect(() => {
    showControls();
    return () => clearTimeout(timer.current);
  }, [mode, showControls]);

  async function full(el: HTMLElement) {
    try {
      if (!el.ownerDocument.fullscreenElement) await el.requestFullscreen();
    } catch {
      setError(
        "Браузер не разрешил полноэкранный режим. Используйте F11 в окне показа.",
      );
    }
  }
  function present() {
    setMode("slides");
    if (surface.current) void full(surface.current);
  }
  function teacher() {
    setMode("teacher");
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
  }
  function projector() {
    if (screen && !screen.closed) {
      screen.focus();
      return;
    }
    const win = window.open("", "_blank", "popup,width=1120,height=700");
    if (!win) {
      setError(
        "Разрешите всплывающие окна для этого сайта и снова откройте экран учеников.",
      );
      return;
    }
    const doc = win.document;
    doc.documentElement.lang = "ru";
    doc.title = deck.title + " — Экран учеников";
    const base = doc.createElement("base");
    base.href = document.baseURI;
    doc.head.append(base);
    document
      .querySelectorAll('link[rel="stylesheet"],style')
      .forEach((el) => doc.head.append(el.cloneNode(true)));
    doc.body.className = "atlas-projector";
    setError("");
    setScreen(win);
  }

  useEffect(() => {
    if (!screen) return;
    const closed = () => setScreen(null);
    const closeWindow = () => screen.close();
    const projectKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      }
      if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
      if (e.key.toLowerCase() === "f")
        void full(screen.document.documentElement);
    };
    screen.addEventListener("pagehide", closed);
    screen.addEventListener("keydown", projectKey);
    window.addEventListener("pagehide", closeWindow);
    return () => {
      screen.removeEventListener("pagehide", closed);
      screen.removeEventListener("keydown", projectKey);
      window.removeEventListener("pagehide", closeWindow);
      screen.close();
    };
  }, [screen, go]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (
        ["ArrowRight", "PageDown"].includes(e.key) ||
        (e.key === " " && !(e.target instanceof HTMLButtonElement))
      ) {
        e.preventDefault();
        go(1);
      }
      if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
      if (e.key === "Home") {
        e.preventDefault();
        setIndex(0);
      }
      if (e.key === "End") {
        e.preventDefault();
        setIndex(deck.slides.length - 1);
      }
      if (e.key === "Escape") {
        if (mode === "slides") teacher();
        else onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [deck.slides.length, go, mode, onClose]);

  const navigation = (
    <>
      <button
        type="button"
        aria-label="Предыдущий слайд"
        disabled={index === 0}
        onClick={() => go(-1)}
      >
        Назад
      </button>
      <span>
        {index + 1} / {deck.slides.length}
      </span>
      <button
        type="button"
        aria-label="Следующий слайд"
        disabled={index === deck.slides.length - 1}
        onClick={() => go(1)}
      >
        Далее
      </button>
    </>
  );

  return (
    <section
      ref={surface}
      className={"atlas-viewer atlas-viewer-" + mode}
      aria-label="Показ методички"
      onPointerMove={mode === "slides" ? showControls : undefined}
    >
      {mode === "teacher" ? (
        <>
          <header className="atlas-viewer-head">
            <div>
              <small>Режим преподавателя</small>
              <h1>{deck.title}</h1>
            </div>
            <div className="atlas-viewer-actions">
              <button type="button" onClick={projector}>
                {screen ? "К окну проектора" : "Открыть экран учеников"}
              </button>
              <button className="atlas-primary" type="button" onClick={present}>
                Только слайды
              </button>
              <button type="button" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </header>
          <div className="atlas-teacher-grid">
            <div className="atlas-preview-panel">
              <Stage deck={deck} slide={slide} />
              <nav className="atlas-switch" aria-label="Листать слайды">
                {navigation}
              </nav>
            </div>
            <aside className="atlas-note">
              <small>Слайд {index + 1}</small>
              <h2>Заметки преподавателя</h2>
              <p>
                {slide.notes || "Для этого слайда заметки пока не добавлены."}
              </p>
            </aside>
          </div>
          <nav className="atlas-slide-strip" aria-label="Выбор слайда">
            {deck.slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={"Открыть слайд " + (i + 1)}
                aria-current={i === index ? "step" : undefined}
                onClick={() => setIndex(i)}
              >
                <Stage deck={deck} slide={s} />
                <span>{i + 1}</span>
              </button>
            ))}
          </nav>
        </>
      ) : (
        <>
          <div
            className="atlas-screen-frame"
            onClick={() => {
              go(1);
              showControls();
            }}
          >
            <Stage deck={deck} slide={slide} />
          </div>
          <nav
            className={"atlas-slide-tools" + (tools ? "" : " atlas-tools-idle")}
            aria-label="Управление показом"
            onFocus={showControls}
          >
            {navigation}
            <button
              type="button"
              onClick={() => surface.current && void full(surface.current)}
            >
              На весь экран
            </button>
            <button type="button" onClick={teacher}>
              Заметки
            </button>
            <button type="button" onClick={onClose}>
              Закрыть
            </button>
          </nav>
        </>
      )}
      {error && (
        <div className="atlas-viewer-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setError("")}>
            Понятно
          </button>
        </div>
      )}
      {screen &&
        !screen.closed &&
        createPortal(
          <div
            className="atlas-screen-frame"
            onDoubleClick={() => void full(screen.document.documentElement)}
          >
            <Stage deck={deck} slide={slide} />
          </div>,
          screen.document.body,
        )}
    </section>
  );
}

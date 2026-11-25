import {
  ArrowLeft,
  ArrowRight,
  Download,
  Maximize,
  PanelRight,
  Presentation,
  X,
} from 'lucide-react'
import { CanvasViewport } from './CanvasViewport'
import { ResizeHandle } from './Workspace'
import { clamp, usePreference } from './workspacePreferences'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { Deck } from './model'
import { Stage } from './Stage'

interface ViewerProps {
  deck: Deck
  onClose: () => void
  initialMode?: 'teacher' | 'slides'
  onPrepare?: (deck: Deck) => Promise<void>
}

export function Viewer({
  deck,
  onClose,
  onPrepare,
  initialMode = 'teacher',
}: ViewerProps) {
  const [mode, setMode] = useState(initialMode)
  const [index, setIndex] = useState(0)
  const [screen, setScreen] = useState<Window | null>(null)
  const [error, setError] = useState('')
  const [tools, setTools] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [notesOpen, setNotesOpen] = usePreference('viewer.notes', true)
  const [notesWidth, setNotesWidth] = usePreference(
    'viewer.notes-width',
    380,
    [240, 720]
  )
  const [notesSize, setNotesSize] = usePreference(
    'viewer.notes-size',
    100,
    [80, 180]
  )
  const surface = useRef<HTMLElement>(null)
  const notes = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const slide = deck.slides[index]
  const go = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(deck.slides.length - 1, Math.max(0, i + delta))),
    [deck.slides.length]
  )
  const showControls = useCallback(() => {
    setTools(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setTools(false), 2200)
  }, [])
  useEffect(() => {
    showControls()
    return () => clearTimeout(timer.current)
  }, [mode, showControls])

  useLayoutEffect(() => {
    if (notes.current) notes.current.scrollTop = 0
    const list = strip.current
    const active = list?.querySelector('[aria-current="step"]')
    if (!list || !active) return
    const bounds = list.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left - 4
    else if (item.right > bounds.right)
      list.scrollLeft += item.right - bounds.right + 4
  }, [index, mode])

  async function full(el: HTMLElement) {
    try {
      if (!el.ownerDocument.fullscreenElement) await el.requestFullscreen()
    } catch {
      setError(
        'Браузер не разрешил полноэкранный режим. Используйте F11 в окне показа.'
      )
    }
  }
  function present() {
    setMode('slides')
    if (surface.current) void full(surface.current)
  }
  function teacher() {
    setMode('teacher')
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
  }
  function projector() {
    if (screen && !screen.closed) {
      screen.focus()
      return
    }
    const win = window.open('', '_blank', 'popup,width=1120,height=700')
    if (!win) {
      setError(
        'Разрешите всплывающие окна для этого сайта и снова откройте экран учеников.'
      )
      return
    }
    const doc = win.document
    doc.documentElement.lang = 'ru'
    doc.title = deck.title + ' — Экран учеников'
    const base = doc.createElement('base')
    base.href = document.baseURI
    doc.head.append(base)
    document
      .querySelectorAll('link[rel="stylesheet"],style')
      .forEach((el) => doc.head.append(el.cloneNode(true)))
    doc.body.className = 'atlas-projector'
    setError('')
    setScreen(win)
  }

  useEffect(() => {
    if (!screen) return
    const closed = () => setScreen(null)
    const closeWindow = () => screen.close()
    const projectKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        go(1)
      }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        go(-1)
      }
      if (e.code === 'KeyF') void full(screen.document.documentElement)
    }
    screen.addEventListener('pagehide', closed)
    screen.addEventListener('keydown', projectKey)
    window.addEventListener('pagehide', closeWindow)
    return () => {
      screen.removeEventListener('pagehide', closed)
      screen.removeEventListener('keydown', projectKey)
      window.removeEventListener('pagehide', closeWindow)
      screen.close()
    }
  }, [screen, go])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (
        e.target instanceof Node &&
        notes.current?.contains(e.target) &&
        [' ', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)
      )
        return
      if (
        ['ArrowRight', 'PageDown'].includes(e.key) ||
        (e.key === ' ' && !(e.target instanceof HTMLButtonElement))
      ) {
        e.preventDefault()
        go(1)
      }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        go(-1)
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setIndex(0)
      }
      if (e.key === 'End') {
        e.preventDefault()
        setIndex(deck.slides.length - 1)
      }
      if (e.key === 'Escape') {
        if (mode === 'slides') teacher()
        else onClose()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [deck.slides.length, go, mode, onClose])

  const navigation = (
    <>
      <button
        type="button"
        aria-label="Предыдущий слайд"
        disabled={index === 0}
        onClick={() => go(-1)}
      >
        <ArrowLeft size={17} />
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
        <ArrowRight size={17} />
      </button>
    </>
  )

  return (
    <section
      ref={surface}
      className={'atlas-viewer atlas-viewer-' + mode}
      aria-label="Показ методички"
      onPointerMove={mode === 'slides' ? showControls : undefined}
    >
      {mode === 'teacher' ? (
        <>
          <header className="atlas-viewer-head">
            <div>
              <small>Режим преподавателя</small>
              <h1 title={deck.title}>{deck.title}</h1>
            </div>
            <div className="atlas-viewer-actions">
              <button
                type="button"
                onClick={projector}
                title={screen ? 'К окну проектора' : 'Открыть экран учеников'}
                aria-label={
                  screen ? 'К окну проектора' : 'Открыть экран учеников'
                }
              >
                <Presentation size={17} />
                <span>
                  {screen ? 'К окну проектора' : 'Открыть экран учеников'}
                </span>
              </button>
              {onPrepare && (
                <button
                  type="button"
                  className="atlas-offline-button"
                  disabled={preparing}
                  title="Подготовить к офлайн-показу"
                  aria-label={
                    preparing
                      ? 'Подготавливаем…'
                      : prepared
                        ? 'Готово к офлайн-показу'
                        : 'Подготовить к офлайн-показу'
                  }
                  onClick={async () => {
                    setPreparing(true)
                    setError('')

                    try {
                      await onPrepare(deck)
                      setPrepared(true)
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : 'Не удалось подготовить методичку.'
                      )
                    } finally {
                      setPreparing(false)
                    }
                  }}
                >
                  <Download size={17} />
                  <span>
                    {preparing
                      ? 'Подготавливаем…'
                      : prepared
                        ? 'Готово к офлайн-показу'
                        : 'Подготовить к офлайн-показу'}
                  </span>
                </button>
              )}
              <button
                className="atlas-primary"
                type="button"
                onClick={present}
                title="Только слайды"
                aria-label="Только слайды"
              >
                <Maximize size={17} />
                <span>Только слайды</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Закрыть"
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div
            className="atlas-teacher-grid"
            data-notes={notesOpen || undefined}
            style={{ '--teacher-notes': notesWidth + 'px' } as CSSProperties}
          >
            <div className="atlas-preview-panel">
              <CanvasViewport>
                <Stage deck={deck} slide={slide} />
              </CanvasViewport>
            </div>
            {notesOpen && (
              <aside className="atlas-note" aria-label="Заметки преподавателя">
                <ResizeHandle
                  side="right"
                  label="Ширина заметок преподавателя"
                  value={notesWidth}
                  min={240}
                  max={720}
                  change={setNotesWidth}
                />
                <div className="atlas-note-head">
                  <h2>Заметки преподавателя</h2>
                  <div role="group" aria-label="Размер текста заметок">
                    <button
                      type="button"
                      aria-label="Уменьшить текст заметок"
                      title="Уменьшить текст заметок"
                      disabled={notesSize <= 80}
                      onClick={() =>
                        setNotesSize(clamp(notesSize - 10, 80, 180))
                      }
                    >
                      A−
                    </button>
                    <output>{notesSize}%</output>
                    <button
                      type="button"
                      aria-label="Увеличить текст заметок"
                      title="Увеличить текст заметок"
                      disabled={notesSize >= 180}
                      onClick={() =>
                        setNotesSize(clamp(notesSize + 10, 80, 180))
                      }
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div
                  ref={notes}
                  className="atlas-note-scroll"
                  tabIndex={0}
                  aria-label="Текст заметок"
                >
                  <p style={{ fontSize: notesSize / 100 + 'rem' }}>
                    {slide.notes ||
                      'Для этого слайда заметки пока не добавлены.'}
                  </p>
                </div>
              </aside>
            )}
          </div>
          <nav className="atlas-switch" aria-label="Листать слайды">
            {navigation}
            <button
              type="button"
              aria-expanded={notesOpen}
              title={notesOpen ? 'Свернуть заметки' : 'Показать заметки'}
              aria-label={notesOpen ? 'Свернуть заметки' : 'Показать заметки'}
              onClick={() => setNotesOpen(!notesOpen)}
            >
              <PanelRight size={17} />
            </button>
          </nav>
          <nav
            ref={strip}
            className="atlas-slide-strip"
            aria-label="Выбор слайда"
          >
            {deck.slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={'Открыть слайд ' + (i + 1)}
                aria-current={i === index ? 'step' : undefined}
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
              go(1)
              showControls()
            }}
          >
            <Stage deck={deck} slide={slide} />
          </div>
          <nav
            className={'atlas-slide-tools' + (tools ? '' : ' atlas-tools-idle')}
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
          {error}{' '}
          <button type="button" onClick={() => setError('')}>
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
          screen.document.body
        )}
    </section>
  )
}

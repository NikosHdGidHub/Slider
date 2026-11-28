import { useEffect, useRef, useState } from 'react'
import { Stage } from './Stage'
import { StylesPanel } from './Properties'
import { defaultMaster } from './grid'
import {
  newSlide,
  validateDeck,
  type Deck,
  type Slide,
  type Item,
} from './model'
import { isTextType, textTypeIds, textTypes } from './textTypes'
import type { StyleLibrary } from './styleLibrary'
import './textStyleManager.css'

const samples: Record<string, string> = {
  header: 'АТЛАС УРОКОВ · ЗАНЯТИЕ 03',
  title: 'Свет и тень',
  subtitle: 'Путешествие в трёхмерный мир',
  description: 'Как свет влияет на форму и объём объектов?',
  text: 'Сегодня мы исследуем свет, создадим тени и проверим результат на практике.',
  caption: 'Рисунок 1. Источник света и объект',
  footer: 'Атлас уроков · 03',
}
const order = [
  'header',
  'title',
  'subtitle',
  'description',
  'text',
  'caption',
  'footer',
]
const boxes = [
  { x: 56, y: 20, w: 1168, h: 48 },
  { x: 56, y: 76, w: 1168, h: 100 },
  { x: 56, y: 184, w: 1168, h: 80 },
  { x: 56, y: 272, w: 1168, h: 90 },
  { x: 56, y: 370, w: 1168, h: 168 },
  { x: 56, y: 546, w: 1168, h: 68 },
  { x: 56, y: 628, w: 1168, h: 64 },
]
export function TextStyleManager({
  deck,
  slide,
  initialStyleId,
  library,
  change,
  close,
  notice,
}: {
  deck: Deck
  slide: Slide
  initialStyleId: string
  library?: StyleLibrary
  change: (fn: (d: Deck) => Deck) => void
  close: () => void
  notice: (message: string) => void
}) {
  const [draft, setDraft] = useState(deck)
  const baseline = useRef(deck)
  const [id, setId] = useState(initialStyleId)
  const [background, setBackground] = useState<
    'white' | 'black' | 'custom' | 'slide' | 'compare'
  >('white')
  const [color, setColor] = useState('#e5f4ef')
  const [page, setPage] = useState(() => {
    const i = deck.theme.styles.findIndex((s) => s.id === initialStyleId)
    return i < 0 ? 0 : 1 + Math.floor(i / 6)
  })
  const [customSamples, setCustomSamples] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const host = useRef<HTMLDialogElement>(null)
  const [previewId] = useState(() => newSlide().id)
  const styles = [
    ...textTypeIds.map((type) => ({ id: type, label: textTypes[type] })),
    ...draft.theme.styles,
  ]
  const selected = styles.find((s) => s.id === id)?.id ?? 'text'
  const custom = draft.theme.styles
  const pages = 1 + Math.ceil(custom.length / 6)
  const actualPage = Math.min(page, pages - 1)
  const changed = draft !== baseline.current
  useEffect(() => {
    const dialog = host.current!
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])
  function choose(next: string) {
    setId(next)
    const index = custom.findIndex((s) => s.id === next)
    setPage(index < 0 ? 0 : 1 + Math.floor(index / 6))
  }
  useEffect(() => {
    const index = custom.findIndex((s) => s.id === selected)
    setPage(index < 0 ? 0 : 1 + Math.floor(index / 6))
  }, [selected, custom.length])
  function cancel() {
    if (
      !changed ||
      window.confirm('Закрыть без применения изменений текстовых стилей?')
    )
      close()
  }
  function apply(finish: boolean) {
    // The draft includes replaced references and imported fonts, not just the theme.
    // Never overwrite a document changed outside this modal.
    if (deck !== baseline.current && deck !== draft) {
      setMessage('Документ изменился. Закройте менеджер и откройте его снова.')
      return
    }
    if (changed) {
      try {
        validateDeck(draft)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
        return
      }
      const previous = baseline.current
      change((latest) => (latest === previous ? draft : latest))
      baseline.current = draft
      notice('Текстовые стили применены.')
      setMessage('Изменения применены.')
    }
    if (finish) close()
  }
  const visible =
    actualPage === 0
      ? order
      : custom.slice((actualPage - 1) * 6, actualPage * 6).map((s) => s.id)
  const items: Item[] = visible.map((styleId, index) => {
    const type = isTextType(styleId) ? styleId : 'text'
    const box =
      actualPage === 0
        ? boxes[index]
        : { x: 56, y: 30 + index * 112, w: 1168, h: 104 }
    return {
      id: 'style-preview-' + styleId,
      type: 'text',
      fixed: true,
      ...box,
      text:
        customSamples[styleId] ??
        samples[styleId] ??
        (styles.find((s) => s.id === styleId)?.label ?? 'Текст') +
          ' · Аа Бб 0123',
      src: '',
      textType: type,
      ...(isTextType(styleId) ? {} : { style: styleId }),
    }
  })
  function renderPreview(mode: 'white' | 'black' | 'custom' | 'slide') {
    const example: Slide = {
      id: previewId,
      notes: '',
      items,
      color:
        mode === 'slide'
          ? slide.color
          : mode === 'black'
            ? '#171717'
            : mode === 'custom'
              ? color
              : '#ffffff',
      background: mode === 'slide' ? slide.background : null,
      ...(mode === 'slide' && slide.effects ? { effects: slide.effects } : {}),
    }
    return (
      <div className="style-preview" key={mode}>
        <Stage
          deck={{ ...draft, master: defaultMaster(), slides: [example] }}
          slide={example}
        />
        {items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className="style-preview-hit"
            aria-label={
              'Выбрать стиль: ' +
              (styles.find((s) => s.id === visible[i])?.label ?? visible[i])
            }
            aria-pressed={selected === visible[i]}
            onClick={() => choose(visible[i])}
            style={{
              left: item.x / 12.8 + '%',
              top: item.y / 7.2 + '%',
              width: item.w / 12.8 + '%',
              height: item.h / 7.2 + '%',
            }}
          />
        ))}
      </div>
    )
  }
  return (
    <dialog
      ref={host}
      className="text-style-manager"
      aria-label="Текстовые стили"
      onCancel={(e) => {
        e.preventDefault()
        cancel()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
      }}
    >
      <header>
        <h2>Текстовые стили</h2>
        <button
          type="button"
          onClick={cancel}
          aria-label="Закрыть менеджер стилей"
        >
          ×
        </button>
      </header>
      <div className="style-manager-grid">
        <nav
          aria-label="Глобальные текстовые стили"
          className="style-manager-list"
        >
          <h3>Базовые</h3>
          {styles
            .filter((s) => isTextType(s.id))
            .map((s) => (
              <button
                type="button"
                key={s.id}
                aria-pressed={selected === s.id}
                onClick={() => choose(s.id)}
              >
                <span>Аа</span>
                {s.label}
              </button>
            ))}
          <h3>Пользовательские</h3>
          {custom.map((s) => (
            <button
              type="button"
              key={s.id}
              aria-pressed={selected === s.id}
              onClick={() => choose(s.id)}
            >
              <span>Аа</span>
              {s.label}
            </button>
          ))}
          {!custom.length && <small>Пока нет пользовательских стилей</small>}
        </nav>
        <section
          className="style-manager-center"
          aria-label="Предпросмотр типографики"
        >
          <div className="style-preview-controls">
            <label>
              Фон предпросмотра
              <select
                value={background}
                onChange={(e) =>
                  setBackground(e.target.value as typeof background)
                }
              >
                <option value="white">Белый</option>
                <option value="black">Тёмный</option>
                <option value="custom">Свой цвет</option>
                <option value="slide">Фон шаблона</option>
                <option value="compare">Светлый и тёмный</option>
              </select>
            </label>
            {background === 'custom' && (
              <input
                aria-label="Цвет фона предпросмотра"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            )}
          </div>
          <div className="style-preview-pages">
            <button
              type="button"
              disabled={actualPage === 0}
              onClick={() => setPage(actualPage - 1)}
            >
              ←
            </button>
            <span>
              {actualPage === 0
                ? 'Базовая композиция'
                : 'Пользовательские стили'}{' '}
              · {actualPage + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={actualPage >= pages - 1}
              onClick={() => setPage(actualPage + 1)}
            >
              →
            </button>
          </div>
          {background === 'compare' ? (
            <div className="style-preview-compare">
              {renderPreview('white')}
              {renderPreview('black')}
            </div>
          ) : (
            renderPreview(background)
          )}
          <label>
            Текст примера выбранного стиля
            <textarea
              value={
                customSamples[selected] ??
                samples[selected] ??
                (styles.find((s) => s.id === selected)?.label ?? 'Текст') +
                  ' · Аа Бб 0123'
              }
              maxLength={2000}
              onChange={(e) =>
                setCustomSamples((old) => ({
                  ...old,
                  [selected]: e.target.value,
                }))
              }
            />
          </label>
          <small>
            Предпросмотр использует движок слайдов. Фон и текст примеров не
            сохраняются в шаблон. Крупный текст может не поместиться в
            демонстрационный блок.
          </small>
        </section>
        <section
          className="inspector style-manager-fields"
          aria-label="Параметры глобального стиля"
        >
          <h3>{styles.find((s) => s.id === selected)?.label}</h3>
          <StylesPanel
            deck={draft}
            change={(fn) => setDraft(fn)}
            notice={setMessage}
            library={library}
            selection={{ id: selected, setID: choose }}
          />
        </section>
      </div>
      <footer>
        <span role="status">
          {(changed ? 'Есть неприменённые изменения. ' : '') +
            (message || (changed ? '' : 'Нет неприменённых изменений'))}
        </span>
        <button type="button" onClick={cancel}>
          Отмена
        </button>
        <button type="button" disabled={!changed} onClick={() => apply(false)}>
          Применить
        </button>
        <button type="button" className="primary" onClick={() => apply(true)}>
          Готово
        </button>
      </footer>
    </dialog>
  )
}

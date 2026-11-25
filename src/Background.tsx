import { Files } from './Files'
import { useEffect, useRef, useState } from 'react'
import { MAX_DOCUMENT_BYTES, type Deck, type Slide } from './model'
import { originalBackground, optimize } from './media'
export function Background({
  slide,
  deck,
  update,
  reset,
  libraryAvailable,
  notice,
}: {
  slide: Slide
  deck: Deck
  update: (s: Slide) => void
  libraryAvailable?: boolean
  reset?: () => void
  notice: (s: string) => void
}) {
  const file = useRef<HTMLInputElement>(null),
    [pending, setFile] = useState<File | null>(null),
    [original, choose] = useState(true)
  const active = useRef(true),
    latest = useRef({ slide, update, deck })
  latest.current = { slide, update, deck }
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [picker, setPicker] = useState(false)
  const effects = slide.effects ?? {}
  function clear() {
    const next = { ...slide }
    delete next.effects
    return next
  }
  return (
    <section className="bg-tools">
      <label>
        Цвет фона
        <input
          type="color"
          value={slide.color}
          onChange={(e) => update({ ...slide, color: e.target.value })}
        />
      </label>
      <button onClick={() => file.current?.click()}>Фоновое изображение</button>
      {libraryAvailable && (
        <button onClick={() => setPicker(true)}>Фон из моих файлов</button>
      )}
      {picker && (
        <div className="overlay">
          <section className="dialog">
            <button onClick={() => setPicker(false)}>Закрыть</button>
            <Files
              pick={(src) => {
                update({ ...slide, background: src })
                setPicker(false)
              }}
            />
          </section>
        </div>
      )}
      <input
        hidden
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null)
          choose(true)
          e.target.value = ''
        }}
      />
      {pending && (
        <div role="dialog">
          <p>
            {pending.name} · {(pending.size / 1048576).toFixed(2)} МиБ. Лимит
            JSON 64 МиБ. Хранилище браузера и публикация имеют отдельные
            ограничения.
          </p>
          <select
            aria-label="Обработка изображения"
            value={original ? 'original' : 'optimized'}
            onChange={(e) => choose(e.target.value === 'original')}
          >
            <option value="original">Сохранить оригинал</option>
            <option value="optimized">Оптимизировать изображение</option>
          </select>
          <button
            onClick={async () => {
              try {
                const src = original
                  ? await originalBackground(pending)
                  : (await optimize(pending, 64 * 1048576)).src
                if (active.current) {
                  const { deck: current, slide: page } = latest.current
                  const projected = {
                    ...current,
                    slides: current.slides.map((v) =>
                      v.id === page.id ? { ...v, background: src } : v
                    ),
                  }
                  if (
                    new Blob([JSON.stringify(projected)]).size >
                    MAX_DOCUMENT_BYTES
                  )
                    throw Error(
                      'С этим фоном JSON превышает 64 МиБ. Выберите оптимизацию или меньший файл.'
                    )
                  latest.current.update({
                    ...latest.current.slide,
                    background: src,
                  })
                  setFile(null)
                }
              } catch (e) {
                notice((e as Error).message)
              }
            }}
          >
            Загрузить фон
          </button>
          <button onClick={() => setFile(null)}>Отмена</button>
        </div>
      )}
      {slide.background && (
        <>
          <button onClick={() => update({ ...clear(), background: null })}>
            Убрать изображение
          </button>
          {(
            [
              ['brightness', 'Яркость', 0, 200, 100],
              ['blur', 'Размытие', 0, 40, 0],
              ['zoom', 'Масштаб', 50, 300, 100],
              ['x', 'Положение X', 0, 100, 50],
              ['y', 'Положение Y', 0, 100, 50],
            ] as const
          ).map(([key, label, min, max, def]) => (
            <label key={key}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                value={effects[key] ?? def}
                onChange={(e) =>
                  update({
                    ...slide,
                    effects: { ...effects, [key]: +e.target.value },
                  })
                }
              />
            </label>
          ))}
          <label>
            Размер фона
            <select
              value={effects.fit ?? 'cover'}
              onChange={(e) =>
                update({
                  ...slide,
                  effects: {
                    ...effects,
                    fit: e.target.value as 'cover' | 'contain',
                  },
                })
              }
            >
              <option value="cover">Заполнить</option>
              <option value="contain">Вписать</option>
            </select>
          </label>
          <button onClick={() => update(clear())}>
            Сбросить параметры изображения
          </button>
        </>
      )}
      <button
        onClick={() =>
          update({ ...clear(), color: '#ffffff', background: null })
        }
      >
        Сбросить фон
      </button>
      {reset && <button onClick={reset}>Вернуть фон шаблона</button>}
    </section>
  )
}

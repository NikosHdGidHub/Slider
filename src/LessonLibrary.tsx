import { desktopEditingMessage } from './libraryNavigation'
import { Download, Pencil, Play, Plus, Trash2, Upload } from 'lucide-react'
import { IconButton } from './IconButton'
import {
  LibraryCard,
  LibraryHeader,
  LibraryItems,
  LibraryState,
  LibraryToolbar,
  selectLibraryRows,
  type LibrarySettings,
} from './Library'
import type { Deck } from './model'
import type { Entry } from './storage'
import type { MenuItem } from './ActionMenu'

const formatDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const plurals = new Intl.PluralRules('ru-RU')
function countSlides(count: number) {
  const ending = {
    one: 'слайд',
    few: 'слайда',
    many: 'слайдов',
    other: 'слайда',
  } as const
  return count + ' ' + ending[plurals.select(count) as keyof typeof ending]
}

export function LessonLibrary({
  settings,
  rows,
  allowed,
  editable,
  loading,
  error,
  create,
  importJSON,
  view,
  edit,
  exportJSON,
  remove,
  login,
  example,
  retry,
  notice,
}: {
  settings: LibrarySettings
  rows: Entry[]
  allowed: boolean
  editable: boolean
  loading: boolean
  error: string
  create: () => void
  importJSON: () => void
  view: (deck: Deck) => void
  edit: (entry: Entry) => void
  exportJSON: (deck: Deck) => Promise<void>
  remove: (entry: Entry) => Promise<void>
  login: () => void
  example: () => void
  retry: () => void
  notice: (message: string) => void
}) {
  const visible = selectLibraryRows(rows, settings)
  return (
    <section className="lib-page">
      <LibraryHeader
        title="Мои методички"
        action={
          editable && (
            <button className="lib-button lib-primary" onClick={create}>
              <Plus size={18} /> Создать
            </button>
          )
        }
      />
      {allowed && !editable && (
        <p className="lib-phone-note">{desktopEditingMessage}</p>
      )}
      {allowed ? (
        <LibraryToolbar
          settings={settings}
          label="Поиск методичек"
          actions={
            editable && (
              <IconButton
                className="lib-button lib-icon"
                label="Импортировать JSON методички"
                onClick={importJSON}
              >
                <Upload />
              </IconButton>
            )
          }
        />
      ) : null}
      {!allowed ? (
        <LibraryState
          title="Библиотека преподавателя"
          action={
            <button className="lib-button lib-secondary" onClick={login}>
              Войти
            </button>
          }
        >
          Войдите, чтобы открыть сохранённые на этом устройстве методички.
        </LibraryState>
      ) : error ? (
        <LibraryState
          title="Библиотека недоступна"
          error
          action={
            <button className="lib-button lib-secondary" onClick={retry}>
              Повторить
            </button>
          }
        >
          {error}
        </LibraryState>
      ) : loading && !rows.length ? (
        <LibraryState title="Загружаем методички…" />
      ) : !rows.length ? (
        <LibraryState
          title="Здесь будут ваши методички"
          action={
            <button className="lib-button lib-text" onClick={example}>
              Посмотреть пример методички
            </button>
          }
        >
          {editable
            ? 'Создайте первую методичку или импортируйте готовый JSON.'
            : 'На этом устройстве пока нет сохранённых методичек.'}
        </LibraryState>
      ) : !visible.length ? (
        <LibraryState title="Методички не найдены">
          Проверьте название или измените запрос.
        </LibraryState>
      ) : (
        <>
          <p className="lib-results" role="status">
            Показано {visible.length} из {rows.length}
          </p>
          <LibraryItems settings={settings} columns={['Слайды', 'Изменено']}>
            {visible.map((entry) => {
              const actions: MenuItem[] = [
                { label: 'Открыть', icon: Play, run: () => view(entry.deck) },
              ]
              if (editable)
                actions.push({
                  label: 'Редактировать',
                  icon: Pencil,
                  run: () => edit(entry),
                })
              actions.push(
                {
                  label: 'Экспортировать JSON',
                  icon: Download,
                  run: () => exportJSON(entry.deck),
                },
                'separator',
                {
                  label: 'Удалить с устройства',
                  icon: Trash2,
                  danger: true,
                  run: () => remove(entry),
                }
              )
              return (
                <LibraryCard
                  key={entry.deck.id}
                  deck={entry.deck}
                  first={countSlides(entry.deck.slides.length)}
                  second={
                    <time dateTime={new Date(entry.updated).toISOString()}>
                      {formatDate.format(entry.updated)}
                    </time>
                  }
                  open={() => view(entry.deck)}
                  actions={actions}
                  notice={notice}
                />
              )
            })}
          </LibraryItems>
        </>
      )}
    </section>
  )
}

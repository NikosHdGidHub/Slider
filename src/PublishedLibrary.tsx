import { LibraryStatus } from './LibraryStatus'
import { useMemo, useState } from 'react'
import {
  Download,
  Folder,
  Globe2,
  Link2,
  Monitor,
  Pencil,
  Play,
  QrCode,
  Trash2,
} from 'lucide-react'
import { ActionMenus, type MenuItem } from './ActionMenu'
import { memberships, type CourseSnapshot } from './courseModel'
import {
  LibraryCard,
  LibraryHeader,
  LibraryItems,
  LibraryState,
  LibraryToolbar,
  normalizeLibraryQuery,
  selectLibraryRows,
  useLibraryPage,
  type LibrarySettings,
} from './Library'
import type { PublishedRow } from './publicationCatalog'

const date = new Intl.DateTimeFormat('ru', { dateStyle: 'medium' })
export const publicationTitle = (row: PublishedRow) =>
  row.title ?? 'Методичка ' + row.id
export function PublicationThumbnail({ row }: { row: PublishedRow }) {
  const [failed, setFailed] = useState(false)
  return row.thumbnail && !failed ? (
    <img
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      src={row.thumbnail}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe2 size={26} aria-hidden="true" />
  )
}
type Action =
  | 'view'
  | 'copy'
  | 'qr'
  | 'edit'
  | 'save'
  | 'offline'
  | 'export'
  | 'unpublish'

export function PublishedLibrary({
  rows,
  snapshot,
  settings,
  course,
  openCourse,
  owner,
  editable,
  online,
  loading,
  failed,
  retry,
  notice,
  receive,
  login,
  action,
  backfill,
}: {
  rows: PublishedRow[]
  snapshot: CourseSnapshot
  settings: LibrarySettings
  course: string
  openCourse: (course: string) => void
  owner: boolean
  editable: boolean
  online: boolean
  loading: boolean
  failed: boolean
  retry: () => void
  notice: (message: string) => void
  receive: () => void
  login: () => void
  action: (action: Action, id: string) => void
  backfill: () => void
}) {
  const parent = useMemo(() => memberships(snapshot), [snapshot])
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const row of rows) {
      const parentId = parent.get(row.id) ?? ''
      result.set(parentId, (result.get(parentId) ?? 0) + 1)
    }
    return result
  }, [rows, parent])
  const byId = new Map(rows.map((row) => [row.id, row]))
  const folders = snapshot.courses.filter((item) => counts.has(item.id))
  const query = normalizeLibraryQuery(settings.query)
  const current = folders.find(({ id }) => id === course)
  const available = current
    ? (snapshot.lessons[current.id] ?? []).flatMap((id) => byId.get(id) ?? [])
    : rows.filter(({ id }) =>
        course === 'none' || !query ? !parent.has(id) : true
      )
  const arranged = selectLibraryRows(
    available.map((row) => ({
      row,
      deck: { title: publicationTitle(row) },
      slideCount: row.slides ?? 0,
      updated: Date.parse(row.updated),
    })),
    settings
  )
  const filteredFolders = !course
    ? folders.filter((folder) =>
        normalizeLibraryQuery(folder.title).includes(query)
      )
    : []
  const page = useLibraryPage(
    JSON.stringify([course, query, settings.sort]),
    arranged.length,
    48
  )
  const actions = (id: string): MenuItem[] => [
    { label: 'Просмотр', icon: Play, run: () => action('view', id) },
    { label: 'Копировать ссылку', icon: Link2, run: () => action('copy', id) },
    { label: 'Показать QR-код', icon: QrCode, run: () => action('qr', id) },
    ...(editable
      ? [
          {
            label: 'Редактировать',
            icon: Pencil,
            run: () => action('edit', id),
          },
        ]
      : []),
    {
      label: 'Сохранить рабочую копию',
      icon: Monitor,
      run: () => action('save', id),
    },
    {
      label: 'Подготовить к офлайн-показу',
      icon: Monitor,
      run: () => action('offline', id),
    },
    {
      label: 'Экспортировать JSON',
      icon: Download,
      run: () => action('export', id),
    },
    'separator',
    {
      label: 'Снять с публикации',
      icon: Trash2,
      danger: true,
      run: () => action('unpublish', id),
    },
  ]
  return (
    <ActionMenus>
      <section className="lib-page published-library">
        <LibraryHeader
          title="Опубликованные"
          action={
            <button className="primary" onClick={receive}>
              <QrCode size={18} /> Получить методичку с телефона
            </button>
          }
        />
        {!owner ? (
          <LibraryState
            title="Публикации владельца"
            action={
              <button className="secondary" onClick={login}>
                Вход преподавателя
              </button>
            }
          >
            Гости открывают занятия по прямой ссылке.
          </LibraryState>
        ) : (
          <>
            {course && (
              <nav className="course-breadcrumb" aria-label="Путь публикаций">
                <button onClick={() => openCourse('')}>Опубликованные</button>
                <span aria-current="page">{current?.title ?? 'Без курса'}</span>
              </nav>
            )}
            <LibraryToolbar
              label={current ? 'Поиск в курсе' : 'Поиск публикаций и курсов'}
              settings={settings}
              actions={
                <select
                  className="lib-course-filter"
                  aria-label="Фильтр по курсам"
                  value={course}
                  onChange={(event) => openCourse(event.target.value)}
                >
                  <option value="">Все курсы</option>
                  {folders.map(({ id, title }) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                  <option value="none">Без курса</option>
                </select>
              }
            />
            {(course || query) && (
              <button
                className="lib-button lib-text"
                onClick={() => {
                  openCourse('')
                  settings.setQuery('')
                }}
              >
                Сбросить поиск и фильтр
              </button>
            )}
            {!online && (
              <LibraryStatus level="warning" title="Публикации: офлайн">
                <p>Показан последний загруженный каталог.</p>
              </LibraryStatus>
            )}
            {failed && (
              <LibraryStatus
                level="error"
                title="Не удалось обновить публикации"
              >
                <button className="secondary" onClick={retry}>
                  Повторить
                </button>
              </LibraryStatus>
            )}
            {rows.some((row) => !row.indexed) && online && (
              <LibraryStatus
                level="warning"
                title="Не все публикации индексированы"
              >
                <p>У части публикаций ещё нет названий в каталоге.</p>
                <button className="secondary" onClick={backfill}>
                  Индексировать прежние публикации
                </button>
              </LibraryStatus>
            )}
            {loading && rows.length > 0 && (
              <LibraryStatus level="busy" title="Обновляем публикации…" />
            )}
            {failed && !rows.length && (
              <LibraryState
                title="Каталог публикаций недоступен"
                error
                action={
                  <button className="secondary" onClick={retry}>
                    Повторить
                  </button>
                }
              />
            )}
            {loading && !rows.length && !failed && (
              <LibraryState title="Загружаем публикации…" />
            )}
            {!loading &&
              !failed &&
              !filteredFolders.length &&
              !arranged.length && (
                <LibraryState
                  title={
                    rows.length
                      ? 'Публикации не найдены'
                      : 'Публикаций пока нет'
                  }
                />
              )}
            {filteredFolders.length > 0 && (
              <LibraryItems settings={settings} columns={['Методички', '']}>
                {filteredFolders.map((folder) => (
                  <LibraryCard
                    key={folder.id}
                    name={folder.title}
                    thumbnail={
                      <Folder
                        size={38}
                        style={{ color: folder.color }}
                        fill={folder.color}
                      />
                    }
                    first={counts.get(folder.id)}
                    notice={notice}
                    actions={[]}
                    open={() => openCourse(folder.id)}
                    card={{ className: 'course-folder' }}
                  />
                ))}
              </LibraryItems>
            )}
            {(query || course || arranged.length > 0) && (
              <p className="lib-results" role="status">
                Найдено публикаций: {arranged.length}
                {filteredFolders.length
                  ? ' · Курсов: ' + filteredFolders.length
                  : ''}
              </p>
            )}
            {arranged.length > 0 && (
              <LibraryItems
                settings={settings}
                columns={['Слайды', 'Опубликовано']}
              >
                {arranged.slice(0, page.count).map(({ row }) => (
                  <LibraryCard
                    key={row.id}
                    name={publicationTitle(row)}
                    thumbnail={
                      <PublicationThumbnail
                        key={row.thumbnail ?? ''}
                        row={row}
                      />
                    }
                    first={row.slides ? row.slides + ' сл.' : '—'}
                    second={
                      <>
                        {!current && parent.has(row.id) && (
                          <span className="course-location">
                            {
                              folders.find(
                                ({ id }) => id === parent.get(row.id)
                              )?.title
                            }
                          </span>
                        )}{' '}
                        {Date.parse(row.updated) > 0 &&
                          date.format(new Date(row.updated))}
                      </>
                    }
                    open={() => action('view', row.id)}
                    actions={actions(row.id)}
                    notice={notice}
                  />
                ))}
              </LibraryItems>
            )}
            {page.next && (
              <button className="secondary" onClick={page.next}>
                Показать ещё
              </button>
            )}
          </>
        )}
      </section>
    </ActionMenus>
  )
}

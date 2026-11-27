import { desktopEditingMessage } from './libraryNavigation'
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderPlus,
  Globe2,
  ListChecks,
  Monitor,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { IconButton } from './IconButton'
import {
  LibraryCard,
  LibraryHeader,
  MigrationFailures,
  LibraryItems,
  LibraryState,
  LibraryToolbar,
  normalizeLibraryQuery,
  selectLibraryRows,
  useLibraryPage,
  type LibrarySettings,
} from './Library'
import type { WorkingMeta } from './workingDocument'
import type { PublishedRow } from './publicationCatalog'
import { originalDocument, originalIds, type Entry } from './storage'
import { download } from './instructions'
import { useEffect, useMemo, useState } from 'react'
import { ActionMenu, type MenuItem } from './ActionMenu'
import { CourseDialog, type CourseDialogMode } from './CourseDialog'
import { useCourseDrag } from './CourseOrder'
import {
  courseDetails,
  memberships,
  moveCommand,
  orderVisible,
  type Course,
  type CourseCommand,
} from './courseModel'
import type { CourseLibrary } from './courseSync'

const formatDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const plurals = new Intl.PluralRules('ru-RU')
function counted(count: number, names: [string, string, string]) {
  const form = plurals.select(count)
  return count + ' ' + names[form === 'one' ? 0 : form === 'few' ? 1 : 2]
}
const countSlides = (n: number) => counted(n, ['слайд', 'слайда', 'слайдов'])
const countLessons = (n: number) =>
  counted(n, ['методичка', 'методички', 'методичек'])

export type LessonRow = Entry & {
  slideCount?: number
  working?: WorkingMeta
  publication?: PublishedRow
  syncConflict?: boolean
  cloudMeta?: WorkingMeta
}

interface Props {
  settings: LibrarySettings
  rows: LessonRow[]
  courses: CourseLibrary
  course: Course | undefined
  openCourse: (id: string | null) => void
  published: Set<string>
  publicationsLoading: boolean
  publicationsError: boolean
  allowed: boolean
  editable: boolean
  loading: boolean
  error: string
  create: () => void
  fromTemplate: () => void
  importJSON: () => void
  duplicate: (entry: LessonRow, course: string | null) => Promise<void>
  view: (entry: LessonRow) => void
  edit: (entry: LessonRow) => void
  exportJSON: (entry: LessonRow) => Promise<void>
  remove: (entry: LessonRow, cloud?: boolean) => Promise<void>
  cloud?: boolean
  saveLocally: (entry: LessonRow) => Promise<void>
  login: () => void
  example: () => void
  retry: () => void
  notice: (message: string) => void
}

export function LessonLibrary(props: Props) {
  const {
    settings,
    rows,
    courses,
    course,
    openCourse,
    published,
    allowed,
    editable,
    loading,
    error,
    create,
    fromTemplate,
    importJSON,
    duplicate,
    view,
    edit,
    exportJSON,
    remove,
    saveLocally,
    login,
    example,
    retry,
    notice,
  } = props
  const [originals, setOriginals] = useState(new Set<string>())
  const [dialog, openDialog] = useState<CourseDialogMode>()
  const [reorder, setReorder] = useState<string | null>()
  const [selectingLessons, setSelecting] = useState(false)
  const [bulkDestination, setBulkDestination] = useState<string>()
  const [selected, setSelected] = useState(new Set<string>())
  const id = course?.id ?? null
  const state = courses.snapshot
  const pickingForCourse = !id && !!bulkDestination
  const selecting = selectingLessons || pickingForCourse
  const parent = useMemo(() => memberships(state), [state])
  const ids = useMemo(
    () => new Map(rows.map((entry) => [entry.deck.id.toLowerCase(), entry])),
    [rows]
  )
  const query = normalizeLibraryQuery(settings.query.trim())
  const all = course
    ? (state.lessons[course.id] ?? []).flatMap((id) =>
        ids.has(id) ? [ids.get(id)!] : []
      )
    : rows.filter(
        (entry) =>
          query || pickingForCourse || !parent.has(entry.deck.id.toLowerCase())
      )
  const visible = selectLibraryRows(all, settings)
  const page = useLibraryPage(
    [id, query, settings.sort].join('/'),
    visible.length
  )
  const folders = !course
    ? state.courses.filter((c) =>
        normalizeLibraryQuery(c.title).includes(query)
      )
    : []
  const available = (course: Course) =>
    (state.lessons[course.id] ?? []).filter((id) => ids.has(id)).length
  const order = course
    ? visible.map(({ deck }) => deck.id.toLowerCase())
    : folders.map((c) => c.id)
  const ordering = reorder === id && !query
  const canOrder = !query && order.length > 1
  const mayOrganize = allowed && courses.ready
  const controlsEnabled = editable || mayOrganize

  useEffect(() => {
    let live = true
    if (allowed)
      void originalIds('lesson')
        .then((ids) => {
          if (live) setOriginals(ids)
        })
        .catch(() => {})
    return () => {
      live = false
    }
  }, [allowed, rows])
  useEffect(() => {
    setSelecting(false)
    setSelected(new Set())
    openDialog(undefined)
  }, [id, allowed])
  useEffect(() => {
    if (query) setReorder(undefined)
  }, [query])

  function run(work: () => Promise<void>) {
    return work().catch((e) =>
      notice(e instanceof Error ? e.message : 'Не удалось изменить курсы.')
    )
  }
  function moveRelative(from: string, to: string, after: boolean) {
    void run(() =>
      courses.change((snapshot) => {
        const full = id
          ? snapshot.lessons[id]
          : snapshot.courses.map((c) => c.id)
        if (!full?.includes(from) || !full.includes(to) || from === to)
          return []
        const known = new Set(order)
        const next = full.filter(
          (lesson) => known.has(lesson) && lesson !== from
        )
        const index = next.indexOf(to)
        if (index < 0) return []
        next.splice(index + Number(after), 0, from)
        return [
          { kind: 'order', id, before: full, order: orderVisible(full, next) },
        ]
      })
    )
  }
  const drag = useCourseDrag(order, moveRelative, settings.view === 'gallery')
  function startOrdering() {
    if (!canOrder) return
    setSelecting(false)
    if (course) settings.setSort('manual')
    setReorder(id)
  }
  function switchCourse(id: string | null) {
    setReorder(undefined)
    setBulkDestination(undefined)
    openCourse(id)
  }
  function selectLesson(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  function moveLessons(ids: string[]) {
    openDialog({
      kind: 'move',
      ids,
      from:
        bulkDestination ?? (ids.length === 1 ? (parent.get(ids[0]) ?? '') : ''),
    })
  }
  function courseActions(course: Course): MenuItem[] {
    return [
      { label: 'Открыть', icon: Folder, run: () => switchCourse(course.id) },
      {
        label: 'Переименовать',
        icon: Pencil,
        run: () => openDialog({ kind: 'rename', course }),
      },
      {
        label: 'Изменить цвет',
        icon: Folder,
        run: () => openDialog({ kind: 'color', course }),
      },
      {
        label: 'Изменить положение среди курсов',
        icon: ArrowDownUp,
        disabled: !!query || state.courses.length < 2,
        run: () => {
          if (id) {
            switchCourse(null)
            setReorder(null)
          } else startOrdering()
        },
      },
      'separator',
      {
        label: 'Удалить курс',
        icon: Trash2,
        danger: true,
        run: () =>
          openDialog({
            kind: 'delete',
            course,
            members: state.lessons[course.id],
          }),
      },
    ]
  }

  async function saveDialog(fields: {
    title: string
    color: string
    destination: string
  }) {
    if (!dialog) return
    const mode = dialog
    await courses.change((snapshot) => {
      const commands: CourseCommand[] = []
      const newCourse = () => {
        const id = crypto.randomUUID()
        commands.push({
          kind: 'create',
          course: { id, ...courseDetails(fields.title, fields.color) },
        })
        return id
      }
      if (mode.kind === 'create') newCourse()
      else if (mode.kind === 'move') {
        const destination =
          fields.destination === 'new'
            ? newCourse()
            : fields.destination || null
        commands.push(moveCommand(snapshot, mode.ids, destination))
      } else if (mode.kind === 'delete') {
        commands.push({
          kind: 'delete',
          id: mode.course.id,
          before: mode.course,
          members: mode.members ?? [],
        })
      } else {
        const key = mode.kind === 'rename' ? 'title' : 'color'
        const value = courseDetails(fields.title, fields.color)[key]
        commands.push({
          kind: 'edit',
          id: mode.course.id,
          before: { [key]: mode.course[key] },
          details: { [key]: value },
        })
      }
      return commands
    })
    if (dialog.kind === 'move') {
      setBulkDestination(undefined)
      setSelecting(false)
      setSelected(new Set())
    }
  }

  const filteredSelected = [...selected].filter((id) =>
    visible.some((entry) => entry.deck.id.toLowerCase() === id)
  )
  const createActions: MenuItem[] = [
    ...(editable
      ? [
          { label: 'Новая методичка', icon: Plus, run: create },
          { label: 'Из шаблона', icon: Folder, run: fromTemplate },
        ]
      : []),
    ...(!course && mayOrganize
      ? [
          {
            label: 'Новый курс',
            icon: FolderPlus,
            run: () => openDialog({ kind: 'create' }),
          },
        ]
      : []),
  ]

  return (
    <section className="lib-page course-library">
      {course && (
        <nav className="course-crumb" aria-label="Путь к курсу">
          <button
            className="lib-button lib-text"
            onClick={() => switchCourse(null)}
          >
            Мои методички
          </button>
          <ChevronRight size={15} aria-hidden="true" />
          <span aria-current="page" title={course.title}>
            {course.title}
          </span>
        </nav>
      )}
      <LibraryHeader
        title={
          course ? (
            <>
              <Folder
                size={29}
                style={{ color: course.color }}
                fill={course.color}
                aria-hidden="true"
              />
              <span>{course.title}</span>
            </>
          ) : (
            'Мои методички'
          )
        }
        action={
          createActions.length > 0 &&
          (editable ? (
            <ActionMenu
              label="Создать"
              icon={Plus}
              primary
              items={createActions}
              onError={notice}
            >
              Создать
            </ActionMenu>
          ) : (
            <button
              className="lib-button lib-primary"
              onClick={() => openDialog({ kind: 'create' })}
            >
              <FolderPlus size={17} /> Новый курс
            </button>
          ))
        }
      />
      {course && (
        <div className="course-subhead">
          <span>{countLessons(available(course))}</span>
          {controlsEnabled && (
            <ActionMenu
              label="Управление курсом"
              icon={SlidersHorizontal}
              items={courseActions(course)}
              onError={notice}
            />
          )}
        </div>
      )}
      {allowed && !editable && (
        <p className="lib-phone-note">{desktopEditingMessage}</p>
      )}
      {allowed && (
        <LibraryToolbar
          settings={settings}
          label="Поиск методичек"
          actions={
            <>
              {editable && (
                <IconButton
                  className="lib-button lib-icon"
                  label="Импортировать JSON методички"
                  onClick={importJSON}
                >
                  <Upload />
                </IconButton>
              )}
              {mayOrganize && visible.length > 0 && !ordering && (
                <IconButton
                  className="lib-button lib-icon"
                  label="Выбрать методички"
                  aria-pressed={selecting}
                  onClick={() => {
                    setSelecting(!selecting)
                    setSelected(new Set())
                  }}
                >
                  <ListChecks />
                </IconButton>
              )}
              {mayOrganize &&
                (course || state.courses.length > 0) &&
                !selecting && (
                  <button
                    className="lib-button lib-secondary"
                    disabled={!ordering && !canOrder}
                    title={
                      query ? 'Очистите поиск для перестановки' : undefined
                    }
                    onClick={() =>
                      ordering ? setReorder(undefined) : startOrdering()
                    }
                  >
                    {ordering ? <Check size={16} /> : <ArrowDownUp size={16} />}
                    {ordering ? 'Готово' : 'Изменить порядок'}
                  </button>
                )}
            </>
          }
        />
      )}
      {allowed && <MigrationFailures kind="lesson" />}
      {allowed &&
        courses.cloud &&
        (!courses.online ||
          courses.error ||
          courses.conflict ||
          courses.dirty ||
          courses.syncing) && (
          <div
            className="course-sync"
            role={courses.conflict || courses.error ? 'alert' : 'status'}
          >
            <span>
              {courses.conflict
                ? 'Структура курсов изменилась на другом устройстве. Ваши изменения сохранены здесь.'
                : courses.error ||
                  (!courses.online
                    ? 'Курсы доступны офлайн. Изменения синхронизируются после подключения.'
                    : courses.syncing
                      ? 'Синхронизация курсов…'
                      : 'Изменения курсов ожидают синхронизации.')}
            </span>
            {courses.conflict ? (
              <>
                <button
                  className="lib-button lib-secondary"
                  onClick={() => void run(() => courses.resolve('local'))}
                >
                  Применить мои изменения
                </button>
                <button
                  className="lib-button lib-secondary"
                  onClick={() => {
                    if (
                      confirm(
                        'Заменить ожидающие изменения курсов облачной версией?'
                      )
                    )
                      void run(() => courses.resolve('remote'))
                  }}
                >
                  Принять облачную версию
                </button>
              </>
            ) : (
              courses.error && (
                <button
                  className="lib-button lib-secondary"
                  onClick={courses.retry}
                >
                  Повторить синхронизацию
                </button>
              )
            )}
          </div>
        )}
      {allowed && !courses.cloud && courses.error && (
        <p role="alert" className="course-sync">
          {courses.error}
        </p>
      )}
      {selecting && (
        <div className="course-bulk" role="group" aria-label="Выбор методичек">
          <span>Выбрано {filteredSelected.length}</span>
          <button
            className="lib-button lib-secondary"
            onClick={() =>
              setSelected(
                new Set(visible.map(({ deck }) => deck.id.toLowerCase()))
              )
            }
          >
            Выбрать все
          </button>
          <button
            className="lib-button lib-primary"
            disabled={!filteredSelected.length}
            onClick={() => moveLessons(filteredSelected)}
          >
            Переместить выбранные
          </button>
        </div>
      )}
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
      ) : (
        <>
          {!course &&
            !query &&
            (state.courses.length > 0 || rows.length > 0) && (
              <h2 className="course-section-title">Курсы</h2>
            )}
          {folders.length > 0 && (
            <LibraryItems settings={settings} columns={['Методички', '']}>
              {folders.map((folder) => (
                <LibraryCard
                  key={folder.id}
                  name={folder.title}
                  thumbnail={
                    <Folder
                      size={38}
                      fill={folder.color}
                      style={{ color: folder.color }}
                    />
                  }
                  first={countLessons(available(folder))}
                  open={() => switchCourse(folder.id)}
                  actions={mayOrganize ? courseActions(folder) : []}
                  notice={notice}
                  card={{
                    className: 'course-folder',
                    ...(ordering ? drag.card(folder.id) : {}),
                  }}
                  controls={
                    ordering
                      ? drag.controls(folder.id, folder.title)
                      : undefined
                  }
                  blockOpen={ordering}
                />
              ))}
            </LibraryItems>
          )}
          {!course && !query && !folders.length && rows.length > 0 && (
            <p className="lib-results">Курсов пока нет.</p>
          )}
          {!course && !query && (
            <h2 className="course-section-title">
              {pickingForCourse ? 'Методички' : 'Отдельные методички'}
            </h2>
          )}
          {query && (
            <p className="lib-results" role="status">
              Показано {visible.length} из {all.length}
              {folders.length > 0 && ' · Курсов: ' + folders.length}
            </p>
          )}
          {visible.length > 0 ? (
            <LibraryItems settings={settings} columns={['Слайды', 'Изменено']}>
              {(ordering || selecting
                ? visible
                : visible.slice(0, page.count)
              ).map((entry) => {
                const { deck, revision } = entry
                const lessonId = deck.id.toLowerCase()
                const inside = parent.get(lessonId)
                const location =
                  !course && query
                    ? (state.courses.find((c) => c.id === inside)?.title ??
                      'Без курса')
                    : undefined
                const selectedHere = selected.has(lessonId)
                const orderThis = ordering && !!course
                const isPublished = published.has(lessonId)
                const actions: MenuItem[] = [
                  { label: 'Просмотр', icon: Play, run: () => view(entry) },
                ]
                if (editable)
                  actions.push(
                    {
                      label: 'Редактировать',
                      icon: Pencil,
                      run: () => edit(entry),
                    },
                    {
                      label: 'Дублировать',
                      icon: Copy,
                      run: () => duplicate(entry, id),
                    }
                  )
                if (mayOrganize)
                  actions.push({
                    label: 'Переместить в курс',
                    icon: FolderInput,
                    run: () => moveLessons([lessonId]),
                  })
                actions.push({
                  label: 'Экспортировать JSON',
                  icon: Download,
                  run: () => exportJSON(entry),
                })
                if (!revision)
                  actions.push({
                    label: 'Сохранить на устройство',
                    icon: Monitor,
                    run: () => saveLocally(entry),
                  })
                if (revision && originals.has(deck.id))
                  actions.push({
                    label: 'Скачать исходный JSON до миграции',
                    icon: Download,
                    run: async () => {
                      const raw = await originalDocument('lesson', deck.id)
                      if (raw)
                        download(
                          'atlas-original-' + deck.id + '.json',
                          JSON.stringify(raw, null, 2)
                        )
                    },
                  })
                if (revision)
                  actions.push('separator', {
                    label: 'Удалить с устройства',
                    icon: Trash2,
                    danger: true,
                    run: () => remove(entry),
                  })
                if (props.cloud && entry.cloudMeta && !entry.cloudMeta.deleted)
                  actions.push({
                    label: 'Удалить из облака',
                    icon: Trash2,
                    danger: true,
                    run: () => remove(entry, true),
                  })
                return (
                  <LibraryCard
                    key={deck.id}
                    deck={entry.working || entry.publication ? undefined : deck}
                    name={deck.title}
                    thumbnail={
                      entry.publication?.thumbnail ? (
                        <img
                          src={entry.publication.thumbnail}
                          loading="lazy"
                          decoding="async"
                          alt=""
                        />
                      ) : entry.working || entry.publication ? (
                        <Globe2 size={27} />
                      ) : undefined
                    }
                    first={
                      <>
                        {entry.slideCount === 0
                          ? '—'
                          : countSlides(entry.slideCount ?? deck.slides.length)}
                        {entry.syncConflict && (
                          <span className="course-publication">Конфликт</span>
                        )}
                        {!!revision && (
                          <Monitor
                            className="course-publication"
                            size={13}
                            aria-label="Сохранена на устройстве"
                          />
                        )}
                        {isPublished && (
                          <Globe2
                            className="course-publication"
                            size={13}
                            aria-label="Опубликована"
                          />
                        )}
                      </>
                    }
                    second={
                      <>
                        {location && (
                          <span className="course-location" title={location}>
                            <Folder size={13} aria-hidden="true" />
                            <span>{location}</span>
                          </span>
                        )}
                        {entry.updated > 0 && (
                          <time
                            dateTime={new Date(entry.updated).toISOString()}
                          >
                            {formatDate.format(entry.updated)}
                          </time>
                        )}
                      </>
                    }
                    number={
                      course && settings.sort === 'manual'
                        ? state.lessons[course.id].indexOf(lessonId) + 1
                        : undefined
                    }
                    open={() =>
                      selecting
                        ? selectLesson(lessonId)
                        : editable
                          ? edit(entry)
                          : view(entry)
                    }
                    actions={actions}
                    notice={notice}
                    selected={selecting ? selectedHere : undefined}
                    blockOpen={orderThis}
                    card={orderThis ? drag.card(lessonId) : undefined}
                    controls={
                      orderThis ? (
                        drag.controls(lessonId, deck.title)
                      ) : selecting ? (
                        <input
                          className="course-selection"
                          type="checkbox"
                          aria-label={'Выбрать: ' + deck.title}
                          checked={selectedHere}
                          onChange={() => selectLesson(lessonId)}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
              {!ordering && !selecting && page.next && (
                <button className="secondary" onClick={page.next}>
                  Показать ещё
                </button>
              )}
            </LibraryItems>
          ) : query ? (
            !folders.length && (
              <LibraryState title="Методички не найдены">
                Проверьте название или измените запрос.
              </LibraryState>
            )
          ) : course ? (
            <LibraryState
              title="В курсе пока нет доступных методичек"
              action={
                mayOrganize &&
                rows.some(
                  ({ deck }) => parent.get(deck.id.toLowerCase()) !== id
                ) ? (
                  <button
                    className="lib-button lib-secondary"
                    onClick={() => {
                      setBulkDestination(course.id)
                      openCourse(null)
                    }}
                  >
                    Выбрать в библиотеке
                  </button>
                ) : undefined
              }
            >
              {editable
                ? 'Создайте методичку или переместите существующую из библиотеки.'
                : 'Здесь появятся методички, доступные на этом устройстве.'}
            </LibraryState>
          ) : !folders.length && !props.publicationsLoading ? (
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
          ) : (
            !props.publicationsLoading && (
              <p className="lib-results">Отдельных методичек нет.</p>
            )
          )}
          {props.publicationsLoading && (
            <p className="lib-results" role="status">
              Загружаем публикации…
            </p>
          )}
          {props.publicationsError && (
            <p className="lib-results">
              Часть публикаций недоступна. Локальные методички можно открыть.
            </p>
          )}
        </>
      )}
      {dialog && (
        <CourseDialog
          mode={dialog}
          courses={state.courses}
          close={() => openDialog(undefined)}
          save={saveDialog}
        />
      )}
    </section>
  )
}

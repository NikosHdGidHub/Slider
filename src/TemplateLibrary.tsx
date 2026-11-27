import { LibraryStatus } from './LibraryStatus'
import { desktopEditingMessage } from './libraryNavigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  CloudCheck,
  Copy,
  Download,
  Eye,
  FileText,
  Laptop,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  ChevronDown,
} from 'lucide-react'
import { ActionMenu, type MenuItem } from './ActionMenu'
import { IconButton } from './IconButton'
import {
  LibraryCard,
  LibraryHeader,
  MigrationFailures,
  LibraryItems,
  LibraryState,
  LibraryToolbar,
  selectLibraryRows,
  useLibraryPage,
  type LibrarySettings,
} from './Library'
import { Stage } from './Stage'
import {
  copyDeck,
  instantiate,
  createGridTemplate,
  validateTemplate,
  type Template,
} from './catalog'
import { MAX_DOCUMENT_BYTES, readJSON, type Deck } from './model'
import { originalDocument, originalIds, saveOriginal } from './storage'
import {
  deleteTemplate,
  saveLocal,
  loadCatalogRow,
  type CatalogRow,
  saveTemplateLocally,
} from './templateStore'
import {
  download,
  presentationInstructionsForTemplate,
  presentationInstructionsName,
  templateInstructions,
} from './instructions'
import { AvailabilityControl, AvailabilityProps } from './AvailabilityControl'

export function TemplateLibrary({
  kind,
  setKind,
  rows,
  settings,
  editable,
  loading,
  error,
  connection,
  edit,
  create,
  refresh,
  notice,
  availabilityFor,
}: {
  kind: Template['kind']
  setKind: (kind: Template['kind']) => void
  rows: CatalogRow[]
  settings: LibrarySettings
  editable: boolean
  loading: boolean
  error: string
  connection?: 'offline' | 'error'
  edit: (template: Template, row?: CatalogRow) => void
  create: (deck: Deck) => Promise<void>
  refresh: () => Promise<void>
  notice: (message: string) => void
  availabilityFor?: (row: CatalogRow) => AvailabilityProps
}) {
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const mounted = useRef(false)
  const file = useRef<HTMLInputElement>(null)
  const [previewError, setPreviewError] = useState('')
  const [preview, setPreview] = useState<{
    template: Template
    importing: boolean
    source?: unknown
    row?: CatalogRow
  } | null>(null)
  const [originals, setOriginals] = useState(new Set<string>())
  useEffect(() => {
    let active = true
    void originalIds('template')
      .then((ids) => {
        if (active) setOriginals(ids)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [rows])
  const forKind = rows
    .filter((row) => row.template.kind === kind)
    .map((row) => ({ deck: row.template.deck, row }))
  const visible = selectLibraryRows(forKind, settings)
  const page = useLibraryPage(
    [kind, settings.query, settings.sort].join('/'),
    visible.length
  )

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function run(
    work: () => void | Promise<void>,
    update = false,
    onError = notice
  ) {
    if (active.current) return
    active.current = true
    setBusy(true)
    try {
      await work()
      if (update) await refresh()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.'
      )
    } finally {
      active.current = false
      setBusy(false)
    }
  }
  function previewActions(row: CatalogRow) {
    const menu = actions(row)

    function get(label: string) {
      return menu.find((item) => item !== 'separator' && item.label === label)
    }

    function handler(label: string, closeAfter = false) {
      const action = get(label)

      if (!action || action === 'separator' || action.disabled) {
        return undefined
      }

      return async () => {
        if (busy) return

        try {
          setPreviewError('')

          if (closeAfter) {
            setPreview(null)
          }

          await action.run()
        } catch (error) {
          notice(
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить действие.'
          )
        }
      }
    }

    return {
      edit: handler('Редактировать', true),
      create: handler('Создать методичку', true),
      copy: handler('Создать копию'),
      exportJSON: handler('Экспортировать JSON'),
    }
  }
  function showPreview(row: CatalogRow) {
    return run(async () => {
      const loaded = await loadCatalogRow(row)
      setPreview({ template: loaded.template, importing: false, row: loaded })
    })
  }
  function actions(row: CatalogRow): MenuItem[] {
    const { template, builtin } = row
    const { deck } = template
    const withDocument = (
      work: (loaded: CatalogRow) => void | Promise<void>,
      update = false
    ) => run(async () => work(await loadCatalogRow(row)), update)
    const menu: MenuItem[] = [
      { label: 'Предпросмотр', icon: Eye, run: () => showPreview(row) },
    ]
    if (editable) {
      if (!builtin)
        menu.push({
          label: 'Редактировать',
          icon: Pencil,
          run: () =>
            withDocument((loaded) =>
              edit(structuredClone(loaded.template), loaded)
            ),
        })
      if (template.kind === 'presentation')
        menu.push({
          label: 'Создать методичку',
          icon: Plus,
          run: () =>
            withDocument((loaded) => create(instantiate(loaded.template))),
        })
      menu.push({
        label: 'Создать копию',
        icon: Copy,
        run: () =>
          withDocument((loaded) => {
            const title = deck.title.slice(0, 980) + ' — копия'
            const copy = copyDeck(loaded.template.deck, title)
            copy.master.name = title
            return saveLocal({ ...loaded.template, deck: copy })
          }, true),
      })
      if (!builtin)
        menu.push({
          label: 'Переименовать',
          icon: Pencil,
          run: () => {
            const title = prompt('Название шаблона', deck.title)?.trim()
            if (title && title !== deck.title)
              return withDocument((loaded) => {
                const template = loaded.template
                return saveLocal(
                  {
                    ...template,
                    deck: {
                      ...template.deck,
                      title,
                      master: { ...template.deck.master, name: title },
                    },
                  },
                  loaded
                )
              }, true)
          },
        })
    }
    if (template.kind === 'presentation')
      menu.push('separator', {
        label: 'Инструкция ИИ для презентации',
        icon: FileText,
        run: () =>
          withDocument(async (loaded) => {
            const text = await presentationInstructionsForTemplate(
              loaded.template
            )
            if (mounted.current)
              download(
                presentationInstructionsName(deck.title),
                text,
                'text/plain'
              )
          }),
      })
    menu.push('separator', {
      label: 'Экспортировать JSON',
      icon: Download,
      run: () =>
        withDocument((loaded) =>
          download(
            deck.title.replace(/[\\/]/g, '_') + '.atlas.json',
            JSON.stringify(validateTemplate(loaded.template), null, 2)
          )
        ),
    })
    if (originals.has(deck.id))
      menu.push({
        label: 'Скачать исходный JSON до миграции',
        icon: Download,
        run: async () => {
          const raw = await originalDocument('template', deck.id)
          if (raw)
            download(
              'atlas-original-' + deck.id + '.atlas.json',
              JSON.stringify(raw, null, 2)
            )
        },
      })
    if (!builtin && row.meta && !row.entry)
      menu.push({
        label: 'Сохранить на устройство',
        icon: Laptop,
        run: () => run(() => saveTemplateLocally(row), true),
      })
    if (!builtin && editable && row.entry)
      menu.push('separator', {
        label: 'Удалить с устройства',
        icon: Trash2,
        danger: true,
        run: () => {
          if (
            confirm(
              'Удалить локальную копию шаблона «' +
                deck.title +
                '»? Облачная копия сохранится, если она существует.'
            )
          )
            return run(() => deleteTemplate(row, false), true)
        },
      })

    if (!builtin && editable && row.remote)
      menu.push({
        label: 'Удалить из облака',
        icon: Trash2,
        danger: true,
        run: () => {
          if (
            confirm(
              'Удалить облачную копию шаблона «' +
                deck.title +
                '»? Локальные копии сохранятся.'
            )
          )
            return run(() => deleteTemplate(row, true), true)
        },
      })
    return menu
  }

  const createMenu: MenuItem[] = [
    {
      label: 'Создать вручную',
      icon: Plus,
      run: () =>
        edit(
          createGridTemplate(
            kind,
            kind === 'presentation'
              ? 'Новый главный шаблон'
              : 'Новая компоновка'
          )
        ),
    },
    'separator',
    {
      label: 'Инструкция ИИ для создания шаблона',
      icon: FileText,
      run: () =>
        download(
          'atlas-' + kind + '-template-instructions.txt',
          templateInstructions(kind),
          'text/plain'
        ),
    },
  ]

  return (
    <section className="lib-page">
      <LibraryHeader
        title="Шаблоны"
        action={
          editable ? (
            <ActionMenu
              primary
              label="Создать"
              icon={Plus}
              items={createMenu}
              disabled={busy}
              onError={notice}
            >
              Создать <ChevronDown size={14} aria-hidden="true" />
            </ActionMenu>
          ) : undefined
        }
      />
      {!editable && <p className="lib-phone-note">{desktopEditingMessage}</p>}
      <nav className="lib-tabs" aria-label="Тип шаблона">
        {(['presentation', 'layout'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={tab === kind ? 'page' : undefined}
            onClick={() => setKind(tab)}
          >
            {tab === 'presentation' ? 'Презентации' : 'Компоновки'}
          </button>
        ))}
      </nav>
      <LibraryToolbar
        settings={settings}
        label="Поиск шаблонов"
        actions={
          editable && (
            <IconButton
              className="lib-button lib-icon"
              label="Импортировать шаблон JSON"
              disabled={busy}
              onClick={() => {
                notice('')
                file.current?.click()
              }}
            >
              <Upload />
            </IconButton>
          )
        }
      />
      {(error || connection) && (
        <LibraryStatus level={error ? 'error' : 'warning'} title={error ? 'Не удалось обновить шаблоны' : 'Облачные шаблоны недоступны'}>
          <p>{error || (connection === 'offline' ? 'Офлайн. Доступны локальные шаблоны.' : 'Показаны шаблоны, сохранённые на устройстве.')}</p>
          {connection !== 'offline' && <button className="secondary" disabled={loading || busy} onClick={() => void run(refresh)}>Повторить</button>}
        </LibraryStatus>
      )}
      {busy && <LibraryStatus level="busy" title="Выполняем действие с шаблонами…" />}
      {!visible.length ? (
        loading && !forKind.length ? (
          <LibraryState title="Загружаем шаблоны…" />
        ) : forKind.length ? (
          <LibraryState title="Шаблоны не найдены">
            Проверьте название или измените запрос.
          </LibraryState>
        ) : (
          <LibraryState title="Пока нет шаблонов">
            {editable
              ? 'Создайте шаблон или импортируйте готовый JSON.'
              : 'Здесь появятся сохранённые шаблоны.'}
          </LibraryState>
        )
      ) : (
        <>
          {!busy && (
            <p className="lib-results" role="status">
              Показано {visible.length} из {forKind.length}
            </p>
          )}
          <LibraryItems
            settings={settings}
            columns={['Хранение', '']}
            templates
          >
            {visible.slice(0, page.count).map(({ deck, row }) => (
              <LibraryCard
                key={deck.id}
                deck={row.meta ? undefined : deck}
                name={deck.title}
                first={
                  row.builtin || !editable || !availabilityFor ? (
                    <TemplateStatus row={row} />
                  ) : null
                }
                preflight
                description={row.template.description}
                actions={actions(row)}
                disabled={busy}
                notice={notice}
                open={() => showPreview(row)}
                availability={
                  !row.builtin && editable && availabilityFor ? (
                    <AvailabilityControl {...availabilityFor(row)} compact />
                  ) : undefined
                }
              />
            ))}
          </LibraryItems>
          {page.next && (
            <button className="secondary" onClick={page.next}>
              Показать ещё
            </button>
          )}
        </>
      )}
      {editable && <MigrationFailures kind="template" />}
      {preview && (
        <TemplatePreview
          template={preview.template}
          importing={preview.importing}
          busy={busy}
          error={previewError}
          actions={
            !preview.importing && preview.row
              ? previewActions(preview.row)
              : undefined
          }
          close={() => {
            setPreview(null)
            setPreviewError('')
          }}
          accept={
            editable && preview.importing
              ? () =>
                  run(
                    async () => {
                      setPreviewError('')
                      const deck = copyDeck(preview.template.deck)
                      await saveOriginal('template', deck.id, preview.source)
                      await saveLocal({ ...preview.template, deck })
                      setKind(preview.template.kind)
                      setPreview(null)
                    },
                    true,
                    setPreviewError
                  )
              : undefined
          }
        />
      )}
      {editable && (
        <input
          hidden
          type="file"
          ref={file}
          accept=".json,application/json"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!selected) return
            void run(async () => {
              if (selected.size > MAX_DOCUMENT_BYTES)
                throw new Error('Шаблон превышает 64 МиБ.')
              const source = readJSON(await selected.text())
              setPreview({
                template: validateTemplate(source),
                importing: true,
                source,
              })
            })
          }}
        />
      )}
    </section>
  )
}

function TemplateStatus({ row }: { row: CatalogRow }) {
  const localChange = row.entry?.dirty && row.entry.cloudRevision
  const synced = row.remote && row.entry
  const Icon = row.builtin
    ? Layers3
    : localChange
      ? RefreshCw
      : synced
        ? CloudCheck
        : row.remote
          ? Cloud
          : Laptop
  const text = row.builtin
    ? 'Встроенный'
    : localChange
      ? 'Есть локальные изменения'
      : synced
        ? 'На устройстве и в облаке'
        : row.remote
          ? 'В облаке'
          : 'На устройстве'
  return (
    <span
      className="lib-status"
      data-tone={localChange ? 'attention' : synced ? 'success' : undefined}
    >
      <Icon aria-hidden="true" />
      {text}
    </span>
  )
}

function TemplatePreview({
  template,
  importing,
  busy,
  error,
  close,
  accept,
  actions,
}: {
  template: Template
  importing: boolean
  busy: boolean
  error: string
  close: () => void
  accept?: () => void
  actions?: {
    edit?: () => void | Promise<void>
    create?: () => void | Promise<void>
    copy?: () => void | Promise<void>
    exportJSON?: () => void | Promise<void>
  }
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)
  const { deck } = template
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return createPortal(
    <dialog
      ref={dialog}
      className="lib-dialog"
      aria-labelledby="template-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) close()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close()
      }}
    >
      <header>
        <div>
          <p>
            {importing
              ? 'Предпросмотр импорта'
              : template.kind === 'layout'
                ? 'Компоновка'
                : 'Главный шаблон'}
          </p>
          <h2 id="template-preview-title">{deck.title}</h2>
        </div>
        <IconButton
          className="lib-button lib-icon"
          label="Закрыть"
          disabled={busy}
          onClick={close}
        >
          <X />
        </IconButton>
      </header>
      {template.description && (
        <p className="lib-dialog-description">{template.description}</p>
      )}
      <div className="lib-dialog-slide">
        <Stage deck={deck} slide={deck.slides[index]} diagnostics={importing} />
      </div>
      {error && (
        <p className="lib-preview-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        {deck.slides.length > 1 && (
          <nav aria-label="Слайды шаблона">
            <IconButton
              className="lib-button lib-icon"
              label="Предыдущий слайд"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft />
            </IconButton>
            <span>
              {index + 1} / {deck.slides.length}
            </span>
            <IconButton
              className="lib-button lib-icon"
              label="Следующий слайд"
              disabled={index === deck.slides.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <ArrowRight />
            </IconButton>
          </nav>
        )}
        {actions && (
          <div className="lib-preview-actions">
            {actions.edit && (
              <button
                type="button"
                className="lib-button lib-secondary"
                disabled={busy}
                onClick={actions.edit}
              >
                <Pencil size={16} />
                <span>Редактировать</span>
              </button>
            )}

            {actions.create && (
              <button
                type="button"
                className="lib-button lib-primary"
                disabled={busy}
                onClick={actions.create}
              >
                <Plus size={16} />
                <span>Создать методичку</span>
              </button>
            )}

            {actions.copy && (
              <button
                type="button"
                className="lib-button lib-secondary"
                disabled={busy}
                onClick={actions.copy}
              >
                <Copy size={16} />
                <span>Создать копию</span>
              </button>
            )}

            {actions.exportJSON && (
              <IconButton
                className="lib-button lib-secondary lib-icon"
                label="Экспортировать JSON"
                disabled={busy}
                onClick={actions.exportJSON}
              >
                <Download />
              </IconButton>
            )}
          </div>
        )}
        {accept && (
          <button
            className="lib-button lib-primary"
            disabled={busy}
            onClick={accept}
          >
            Импортировать шаблон
          </button>
        )}
      </footer>
    </dialog>,
    document.body
  )
}

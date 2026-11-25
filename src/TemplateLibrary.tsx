import { desktopEditingMessage } from './libraryNavigation'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  CloudCheck,
  CloudUpload,
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
  LibraryItems,
  LibraryState,
  LibraryToolbar,
  selectLibraryRows,
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
import {
  deleteTemplate,
  saveLocal,
  syncTemplate,
  type CatalogRow,
} from './templateStore'
import {
  download,
  presentationInstructionsForTemplate,
  presentationInstructionsName,
  templateInstructions,
} from './instructions'

export function TemplateLibrary({
  kind,
  setKind,
  rows,
  settings,
  editable,
  onlineOwner,
  loading,
  error,
  connection,
  online,
  edit,
  create,
  refresh,
  notice,
}: {
  kind: Template['kind']
  setKind: (kind: Template['kind']) => void
  rows: CatalogRow[]
  settings: LibrarySettings
  editable: boolean
  onlineOwner: boolean
  online: boolean
  loading: boolean
  error: string
  connection?: 'offline' | 'error'
  edit: (template: Template, row?: CatalogRow) => void
  create: (deck: Deck) => Promise<void>
  refresh: () => Promise<void>
  notice: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const mounted = useRef(false)
  const file = useRef<HTMLInputElement>(null)
  const [previewError, setPreviewError] = useState('')
  const [preview, setPreview] = useState<{
    template: Template
    importing: boolean
  } | null>(null)
  const forKind = rows
    .filter((row) => row.template.kind === kind)
    .map((row) => ({ deck: row.template.deck, row }))
  const visible = selectLibraryRows(forKind, settings)

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

  function actions(row: CatalogRow): MenuItem[] {
    const { template, builtin, entry } = row
    const { deck } = template
    const menu: MenuItem[] = [
      {
        label: 'Предпросмотр',
        icon: Eye,
        run: () => setPreview({ template, importing: false }),
      },
    ]
    if (editable) {
      if (!builtin)
        menu.push({
          label: 'Редактировать',
          icon: Pencil,
          run: () => edit(structuredClone(template), row),
        })
      if (template.kind === 'presentation')
        menu.push({
          label: 'Создать методичку',
          icon: Plus,
          run: () => run(() => create(instantiate(template))),
        })
      menu.push({
        label: 'Создать копию',
        icon: Copy,
        run: () =>
          run(() => {
            const title = deck.title.slice(0, 980) + ' — копия'
            const copy = copyDeck(deck, title)
            copy.master.name = title
            return saveLocal({ ...template, deck: copy })
          }, true),
      })
    }
    if (!builtin)
      menu.push({
        label: 'Переименовать',
        icon: Pencil,
        run: () => {
          const title = prompt('Название шаблона', deck.title)?.trim()
          if (title && title !== deck.title)
            return run(
              () =>
                saveLocal(
                  {
                    ...template,
                    deck: {
                      ...deck,
                      title,
                      master: { ...deck.master, name: title },
                    },
                  },
                  row
                ),
              true
            )
        },
      })
    if (template.kind === 'presentation')
      menu.push('separator', {
        label: 'Инструкция ИИ для презентации',
        icon: FileText,
        run: () =>
          run(async () => {
            const text = await presentationInstructionsForTemplate(template)
            if (mounted.current)
              download(
                presentationInstructionsName(deck.title),
                text,
                'text/plain'
              )
          }),
      })
    menu.push('separator')
    if (!builtin && entry && (onlineOwner || entry.cloudRevision))
      menu.push({
        label: 'Сохранить в облаке',
        icon: CloudUpload,
        disabled: !onlineOwner || !entry.dirty,
        reason: !onlineOwner
          ? 'Восстановите подключение к облаку'
          : !entry.dirty
            ? 'Версия уже сохранена'
            : undefined,
        run: () => run(() => syncTemplate(row), true),
      })
    menu.push({
      label: 'Экспортировать JSON',
      icon: Download,
      run: () =>
        download(
          deck.title.replace(/[\\/]/g, '_') + '.atlas.json',
          JSON.stringify(validateTemplate(template), null, 2)
        ),
    })
    if (!builtin && entry)
      menu.push('separator', {
        label: 'Удалить шаблон',
        icon: Trash2,
        danger: true,
        disabled: !!entry.cloudRevision && !online,
        reason:
          entry.cloudRevision && !online
            ? 'Для удаления облачной копии требуется интернет'
            : undefined,
        run: () => {
          if (
            confirm(
              'Удалить шаблон «' +
                deck.title +
                '» и его сохранённые копии? Созданные методички сохранятся.'
            )
          )
            return run(() => deleteTemplate(row), true)
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
        <div className="lib-notice" role={error ? 'alert' : 'status'}>
          {error
            ? 'Не удалось загрузить шаблоны. ' + error
            : connection === 'offline'
              ? 'Офлайн. Доступны шаблоны, сохранённые на устройстве.'
              : 'Облако недоступно. Показаны шаблоны, сохранённые на устройстве.'}
          {connection !== 'offline' && (
            <button
              className="lib-button lib-text"
              disabled={loading || busy}
              onClick={() => void run(refresh)}
            >
              Повторить
            </button>
          )}
        </div>
      )}
      {busy && (
        <p className="lib-results" role="status">
          Выполняем действие…
        </p>
      )}
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
            {visible.map(({ deck, row }) => (
              <LibraryCard
                key={deck.id}
                deck={deck}
                first={<TemplateStatus row={row} />}
                preflight
                description={row.template.description}
                actions={actions(row)}
                disabled={busy}
                notice={notice}
                open={() =>
                  setPreview({ template: row.template, importing: false })
                }
              />
            ))}
          </LibraryItems>
        </>
      )}
      {preview && (
        <TemplatePreview
          template={preview.template}
          importing={preview.importing}
          busy={busy}
          error={previewError}
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
                      await saveLocal({
                        ...preview.template,
                        deck: copyDeck(preview.template.deck),
                      })
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
              setPreview({
                template: validateTemplate(readJSON(await selected.text())),
                importing: true,
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
}: {
  template: Template
  importing: boolean
  busy: boolean
  error: string
  close: () => void
  accept?: () => void
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

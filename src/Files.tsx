import { useEffect, useRef, useState } from 'react'
import {
  Cloud,
  FileCode2,
  FileText,
  FolderPlus,
  ImageOff,
  Laptop,
  LockKeyhole,
  Presentation,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react'
import { digest } from './digest'
import { publicationUsage, removeUnusedFile } from './fileUsage'
import { originalImage } from './media'
import {
  resources,
  createFolder,
  listFolders,
  storeFile,
  imageUrl,
  updateFile,
  downloadFile,
  resourceKey,
  type Resource,
} from './resources'
import { currentWorkingOwner, type Entry } from './storage'
import { ResourceGallery, ResourcePicker } from './ResourceGallery'

const formatOf = (mime: string) =>
  ({
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/webp': 'WebP',
    'application/pdf': 'PDF',
    'application/json': 'JSON',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PPTX',
  })[mime] ?? 'Файл'
const shortSize = (size: number) =>
  size < 1024 * 1024
    ? Math.max(1, Math.round(size / 1024)) + ' КиБ'
    : new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(
        size / (1024 * 1024)
      ) + ' МиБ'
const messageOf = (error: unknown) =>
  typeof error === 'object' && error && 'message' in error
    ? String(error.message)
    : 'Не удалось выполнить операцию.'

function EmptyFiles({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="files-empty">
      <ImageOff size={26} aria-hidden="true" />
      <strong>{title}</strong>
      {children}
    </div>
  )
}

function SearchBox({
  query,
  onChange,
  placeholder = 'Поиск по названию',
}: {
  query: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="files-search">
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function FileLibrary({
  entries,
  openLesson,
  openJSON,
  owner,
  online,
  allowed,
  login,
}: {
  entries: Entry[]
  openLesson: (entry: Entry) => void
  openJSON?: (text: string) => Promise<void>
  owner: boolean
  online: boolean
  allowed: boolean
  login: () => void
}) {
  const [tab, setTab] = useState<'local' | 'cloud'>('local')
  return (
    <section className="files-library" aria-label="Библиотека файлов">
      <p className="files-description">
        Изображения из ваших методичек и материалы в облачном хранилище.
      </p>
      <div className="files-tabs" aria-label="Расположение файлов" role="group">
        <button aria-pressed={tab === 'local'} onClick={() => setTab('local')}>
          <Laptop size={18} />
          На устройстве
        </button>
        <button aria-pressed={tab === 'cloud'} onClick={() => setTab('cloud')}>
          <Cloud size={18} />В облаке
        </button>
      </div>
      {tab === 'local' ? (
        allowed ? (
          <ResourceGallery
            key={currentWorkingOwner() ?? 'local'}
            mode="local"
            owner={currentWorkingOwner()}
            lessonEntries={entries}
            openLesson={openLesson}
          />
        ) : (
          <EmptyFiles title="Войдите, чтобы открыть файлы своих методичек">
            <button className="secondary" onClick={login}>
              Войти
            </button>
          </EmptyFiles>
        )
      ) : !online ? (
        <EmptyFiles title="Облачная библиотека недоступна без интернета">
          <p>
            Локальные методички и сохранённые в них изображения остаются на
            устройстве.
          </p>
        </EmptyFiles>
      ) : !owner ? (
        <EmptyFiles title="Войдите, чтобы открыть облачную библиотеку">
          <button className="secondary" onClick={login}>
            Войти
          </button>
        </EmptyFiles>
      ) : (
        <Files openJSON={openJSON} />
      )}
    </section>
  )
}

function CloudFiles({
  pick,
  openJSON,
}: {
  pick?: (image: Awaited<ReturnType<typeof originalImage>>) => void
  openJSON?: (text: string) => Promise<void>
}) {
  const [rows, setRows] = useState<Resource[]>()
  const [folders, setFolders] = useState<string[]>([])
  const [usage, setUsage] =
    useState<Awaited<ReturnType<typeof publicationUsage>>>()
  const [usageError, setUsageError] = useState('')
  const [query, search] = useState('')
  const [kind, filter] = useState('')
  const [folder, setFolder] = useState('')
  const [message, status] = useState('')
  const [busy, working] = useState(false)
  const [confirmFile, askDelete] = useState<Resource>()
  const [preview, setPreview] = useState<Resource>()
  const upload = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  async function load() {
    const [files, dirs] = await Promise.all([resources(), listFolders()])
    setRows(files)
    setFolders(dirs)
    if (pick) return
    setUsage(undefined)
    setUsageError('')
    try {
      setUsage(await publicationUsage())
    } catch (error) {
      setUsageError(messageOf(error))
    }
  }
  async function run(fn: () => Promise<void>, refresh = false) {
    working(true)
    status('')
    try {
      await fn()
    } catch (error) {
      status(messageOf(error))
    } finally {
      if (refresh) {
        try {
          await load()
        } catch (error) {
          status(messageOf(error))
        }
      }
      working(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void run(load)
    return () => {
      mounted.current = false
    }
  }, [])
  const visible =
    rows?.filter(
      (row) =>
        !(
          row.bucket === 'images' &&
          ['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)
        ) &&
        (!folder || row.folder === folder) &&
        row.mime.startsWith(kind) &&
        row.name.toLowerCase().includes(query.trim().toLowerCase())
    ) ?? []
  const options = [
    ...new Set([
      ...folders,
      ...(rows ?? []).map((row) => row.folder).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'ru'))
  const uploadButton = (
    <button
      className="primary files-upload"
      onClick={() => upload.current?.click()}
    >
      <Upload size={16} />
      Загрузить файл
    </button>
  )
  return (
    <section
      aria-label={pick ? 'Облачные изображения' : 'Облачные файлы'}
      aria-busy={busy}
    >
      <fieldset
        className="files-controls"
        disabled={busy || !!preview || !!confirmFile}
      >
        <div className="files-bar">
          <SearchBox query={query} onChange={search} />
          {!pick && (
            <select
              aria-label="Тип файла"
              value={kind}
              onChange={(e) => filter(e.target.value)}
            >
              <option value="">Все форматы</option>
              <option value="image/">Изображения</option>
              <option value="application/pdf">PDF</option>
              <option value="application/vnd">PPTX</option>
              <option value="application/json">JSON</option>
            </select>
          )}
          <select
            aria-label="Папка"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="">Все папки</option>
            {options.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          {!pick && (
            <button
              className="secondary"
              onClick={() => {
                const name = prompt('Название новой папки')?.trim()
                if (name)
                  void run(async () => {
                    await createFolder(name)
                    setFolder(name)
                  }, true)
              }}
            >
              <FolderPlus size={16} />
              Создать папку
            </button>
          )}
          <button
            className="secondary files-refresh"
            title="Обновить список"
            aria-label="Обновить список"
            onClick={() => void run(load)}
          >
            <RefreshCw size={16} />
          </button>
          {!pick && (
            <>
              <input
                hidden
                ref={upload}
                type="file"
                multiple
                accept=".pdf,.pptx,.json"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (!files.length) return
                  void run(async () => {
                    const errors: string[] = []
                    for (const file of files) {
                      try {
                        if (!/\.(pdf|pptx|json)$/i.test(file.name))
                          throw Error(
                            'Изображения загружайте через приватную библиотеку.'
                          )
                        await storeFile(file, file.name, folder)
                      } catch (error) {
                        errors.push(file.name + ' — ' + messageOf(error))
                      }
                    }
                    if (errors.length) throw Error(errors.join(' · '))
                  }, true)
                }}
              />
              {rows?.length || !rows ? uploadButton : null}
            </>
          )}
        </div>
        {busy && (
          <p role="status" className="files-note">
            Работаем с облачным хранилищем…
          </p>
        )}
        {message && (
          <p role="alert" className="files-error">
            {message}
          </p>
        )}
        {usageError && (
          <p className="files-note">
            Проверка публикаций не завершена. {usageError} Обновите список,
            чтобы повторить проверку.
          </p>
        )}
        {rows && (!kind || kind === 'image/') && (
          <ResourceGallery
            mode="cloud"
            owner={currentWorkingOwner()}
            legacyRows={rows}
            publicationRefs={usage}
            query={query}
            folder={folder}
            onReload={load}
            folders={options}
          />
        )}
        {rows &&
          kind !== 'image/' &&
          (!visible.length ? (
            <EmptyFiles
              title={
                rows.some(
                  (row) =>
                    !(
                      row.bucket === 'images' &&
                      ['image/png', 'image/jpeg', 'image/webp'].includes(
                        row.mime
                      )
                    )
                )
                  ? 'По вашему запросу ничего не найдено'
                  : pick
                    ? 'В облаке пока нет изображений'
                    : 'Нет других файлов (PDF, PPTX, JSON)'
              }
            >
              {!pick && !rows.length && uploadButton}
            </EmptyFiles>
          ) : (
            <div className="file-grid">
              {visible.map((row) => (
                <CloudFileCard
                  key={resourceKey(row)}
                  row={row}
                  refs={usage?.get(resourceKey(row)) ?? []}
                  usageKnown={!!usage}
                  options={options}
                  run={run}
                  openJSON={openJSON}
                  onPreview={
                    !pick && row.bucket === 'images'
                      ? () => setPreview(row)
                      : undefined
                  }
                  pick={
                    pick
                      ? () =>
                          void run(async () => {
                            const blob = await downloadFile(row)
                            if (row.sha && (await digest(blob)) !== row.sha)
                              throw Error(
                                'Контрольная сумма изображения не совпала.'
                              )
                            const image = await originalImage(
                              new Blob([blob], { type: row.mime })
                            )
                            if (mounted.current) pick(image)
                          })
                      : undefined
                  }
                  onRequestDelete={() =>
                    void run(async () => {
                      const latest = await publicationUsage()
                      setUsage(latest)
                      if (latest.has(resourceKey(row)))
                        throw Error('Файл используется в публикациях.')
                      askDelete(row)
                    })
                  }
                />
              ))}
            </div>
          ))}
      </fieldset>
      {preview && (
        <div className="overlay">
          <section
            className="dialog file-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-preview-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPreview(undefined)
            }}
          >
            <h2 id="file-preview-title">{preview.name}</h2>
            <img src={imageUrl(preview)} alt={preview.name} />
            <button
              autoFocus
              className="secondary"
              onClick={() => setPreview(undefined)}
            >
              Закрыть
            </button>
          </section>
        </div>
      )}
      {confirmFile && (
        <div className="overlay">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-delete-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') askDelete(undefined)
            }}
          >
            <h2 id="file-delete-title">Удалить файл из облака?</h2>
            <p className="file-delete-name">{confirmFile.name}</p>
            <div className="files-confirm">
              <button
                autoFocus
                className="secondary"
                onClick={() => askDelete(undefined)}
              >
                Отмена
              </button>
              <button
                className="primary"
                onClick={() => {
                  askDelete(undefined)
                  void run(() => removeUnusedFile(confirmFile), true)
                }}
              >
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function CloudFileCard({
  row,
  refs,
  usageKnown,
  options,
  pick,
  openJSON,
  run,
  onRequestDelete,
  onPreview,
}: {
  row: Resource
  refs: { id: string; title: string }[]
  usageKnown: boolean
  options: string[]
  pick?: () => void
  openJSON?: (text: string) => Promise<void>
  run: (fn: () => Promise<void>, refresh?: boolean) => Promise<void>
  onRequestDelete: () => void
  onPreview?: () => void
}) {
  const DocIcon =
    row.mime === 'application/json'
      ? FileCode2
      : row.mime.includes('presentation')
        ? Presentation
        : FileText
  return (
    <article className="file-card">
      <div className="file-thumb">
        {row.bucket === 'images' ? (
          onPreview ? (
            <button
              className="file-thumb-preview"
              aria-label={'Открыть изображение ' + row.name}
              onClick={onPreview}
            >
              <img src={imageUrl(row)} alt="" loading="lazy" />
            </button>
          ) : (
            <img src={imageUrl(row)} alt="" loading="lazy" />
          )
        ) : (
          <span>
            <DocIcon size={33} aria-hidden="true" />
            {formatOf(row.mime)}
          </span>
        )}
      </div>
      <div className="file-body">
        <h2>{row.name}</h2>
        <p className="file-meta">
          {formatOf(row.mime)} ·{' '}
          {row.size ? shortSize(row.size) : 'Размер не указан'}
          {row.folder && ' · ' + row.folder}
        </p>
        {!pick && (
          <p className="file-meta">
            {new Date(row.created_at).toLocaleDateString('ru')}
          </p>
        )}
        {pick ? (
          <button className="secondary" onClick={pick}>
            Выбрать
          </button>
        ) : (
          <>
            {refs.length ? (
              <details className="file-links">
                <summary>
                  <LockKeyhole size={14} aria-hidden="true" /> Используется в{' '}
                  {refs.length}{' '}
                  {refs.length === 1 ? 'публикации' : 'публикациях'}
                </summary>
                {refs.map((ref) => (
                  <a className="file-link" key={ref.id} href={'#p/' + ref.id}>
                    {ref.title}
                  </a>
                ))}
              </details>
            ) : (
              <p className="file-usage">
                {usageKnown
                  ? 'Не используется в публикациях'
                  : 'Использование не проверено'}
              </p>
            )}
            <details className="file-actions">
              <summary>
                Действия <span aria-hidden="true">⋯</span>
              </summary>
              <div>
                <button
                  onClick={() =>
                    void run(async () => {
                      const url = URL.createObjectURL(await downloadFile(row))
                      const a = document.createElement('a')
                      a.href = url
                      a.download = row.name
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(url), 5000)
                    })
                  }
                >
                  Скачать
                </button>
                {row.mime === 'application/json' && openJSON && (
                  <button
                    onClick={() =>
                      void run(async () =>
                        openJSON(await (await downloadFile(row)).text())
                      )
                    }
                  >
                    Импортировать
                  </button>
                )}
                <button
                  onClick={() => {
                    const name = prompt('Название файла', row.name)?.trim()
                    if (name) void run(() => updateFile(row, { name }), true)
                  }}
                >
                  Переименовать
                </button>
                <label>
                  Переместить в папку
                  <select
                    value={row.folder}
                    onChange={(e) =>
                      void run(
                        () =>
                          updateFile(row, {
                            folder: e.target.value,
                          }),
                        true
                      )
                    }
                  >
                    <option value="">Без папки</option>
                    {options.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                {usageKnown && !refs.length && row.bucket !== 'images' && (
                  <button className="file-delete" onClick={onRequestDelete}>
                    Удалить из облака
                  </button>
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </article>
  )
}

export function Files({
  pick,
  openJSON,
}: {
  pick?: (image: Awaited<ReturnType<typeof originalImage>>) => void
  openJSON?: (text: string) => Promise<void>
}) {
  return pick ? (
    <ResourcePicker pick={pick} />
  ) : (
    <CloudFiles openJSON={openJSON} />
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Cloud,
  FileCode2,
  FileText,
  FolderPlus,
  Laptop,
  Presentation,
  RefreshCw,
  Plus,
  Settings,
  SlidersHorizontal,
  Download,
  Pencil,
  Link2,
  Info,
  Trash2,
  Folder,
  Eye,
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
  uploadLibraryImage,
  type Resource,
} from './resources'
import { currentWorkingOwner, retainLibraryImage, type Entry } from './storage'
import {
  ResourceGallery,
  ResourcePicker,
  importedBlob,
} from './ResourceGallery'
import { ResourceMaintenance } from './ResourceMaintenance'
import { ActionMenu, ActionMenus, type MenuItem } from './ActionMenu'
import {
  LibraryHeader,
  LibraryToolbar,
  LibraryItems,
  LibraryCard,
  LibraryState,
  useLibrarySettings,
  normalizeLibraryQuery,
} from './Library'
import { LibraryStatus } from './LibraryStatus'
import { FileDialog } from './FileDialog'
import { useStoredPreference } from './workspacePreferences'

type Props = {
  entries: Entry[]
  openLesson: (entry: Entry) => void
  openJSON?: (text: string) => Promise<void>
  owner: boolean
  online: boolean
  allowed: boolean
  login: () => void
  onMaintenance?: () => Promise<void>
}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : String((e as { message?: string })?.message ?? e)
const isImage = (r: Resource) =>
  r.bucket === 'images' &&
  ['image/png', 'image/jpeg', 'image/webp'].includes(r.mime)
const size = (n: number) =>
  !n
    ? '—'
    : n < 1048576
      ? Math.max(1, Math.round(n / 1024)) + ' КиБ'
      : (n / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 }) +
        ' МиБ'
const format = (r: Resource) =>
  r.mime === 'application/json'
    ? 'JSON'
    : r.mime === 'application/pdf'
      ? 'PDF'
      : r.mime.includes('presentation')
        ? 'PPTX'
        : r.mime.split('/')[1]?.toUpperCase() || 'Файл'
const fileDownload = async (r: Resource) => {
  const url = URL.createObjectURL(await downloadFile(r))
  const a = document.createElement('a')
  a.href = url
  a.download = r.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
type Catalog = {
  rows: Resource[]
  folders: string[]
  usage?: Awaited<ReturnType<typeof publicationUsage>>
  usageError: string
}
export function FileLibrary(props: Props) {
  // Account change must not expose the preceding owner's cached view.
  return <FileLibraryBody key={currentWorkingOwner() ?? 'local'} {...props} />
}
function FileLibraryBody({
  entries,
  openLesson,
  openJSON,
  owner,
  online,
  allowed,
  login,
  onMaintenance,
}: Props) {
  const scope = currentWorkingOwner()
  const settings = useLibrarySettings('files')
  const [tab, setTab] = useStoredPreference<'local' | 'cloud'>(
    'atlas.files.tab',
    'local',
    (v) => (v === 'local' || v === 'cloud' ? v : undefined)
  )
  const [kind, setKind] = useState('')
  const [filter, setFilter] = useState('all')
  const [folder, setFolder] = useState('')
  const [catalog, setCatalog] = useState<Catalog>()
  const [epoch, refresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [maintenance, setMaintenance] = useState(false)
  const [filters, setFilters] = useState(false)
  const [detail, setDetail] = useState<{
    key: string
    kind: 'info' | 'links' | 'move' | 'preview' | 'delete'
  }>()
  const upload = useRef<HTMLInputElement>(null)
  const uploadKind = useRef<'image' | 'document'>('image')
  const lock = useRef(false)
  const active = useRef(true)
  const canCloud = !!scope && owner && online && allowed
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    if (!owner || !allowed) {
      setCatalog(undefined)
      setDetail(undefined)
    }
  }, [owner, allowed])
  useEffect(() => {
    if (tab !== 'cloud' || !canCloud) {
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    setLoadError('')
    void (async () => {
      const [rows, dirs] = await Promise.all([resources(), listFolders()])
      let usage: Catalog['usage'],
        usageError = ''
      try {
        usage = await publicationUsage()
      } catch (e) {
        usageError = errorText(e)
      }
      if (live && scope === currentWorkingOwner())
        setCatalog({ rows, folders: dirs, usage, usageError })
    })()
      .catch((e) => {
        if (live) setLoadError(errorText(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [tab, canCloud, scope, epoch])
  const reload = async () => {
    if (tab === 'cloud' && canCloud) setLoading(true)
    refresh((n) => n + 1)
  }
  async function run(fn: () => Promise<void>, reloadAfter = false) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (scope !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
      await fn()
    } catch (e) {
      if (active.current) setError(errorText(e))
    } finally {
      lock.current = false
      if (active.current) {
        if (reloadAfter) {
          if (tab === 'cloud' && canCloud) setLoading(true)
          refresh((n) => n + 1)
        }
        setBusy(false)
      }
    }
  }
  function pickUpload(type: 'image' | 'document') {
    if (!allowed || (tab === 'cloud' && !canCloud)) return
    uploadKind.current = type
    const input = upload.current
    if (input) {
      input.accept =
        type === 'image' ? '.png,.jpg,.jpeg,.webp,.svg' : '.pdf,.pptx,.json'
      input.click()
    }
  }
  const folders = [
    ...new Set([
      ...(catalog?.folders ?? []),
      ...(catalog?.rows ?? []).map((r) => r.folder).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'ru'))
  const blocked = busy || loading || !!loadError || !canCloud
  const rows = (catalog?.rows ?? [])
    .filter(
      (r) =>
        !isImage(r) &&
        (!folder || r.folder === folder) &&
        r.mime.startsWith(kind) &&
        normalizeLibraryQuery(r.name).includes(
          normalizeLibraryQuery(settings.query)
        )
    )
    .sort(
      (a, b) =>
        (settings.sort === 'reverse' ? -1 : 1) *
        a.name.localeCompare(b.name, 'ru', { numeric: true })
    )
  const selected = catalog?.rows.find((r) => resourceKey(r) === detail?.key)
  const showImages = tab === 'local' || !kind || kind === 'image/'
  const showDocs = tab === 'cloud' && kind !== 'image/'
  const addItems: MenuItem[] = [
    { label: 'Добавить изображение', run: () => pickUpload('image') },
  ]
  if (tab === 'cloud')
    addItems.push(
      {
        label: 'Загрузить PDF, PPTX или JSON',
        run: () => pickUpload('document'),
      },
      {
        label: 'Создать папку',
        icon: FolderPlus,
        run: () => {
          const name = prompt('Название новой папки')?.trim()
          if (name)
            return run(async () => {
              await createFolder(name)
              setFolder(name)
            }, true)
        },
      }
    )
  const refs = (r: Resource) => catalog?.usage?.get(resourceKey(r)) ?? []
  const requestDelete = (r: Resource) =>
    run(async () => {
      if (blocked || !catalog?.usage || r.bucket === 'images')
        throw Error(
          'Удаление заблокировано: сначала обновите проверку использования.'
        )
      const latest = await publicationUsage()
      if (latest.has(resourceKey(r)))
        throw Error('Файл используется в публикациях.')
      setDetail({ key: resourceKey(r), kind: 'delete' })
    })
  function actions(r: Resource): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: 'Просмотр и свойства',
        icon: Eye,
        run: () => setDetail({ key: resourceKey(r), kind: 'preview' }),
      },
      {
        label: 'Скачать',
        icon: Download,
        run: () => run(() => fileDownload(r)),
      },
      {
        label: 'Связанные публикации',
        icon: Link2,
        run: () => setDetail({ key: resourceKey(r), kind: 'links' }),
      },
      {
        label: 'Переименовать',
        icon: Pencil,
        run: () => {
          const name = prompt('Название файла', r.name)?.trim()
          if (name) return run(() => updateFile(r, { name }), true)
        },
      },
      {
        label: 'Переместить в папку',
        icon: Folder,
        run: () => setDetail({ key: resourceKey(r), kind: 'move' }),
      },
    ]
    if (r.mime === 'application/json' && openJSON)
      items.push({
        label: 'Импортировать методичку',
        icon: FileCode2,
        run: () =>
          run(async () => {
            await openJSON(await (await downloadFile(r)).text())
          }),
      })
    if (catalog?.usage && !refs(r).length && r.bucket !== 'images')
      items.push('separator', {
        label: 'Удалить из облака',
        icon: Trash2,
        danger: true,
        disabled: blocked,
        run: () => requestDelete(r),
      })
    return items
  }
  return (
    <ActionMenus>
      <section
        className="lib-page atlas-files-page"
        aria-label="Библиотека файлов"
      >
        <LibraryHeader
          title="Мои файлы"
          action={
            <div className="atlas-file-heading-actions">
              {allowed && (
                <button
                  className="lib-button lib-icon"
                  aria-label="Обслуживание библиотеки"
                  title="Обслуживание библиотеки"
                  disabled={busy}
                  onClick={() => setMaintenance(true)}
                >
                  <Settings size={19} />
                </button>
              )}
              <ActionMenu
                primary
                icon={Plus}
                label="Добавить"
                items={addItems}
                disabled={!allowed || busy || (tab === 'cloud' && !canCloud)}
                onError={setError}
              >
                Добавить
              </ActionMenu>
            </div>
          }
        />
        <nav className="lib-tabs" aria-label="Расположение файлов">
          <button
            aria-current={tab === 'local' ? 'page' : undefined}
            onClick={() => {
              setTab('local')
              setDetail(undefined)
              setError('')
            }}
          >
            <Laptop size={17} /> На устройстве
          </button>
          <button
            aria-current={tab === 'cloud' ? 'page' : undefined}
            onClick={() => {
              setTab('cloud')
              setDetail(undefined)
              setError('')
            }}
          >
            <Cloud size={17} /> В облаке
          </button>
        </nav>
        <LibraryToolbar
          settings={settings}
          label="Поиск файлов"
          actions={
            <>
              <button
                className="lib-button lib-icon"
                aria-label="Фильтры"
                title="Фильтры"
                onClick={() => setFilters(true)}
              >
                <SlidersHorizontal size={18} />
              </button>
              <button
                className="lib-button lib-icon"
                aria-label="Обновить файлы"
                title="Обновить файлы"
                disabled={busy || loading || (tab === 'cloud' && !canCloud)}
                onClick={() => void reload()}
              >
                <RefreshCw size={17} />
              </button>
            </>
          }
        />
        <input
          hidden
          ref={upload}
          type="file"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            const type = uploadKind.current,
              destination = tab,
              targetFolder = folder
            if (!files.length) return
            void run(async () => {
              const failures: string[] = []
              for (const file of files) {
                try {
                  if (scope !== currentWorkingOwner())
                    throw Error('Изменился аккаунт.')
                  if (type === 'image') {
                    if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name))
                      throw Error('Неподдерживаемый формат изображения.')
                    const blob = await importedBlob(file),
                      name = file.name.replace(/\.svg$/i, '.webp')
                    if (destination === 'cloud') {
                      if (!canCloud || !scope) throw Error('Облако недоступно.')
                      await uploadLibraryImage(scope, blob, name)
                    } else
                      await retainLibraryImage(
                        scope,
                        await digest(blob),
                        blob,
                        name
                      )
                  } else {
                    if (
                      destination !== 'cloud' ||
                      !canCloud ||
                      !/\.(pdf|pptx|json)$/i.test(file.name)
                    )
                      throw Error(
                        'Неподдерживаемый формат или облако недоступно.'
                      )
                    await storeFile(file, file.name, targetFolder)
                  }
                } catch (ex) {
                  failures.push(file.name + ': ' + errorText(ex))
                }
              }
              if (failures.length) throw Error(failures.join(' · '))
            }, true)
          }}
        />
        {error && (
          <LibraryStatus level="error" title="Операция с файлами не завершена">
            <p>{error}</p>
            <button className="secondary" onClick={() => setError('')}>
              Закрыть сообщение
            </button>
          </LibraryStatus>
        )}
        {tab === 'cloud' && loadError && (
          <LibraryStatus level="error" title="Не удалось обновить файлы">
            <p>{loadError}</p>
            <button className="secondary" onClick={() => void reload()}>
              Повторить
            </button>
          </LibraryStatus>
        )}
        {tab === 'cloud' && catalog?.usageError && (
          <LibraryStatus
            level="warning"
            title="Использование файлов проверено не полностью"
          >
            <p>{catalog.usageError}. Удаление заблокировано.</p>
            <button className="secondary" onClick={() => void reload()}>
              Повторить проверку
            </button>
          </LibraryStatus>
        )}
        {(busy || loading) && (
          <LibraryStatus level="busy" title="Работаем с файлами…" />
        )}
        {!allowed ? (
          <LibraryState
            title="Войдите, чтобы открыть файлы"
            action={
              <button className="secondary" onClick={login}>
                Войти
              </button>
            }
          />
        ) : tab === 'cloud' && !owner ? (
          <LibraryState
            title="Войдите, чтобы открыть облачные файлы"
            action={
              <button className="secondary" onClick={login}>
                Войти
              </button>
            }
          />
        ) : tab === 'cloud' && !catalog ? (
          <LibraryState
            title={
              !online
                ? 'Облако недоступно без интернета'
                : loadError
                  ? 'Каталог файлов недоступен'
                  : 'Загружаем файлы…'
            }
            error={!!loadError}
          />
        ) : (
          <>
            {tab === 'cloud' && !online && (
              <LibraryStatus level="warning" title="Облачные файлы: офлайн">
                <p>
                  Показан последний полученный список. Облачные действия
                  отключены.
                </p>
              </LibraryStatus>
            )}
            {showImages && (
              <ResourceGallery
                key={tab + ':' + scope}
                mode={tab}
                owner={scope}
                lessonEntries={entries}
                openLesson={openLesson}
                settings={settings}
                usageFilter={filter}
                refreshEpoch={epoch}
                blocked={tab === 'cloud' ? blocked : busy}
                legacyRows={tab === 'cloud' ? catalog?.rows : undefined}
                publicationRefs={tab === 'cloud' ? catalog?.usage : undefined}
                folder={tab === 'cloud' ? folder : undefined}
                folders={folders}
                onReload={reload}
              />
            )}
            {showDocs && rows.length > 0 && (
              <section className="atlas-files-documents">
                <h2 className="course-section-title">Другие файлы</h2>
                <LibraryItems
                  settings={settings}
                  columns={['Формат и размер', 'Использование']}
                >
                  {rows.map((r) => {
                    const Icon =
                      r.mime === 'application/json'
                        ? FileCode2
                        : r.mime.includes('presentation')
                          ? Presentation
                          : FileText
                    return (
                      <LibraryCard
                        key={resourceKey(r)}
                        name={r.name}
                        card={{ className: 'atlas-resource-card' }}
                        thumbnail={
                          r.bucket === 'images' ? (
                            <img src={imageUrl(r)} alt="" loading="lazy" />
                          ) : (
                            <Icon size={34} />
                          )
                        }
                        first={format(r) + ' · ' + size(r.size)}
                        second={
                          <button
                            className="atlas-resource-links"
                            onClick={() =>
                              setDetail({ key: resourceKey(r), kind: 'links' })
                            }
                          >
                            {catalog?.usage
                              ? 'Связей: ' + refs(r).length
                              : 'Не проверено'}
                          </button>
                        }
                        open={() =>
                          setDetail({ key: resourceKey(r), kind: 'preview' })
                        }
                        actions={actions(r)}
                        disabled={blocked}
                        notice={setError}
                      />
                    )
                  })}
                </LibraryItems>
              </section>
            )}
            {showDocs && !showImages && !rows.length && (
              <LibraryState title="Нет файлов по фильтру" />
            )}
          </>
        )}
        {filters && (
          <FileDialog title="Фильтры файлов" close={() => setFilters(false)}>
            <div className="atlas-file-detail-list">
              {tab === 'cloud' && (
                <>
                  <label>
                    Формат
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="">Все форматы</option>
                      <option value="image/">Изображения</option>
                      <option value="application/pdf">PDF</option>
                      <option value="application/vnd">PPTX</option>
                      <option value="application/json">JSON</option>
                    </select>
                  </label>
                  <label>
                    Папка
                    <select
                      value={folder}
                      onChange={(e) => setFolder(e.target.value)}
                    >
                      <option value="">Все папки</option>
                      {folders.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label>
                Использование изображений
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Все</option>
                  <option value="used">Используются</option>
                  <option value="unused">Не используются</option>
                  <option value="trash">В корзине</option>
                </select>
              </label>
              <div className="atlas-file-dialog-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setKind('')
                    setFolder('')
                    setFilter('all')
                  }}
                >
                  Сбросить
                </button>
                <button className="primary" onClick={() => setFilters(false)}>
                  Готово
                </button>
              </div>
            </div>
          </FileDialog>
        )}
        {allowed && (
          <ResourceMaintenance
            owner={scope}
            online={online && owner}
            open={maintenance}
            onClose={() => setMaintenance(false)}
            onComplete={async () => {
              await onMaintenance?.()
              await reload()
            }}
          />
        )}
        {selected && detail && (
          <FileDialog
            title={
              detail.kind === 'links'
                ? 'Связанные публикации'
                : detail.kind === 'move'
                  ? 'Переместить в папку'
                  : detail.kind === 'delete'
                    ? 'Удалить файл из облака?'
                    : selected.name
            }
            close={() => setDetail(undefined)}
            locked={busy}
          >
            {detail.kind === 'links' ? (
              <div className="atlas-file-detail-list">
                {!catalog?.usage ? (
                  <p>Использование не проверено.</p>
                ) : !refs(selected).length ? (
                  <p>Связанные публикации не найдены.</p>
                ) : (
                  refs(selected).map((r) => (
                    <a
                      key={r.id}
                      className="file-link"
                      href={'#p/' + r.id}
                      onClick={() => setDetail(undefined)}
                    >
                      {r.title}
                    </a>
                  ))
                )}
              </div>
            ) : detail.kind === 'move' ? (
              <label>
                Папка
                <select
                  disabled={blocked}
                  value={selected.folder}
                  onChange={(e) => {
                    const value = e.target.value
                    void run(async () => {
                      await updateFile(selected, { folder: value })
                      setDetail(undefined)
                    }, true)
                  }}
                >
                  <option value="">Без папки</option>
                  {folders.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            ) : detail.kind === 'delete' ? (
              <>
                <p>{selected.name}</p>
                <div className="atlas-file-dialog-actions">
                  <button
                    className="secondary"
                    onClick={() => setDetail(undefined)}
                  >
                    Отмена
                  </button>
                  <button
                    className="primary"
                    disabled={
                      blocked || !catalog?.usage || !!refs(selected).length
                    }
                    onClick={() =>
                      void run(async () => {
                        await removeUnusedFile(selected)
                        setDetail(undefined)
                      }, true)
                    }
                  >
                    Удалить
                  </button>
                </div>
              </>
            ) : (
              <>
                <dl className="atlas-file-properties">
                  <dt>Формат</dt>
                  <dd>{format(selected)}</dd>
                  <dt>Размер</dt>
                  <dd>{size(selected.size)}</dd>
                  <dt>Папка</dt>
                  <dd>{selected.folder || 'Без папки'}</dd>
                  <dt>Добавлен</dt>
                  <dd>
                    {new Date(selected.created_at).toLocaleDateString('ru')}
                  </dd>
                  <dt>Хранилище</dt>
                  <dd>Облако</dd>
                </dl>
                {selected.bucket === 'images' && (
                  <img
                    className="atlas-file-preview-image"
                    src={imageUrl(selected)}
                    alt={selected.name}
                  />
                )}
                <div className="atlas-file-dialog-actions">
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={() => void run(() => fileDownload(selected))}
                  >
                    <Download size={16} /> Скачать
                  </button>
                  {selected.mime === 'application/json' && openJSON && (
                    <button
                      className="primary"
                      disabled={blocked}
                      onClick={() =>
                        void run(async () => {
                          await openJSON(
                            await (await downloadFile(selected)).text()
                          )
                          setDetail(undefined)
                        })
                      }
                    >
                      Импортировать
                    </button>
                  )}
                </div>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </FileDialog>
        )}
      </section>
    </ActionMenus>
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
    <FileLibrary
      entries={[]}
      openLesson={() => {}}
      openJSON={openJSON}
      owner={!!currentWorkingOwner()}
      online={navigator.onLine}
      allowed={!!currentWorkingOwner()}
      login={() => {}}
    />
  )
}

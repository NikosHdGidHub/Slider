import { useEffect, useRef, useState } from 'react'
import { digest } from './digest'
import { originalImage, optimize } from './media'
import {
  imageSources,
  storageReference,
  assertPrivatePublicationUnused,
} from './fileUsage'
import { groupCloudImages } from './resourceGroups'
import {
  resources,
  workingImages,
  legacyResourceUses,
  readWorkingImage,
  readLibraryLegacyImage,
  saveWorkingImageLocally,
  saveLegacyImageLocally,
  uploadLibraryImage,
  removePrivateResource,
  updateFile,
  resourceKey,
  type Resource,
  type WorkingResource,
  type ResourceDocument,
  type LegacyResourceUse,
} from './resources'
import {
  entries,
  localTemplates,
  localAssets,
  workingBackups,
  workingRecords,
  unreadableDocuments,
  currentWorkingOwner,
  listenWorkingChanges,
  retainLibraryImage,
  removeLocalLibraryImage,
  type Entry,
} from './storage'
import { workingDeck } from './workingDocument'
import type { Deck } from './model'

type Pick = (image: Awaited<ReturnType<typeof originalImage>>) => void
type Ref = {
  id: string
  title: string
  kind: 'lesson' | 'template' | 'publication' | 'backup' | 'pending'
  entry?: Entry
}
type Card = {
  key: string
  sha: string | null
  name: string
  mime: string
  size: number | null
  blob?: Blob
  retained?: boolean
  private?: WorkingResource
  public: Resource[]
  refs: Ref[]
  trash: ResourceDocument[]
  known: boolean
}
type Props = {
  mode: 'local' | 'cloud'
  owner: string | null
  pick?: Pick
  lessonEntries?: Entry[]
  openLesson?: (entry: Entry) => void
  legacyRows?: Resource[]
  publicationRefs?: Map<string, { id: string; title: string }[]>
  query?: string
  folder?: string
  folders?: string[]
  onReload?: () => Promise<void>
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String((error as { message?: string })?.message ?? error)
const nameOf = (sha: string, mime: string) =>
  'Изображение-' +
  sha.slice(0, 12) +
  '.' +
  (mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1])
const label = (r: Ref) =>
  ({
    lesson: 'Методичка',
    template: 'Шаблон',
    publication: 'Публикация',
    backup: 'Резервная копия',
    pending: 'Ожидает синхронизации',
  })[r.kind]
const uniqueRefs = (refs: Ref[]) => [
  ...new Map(refs.map((r) => [r.kind + ':' + r.id, r])).values(),
]
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
async function localCatalog(owner: string | null) {
  const [assets, lessons, templates, backups, pending] = await Promise.all([
    localAssets(owner),
    entries(),
    localTemplates(),
    owner ? workingBackups(owner) : Promise.resolve([]),
    owner ? workingRecords(owner) : Promise.resolve([]),
  ])
  const cards = new Map<string, Card>()
  let incomplete =
    !!unreadableDocuments('lesson').length ||
    !!unreadableDocuments('template').length
  for (const asset of assets)
    cards.set(asset.sha, {
      key: asset.sha,
      sha: asset.sha,
      name: asset.name ?? nameOf(asset.sha, asset.blob.type),
      mime: asset.blob.type,
      size: asset.blob.size,
      blob: asset.blob,
      retained: true,
      public: [],
      refs: [],
      trash: [],
      known: true,
    })
  const hashes = new Map<string, { sha: string; blob: Blob }>()
  async function scan(deck: Deck, ref: Ref, display = true) {
    for (const src of new Set(imageSources(deck))) {
      if (!src.startsWith('data:')) {
        incomplete = true
        continue
      }
      let value = hashes.get(src)
      if (!value) {
        const response = await fetch(src)
        if (!response.ok)
          throw Error('Не удалось прочитать изображение документа.')
        const blob = await response.blob()
        value = { blob, sha: await digest(blob) }
        hashes.set(src, value)
      }
      if (!cards.has(value.sha) && display)
        cards.set(value.sha, {
          key: value.sha,
          sha: value.sha,
          name: nameOf(value.sha, value.blob.type),
          mime: value.blob.type,
          size: value.blob.size,
          blob: value.blob,
          retained: false,
          public: [],
          refs: [],
          trash: [],
          known: true,
        })
      cards.get(value.sha)?.refs.push(ref)
    }
  }
  for (const entry of lessons)
    await scan(entry.deck, {
      id: entry.deck.id,
      title: entry.deck.title,
      kind: 'lesson',
      entry,
    })
  for (const { template } of templates)
    await scan(template.deck, {
      id: template.deck.id,
      title: template.deck.title,
      kind: 'template',
    })
  for (const { document } of backups) {
    const deck = workingDeck(document)
    await scan(deck, { id: deck.id, title: deck.title, kind: 'backup' }, false)
  }
  for (const row of pending) {
    if (row.previous)
      await scan(
        workingDeck(row.previous),
        { id: row.id, title: row.title ?? row.id, kind: 'pending' },
        false
      )
    for (const sha of row.attempt?.refs ?? [])
      cards
        .get(sha)
        ?.refs.push({ id: row.id, title: row.title ?? row.id, kind: 'pending' })
  }
  for (const card of cards.values()) {
    card.refs = uniqueRefs(card.refs)
    card.known = !incomplete
  }
  return {
    cards: [...cards.values()],
    warning: incomplete
      ? 'Есть старые внешние ссылки или непрочитанные документы. Удаление заблокировано до проверки.'
      : '',
  }
}
async function cloudCatalog(
  owner: string,
  legacy: Resource[],
  publications: Props['publicationRefs'],
  publicationKnown: boolean
) {
  const [working, oldRefs] = await Promise.all([
    workingImages(owner),
    legacyResourceUses(owner),
  ])
  const links = new Map<string, LegacyResourceUse[]>()
  for (const ref of oldRefs)
    for (const url of ref.urls) {
      const key = storageReference(url)
      if (!key) continue
      const list = links.get(key) ?? []
      list.push(ref)
      links.set(key, list)
    }
  const cards = groupCloudImages(legacy, working).map((group): Card => {
    const pub = group.public[0],
      priv = group.private
    const refs: Ref[] = []
    const trash = [...(priv?.trash ?? [])]
    for (const doc of priv?.documents ?? [])
      refs.push({ id: doc.id, title: doc.title, kind: doc.kind })
    for (const row of [...group.public, ...(priv ? [priv] : [])]) {
      const key = resourceKey(row)
      for (const ref of links.get(key) ?? []) {
        if (ref.deleted) trash.push(ref)
        else refs.push({ id: ref.id, title: ref.title, kind: ref.kind })
      }
      for (const ref of publications?.get(key) ?? [])
        refs.push({ ...ref, kind: 'publication' })
    }
    const mime = priv?.mime ?? pub.mime
    return {
      key: group.key,
      sha: group.sha,
      name: pub?.name ?? nameOf(priv!.sha, mime),
      mime,
      size: priv?.size ?? pub?.size ?? null,
      private: priv,
      public: group.public,
      refs: uniqueRefs(refs),
      trash: [...new Map(trash.map((r) => [r.kind + ':' + r.id, r])).values()],
      known: publicationKnown,
    }
  })
  return {
    cards,
    warning: publicationKnown
      ? ''
      : 'Использование в публикациях не проверено. Удаление заблокировано.',
  }
}
async function cardBlob(card: Card, owner: string | null) {
  if (owner !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
  if (card.blob) {
    if (card.sha && (await digest(card.blob)) !== card.sha)
      throw Error('Локальный файл повреждён.')
    return card.blob
  }
  if (card.private && owner) return readWorkingImage(owner, card.private)
  if (card.public[0]) return readLibraryLegacyImage(card.public[0])
  throw Error('Изображение недоступно.')
}
// Private thumbnails are fetched via authenticated download, never getPublicUrl.
// Load on visibility and revoke every object URL on unmount/change.
function Thumb({
  card,
  owner,
  onPreview,
}: {
  card: Card
  owner: string | null
  onPreview: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let live = true,
      url = ''
    setSrc('')
    setFailed(false)
    if (visible)
      void cardBlob(card, owner)
        .then((blob) => {
          if (!live) return
          url = URL.createObjectURL(blob)
          setSrc(url)
        })
        .catch(() => {
          if (live) setFailed(true)
        })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [card, owner, visible])
  return (
    <div className="file-thumb" ref={host}>
      <button
        className="file-thumb-preview"
        onClick={onPreview}
        aria-label={'Просмотреть ' + card.name}
      >
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span>{failed ? 'Нет предпросмотра' : 'Изображение'}</span>
        )}
      </button>
    </div>
  )
}
async function importedBlob(file: File) {
  let blob: Blob = file
  if (/\.svg$/i.test(file.name))
    blob = await (await fetch((await optimize(file)).src)).blob()
  else if (!blob.type) {
    const type = /\.png$/i.test(file.name)
      ? 'image/png'
      : /\.jpe?g$/i.test(file.name)
        ? 'image/jpeg'
        : 'image/webp'
    blob = new Blob([file], { type })
  }
  await originalImage(blob)
  return blob
}
export function ResourceGallery({
  mode,
  owner,
  pick,
  lessonEntries,
  openLesson,
  legacyRows,
  publicationRefs,
  query: outerQuery,
  folder,
  folders,
  onReload,
}: Props) {
  const [cards, setCards] = useState<Card[]>()
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [epoch, bump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ url: string; name: string }>()
  const upload = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const running = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview]
  )
  useEffect(() => {
    if (!owner || mode !== 'local') return
    return listenWorkingChanges(owner, () => bump((x) => x + 1))
  }, [owner, mode])
  useEffect(() => {
    let live = true
    setCards(undefined)
    setWarning('')
    const load = async () => {
      if (mode === 'local') return localCatalog(owner)
      if (!owner) throw Error('Необходимо войти в аккаунт.')
      // In the picker, public usage is irrelevant; the picker has no deletion actions.
      const legacy = legacyRows ?? (await resources())
      return cloudCatalog(owner, legacy, publicationRefs, !!publicationRefs)
    }
    void load()
      .then((r) => {
        if (live) {
          setCards(r.cards)
          setWarning(r.warning)
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e))
      })
    return () => {
      live = false
    }
  }, [mode, owner, epoch, lessonEntries, legacyRows, publicationRefs])
  async function act(fn: () => Promise<void>, refresh = false) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      if (owner !== currentWorkingOwner()) throw Error('Изменился аккаунт.')
      await fn()
    } catch (e) {
      if (alive.current) setError(errorText(e))
    } finally {
      if (refresh && alive.current) {
        try {
          if (onReload) await onReload()
          bump((x) => x + 1)
        } catch (e) {
          if (alive.current) setError(errorText(e))
        }
      }
      running.current = false
      if (alive.current) setBusy(false)
    }
  }
  const q = (outerQuery ?? query).trim().toLowerCase()
  const shown = cards?.filter(
    (c) =>
      (!folder || c.public.some((p) => p.folder === folder)) &&
      (filter === 'all' ||
        (filter === 'used' && c.refs.length > 0) ||
        (filter === 'unused' && c.known && !c.refs.length && !c.trash.length) ||
        (filter === 'trash' && c.trash.length > 0)) &&
      [
        c.name,
        c.sha ?? '',
        c.mime,
        ...c.public.map((p) => p.name),
        ...c.refs.map((r) => r.title),
        ...c.trash.map((r) => r.title),
      ].some((v) => v.toLowerCase().includes(q))
  )
  return (
    <section
      aria-label={
        mode === 'local' ? 'Локальные изображения' : 'Облачные изображения'
      }
      aria-busy={busy}
    >
      <div className="files-bar">
        {outerQuery === undefined && (
          <label className="files-search">
            <input
              type="search"
              placeholder="Поиск изображений"
              aria-label="Поиск изображений"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {!pick && (
          <select
            aria-label="Использование изображения"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Все изображения</option>
            <option value="used">Используются</option>
            <option value="unused">Не используются</option>
            <option value="trash">В корзине</option>
          </select>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act(async () => {}, true)}
        >
          Обновить изображения
        </button>
        {!pick && (
          <>
            <input
              hidden
              ref={upload}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void act(async () => {
                  const errors: string[] = []
                  for (const file of files)
                    try {
                      const blob = await importedBlob(file)
                      const name = /\.svg$/i.test(file.name)
                        ? file.name.replace(/\.svg$/i, '.webp')
                        : file.name
                      if (mode === 'cloud' && owner)
                        await uploadLibraryImage(owner, blob, name)
                      else
                        await retainLibraryImage(
                          owner,
                          await digest(blob),
                          blob,
                          name
                        )
                    } catch (e) {
                      errors.push(file.name + ': ' + errorText(e))
                    }
                  if (errors.length) throw Error(errors.join(' · '))
                }, true)
              }}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => upload.current?.click()}
            >
              {mode === 'cloud'
                ? 'Загрузить приватное изображение'
                : 'Добавить изображение'}
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="files-error" role="alert">
          {error}
        </p>
      )}
      {warning && !pick && <p className="files-note">{warning}</p>}
      {!cards && !error && <p role="status">Читаем каталог изображений…</p>}
      {cards && !shown?.length && (
        <p className="files-note">
          {cards.length ? 'Нет изображений по фильтру' : 'Нет изображений'}
        </p>
      )}
      <div className="file-grid">
        {shown?.map((card) => (
          <article className="file-card" key={card.key}>
            <Thumb
              card={card}
              owner={owner}
              onPreview={() =>
                void act(async () => {
                  const blob = await cardBlob(card, owner)
                  if (alive.current)
                    setPreview({
                      url: URL.createObjectURL(blob),
                      name: card.name,
                    })
                })
              }
            />
            <div className="file-body">
              <h2>{card.name}</h2>
              <p className="file-meta">
                {card.mime.split('/')[1].toUpperCase()} ·{' '}
                {card.size === null
                  ? 'Размер неизвестен'
                  : Math.max(1, Math.round(card.size / 1024)) + ' КиБ'}
              </p>
              {pick ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const image = await originalImage(
                        await cardBlob(card, owner)
                      )
                      if (alive.current && owner === currentWorkingOwner())
                        pick(image)
                    })
                  }
                >
                  Выбрать
                </button>
              ) : (
                <>
                  <p className="file-meta">
                    {mode === 'local'
                      ? card.retained
                        ? 'На устройстве'
                        : 'В старом JSON'
                      : [
                          card.private ? 'Приватный' : '',
                          card.public.length
                            ? 'Публичных копий: ' + card.public.length
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </p>
                  <p className="file-usage">
                    {card.refs.length
                      ? 'Используется: ' + card.refs.length
                      : card.known
                        ? card.trash.length
                          ? 'Связано с корзиной'
                          : 'Не используется активно'
                        : 'Использование не проверено'}
                  </p>
                  {!!card.refs.length && (
                    <details className="file-links">
                      <summary>Связанные документы</summary>
                      {card.refs.map((r) => (
                        <div key={r.kind + ':' + r.id}>
                          {r.entry && openLesson ? (
                            <button
                              className="file-link"
                              onClick={() => openLesson(r.entry!)}
                            >
                              {r.title}
                            </button>
                          ) : r.kind === 'publication' ? (
                            <a className="file-link" href={'#p/' + r.id}>
                              {r.title}
                            </a>
                          ) : (
                            <span>
                              {label(r)}: {r.title}
                            </span>
                          )}
                        </div>
                      ))}
                    </details>
                  )}
                  {!!card.trash.length && (
                    <details className="file-links">
                      <summary>Корзина ({card.trash.length})</summary>
                      {card.trash.map((r) => (
                        <div key={r.kind + ':' + r.id}>{r.title}</div>
                      ))}
                    </details>
                  )}
                  <details className="file-actions">
                    <summary>
                      Действия <span aria-hidden="true">⋯</span>
                    </summary>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            download(await cardBlob(card, owner), card.name)
                          )
                        }
                      >
                        Скачать файл
                      </button>
                      {mode === 'local' && owner && navigator.onLine && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await uploadLibraryImage(
                                owner,
                                await cardBlob(card, owner),
                                card.name
                              )
                            }, true)
                          }
                        >
                          Добавить изображение в облако
                        </button>
                      )}
                      {mode === 'local' && !card.retained && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const blob = await cardBlob(card, owner)
                              await retainLibraryImage(
                                owner,
                                await digest(blob),
                                blob,
                                card.name
                              )
                            }, true)
                          }
                        >
                          Сохранить в библиотеку
                        </button>
                      )}
                      {mode === 'cloud' && owner && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              if (card.private)
                                await saveWorkingImageLocally(
                                  owner,
                                  card.private
                                )
                              else
                                await saveLegacyImageLocally(
                                  owner,
                                  card.public[0]
                                )
                            }, true)
                          }
                        >
                          Сохранить на устройстве
                        </button>
                      )}
                      {mode === 'local' &&
                        card.retained &&
                        card.sha &&
                        card.known &&
                        !card.refs.length && (
                          <button
                            className="file-delete"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  'Удалить изображение с этого устройства? Облачная копия не изменится.'
                                )
                              )
                                void act(
                                  () =>
                                    removeLocalLibraryImage(owner, card.sha!),
                                  true
                                )
                            }}
                          >
                            Удалить с устройства
                          </button>
                        )}
                      {mode === 'cloud' &&
                        owner &&
                        card.private &&
                        card.known &&
                        !card.refs.length &&
                        !card.trash.length && (
                          <button
                            className="file-delete"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  'Удалить приватную облачную копию? Локальные и публичные копии сохранятся.'
                                )
                              )
                                void act(
                                  () =>
                                    removePrivateResource(
                                      owner,
                                      card.private!,
                                      () =>
                                        assertPrivatePublicationUnused(
                                          card.private!
                                        )
                                    ),
                                  true
                                )
                            }}
                          >
                            Удалить приватную копию
                          </button>
                        )}
                      {card.public.map((row) => (
                        <details key={resourceKey(row)}>
                          <summary>Публичный файл: {row.name}</summary>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(async () =>
                                download(
                                  await readLibraryLegacyImage(row),
                                  row.name
                                )
                              )
                            }
                          >
                            Скачать эту копию
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              const name = prompt(
                                'Название файла',
                                row.name
                              )?.trim()
                              if (name)
                                void act(() => updateFile(row, { name }), true)
                            }}
                          >
                            Переименовать
                          </button>
                          <label>
                            Папка{' '}
                            <select
                              value={row.folder}
                              onChange={(e) => {
                                const folder = e.target.value
                                void act(
                                  () => updateFile(row, { folder }),
                                  true
                                )
                              }}
                            >
                              <option value="">Без папки</option>
                              {[
                                ...new Set(
                                  [...(folders ?? []), row.folder].filter(
                                    Boolean
                                  )
                                ),
                              ].map((f) => (
                                <option key={f}>{f}</option>
                              ))}
                            </select>
                          </label>
                          <p className="files-note">
                            Удаление публичной копии после миграции старых
                            ссылок.
                          </p>
                        </details>
                      ))}
                    </div>
                  </details>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {preview && (
        <div
          className="overlay"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPreview(undefined)
          }}
        >
          <section
            className="dialog file-preview"
            role="dialog"
            aria-modal="true"
            aria-label={preview.name}
          >
            <h2>{preview.name}</h2>
            <img src={preview.url} alt={preview.name} />
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
    </section>
  )
}
export function ResourcePicker({ pick }: { pick: Pick }) {
  const owner = currentWorkingOwner()
  const [online, setOnline] = useState(navigator.onLine)
  const [tab, setTab] = useState<'local' | 'cloud'>('local')
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  const mode = tab === 'cloud' && owner && online ? 'cloud' : 'local'
  return (
    <>
      <div
        className="files-tabs"
        role="group"
        aria-label="Источник изображения"
      >
        <button aria-pressed={mode === 'local'} onClick={() => setTab('local')}>
          На устройстве
        </button>
        <button
          disabled={!owner || !online}
          aria-pressed={mode === 'cloud'}
          onClick={() => setTab('cloud')}
        >
          В облаке
        </button>
      </div>
      <ResourceGallery
        key={mode + ':' + owner}
        mode={mode}
        owner={owner}
        pick={pick}
      />
    </>
  )
}

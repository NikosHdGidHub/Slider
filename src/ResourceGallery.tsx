import {
  LibraryCard,
  LibraryItems,
  LibraryToolbar,
  LibraryState,
  useLibrarySettings,
  type LibrarySettings,
} from './Library'
import { ActionMenus, type MenuItem } from './ActionMenu'
import { LibraryStatus } from './LibraryStatus'
import { FileDialog } from './FileDialog'
import {
  Eye,
  Download,
  CloudUpload,
  MonitorDown,
  Link2,
  Info,
  Trash2,
  Pencil,
  Folder,
  RefreshCw,
  Monitor,
  Cloud,
  Globe2,
} from 'lucide-react'
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
  settings?: LibrarySettings
  usageFilter?: string
  refreshEpoch?: number
  blocked?: boolean
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
function Thumb({ card, owner }: { card: Card; owner: string | null }) {
  const host = useRef<HTMLSpanElement>(null)
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
  }, [card.key, card.sha, owner, visible])
  return (
    <span className="atlas-resource-thumb" ref={host}>
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span>{failed ? 'Нет предпросмотра' : 'Изображение'}</span>
      )}
    </span>
  )
}
export async function importedBlob(file: File) {
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
  settings: outerSettings,
  usageFilter,
  refreshEpoch = 0,
  blocked = false,
}: Props) {
  const [cards, setCards] = useState<Card[]>()
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const pickerSettings = useLibrarySettings('file-picker')
  const settings = outerSettings ?? pickerSettings
  const filter = usageFilter ?? 'all'
  const [checking, setChecking] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [detail, setDetail] = useState<{
    key: string
    kind: 'links' | 'properties' | 'copies'
  }>()
  const [epoch, bump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ url: string; name: string }>()
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
    setChecking(true)
    setLoadFailed(false)
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
        if (live) {
          setLoadFailed(true)
          setError(errorText(e))
        }
      })
      .finally(() => {
        if (live) setChecking(false)
      })
    return () => {
      live = false
    }
  }, [
    mode,
    owner,
    epoch,
    refreshEpoch,
    lessonEntries,
    legacyRows,
    publicationRefs,
  ])
  async function act(fn: () => Promise<void>, refresh = false) {
    if (running.current || blocked) return
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
  const q = (outerQuery ?? settings.query).trim().toLowerCase()
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
  const ordered = [...(shown ?? [])].sort(
    (a, b) =>
      (settings.sort === 'reverse' ? -1 : 1) *
      a.name.localeCompare(b.name, 'ru', { numeric: true })
  )
  const locked = blocked || busy || checking || loadFailed
  const show = (card: Card) =>
    void act(async () => {
      const blob = await cardBlob(card, owner)
      if (alive.current && owner === currentWorkingOwner())
        setPreview({ url: URL.createObjectURL(blob), name: card.name })
    })
  const choose = (card: Card) =>
    void act(async () => {
      const image = await originalImage(await cardBlob(card, owner))
      if (alive.current && owner === currentWorkingOwner()) pick?.(image)
    })
  const links = (card: Card) => setDetail({ key: card.key, kind: 'links' })
  const selected = cards?.find((c) => c.key === detail?.key)
  function actions(card: Card): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Просмотр', icon: Eye, run: () => show(card) },
      {
        label: 'Скачать',
        icon: Download,
        run: () =>
          act(async () => download(await cardBlob(card, owner), card.name)),
      },
      { label: 'Связанные документы', icon: Link2, run: () => links(card) },
      {
        label: 'Свойства файла',
        icon: Info,
        run: () => setDetail({ key: card.key, kind: 'properties' }),
      },
    ]
    if (mode === 'local' && owner && navigator.onLine)
      items.push({
        label: 'Добавить в облако',
        icon: CloudUpload,
        run: () =>
          act(async () => {
            await uploadLibraryImage(
              owner,
              await cardBlob(card, owner),
              card.name
            )
          }, true),
      })
    if (mode === 'local' && !card.retained)
      items.push({
        label: 'Сохранить в библиотеку',
        icon: MonitorDown,
        run: () =>
          act(async () => {
            const blob = await cardBlob(card, owner)
            await retainLibraryImage(owner, await digest(blob), blob, card.name)
          }, true),
      })
    if (mode === 'cloud' && owner)
      items.push({
        label: 'Сохранить на устройстве',
        icon: MonitorDown,
        run: () =>
          act(async () => {
            if (card.private) await saveWorkingImageLocally(owner, card.private)
            else await saveLegacyImageLocally(owner, card.public[0])
          }, true),
      })
    if (card.public.length)
      items.push({
        label: 'Публичные копии',
        icon: Folder,
        run: () => setDetail({ key: card.key, kind: 'copies' }),
      })
    if (
      mode === 'local' &&
      card.retained &&
      card.sha &&
      card.known &&
      !card.refs.length
    )
      items.push('separator', {
        label: 'Удалить с устройства',
        icon: Trash2,
        danger: true,
        disabled: locked,
        run: () => {
          if (
            confirm(
              'Удалить изображение с этого устройства? Облачная копия не изменится.'
            )
          )
            return act(() => removeLocalLibraryImage(owner, card.sha!), true)
        },
      })
    if (
      mode === 'cloud' &&
      owner &&
      card.private &&
      card.known &&
      !card.refs.length &&
      !card.trash.length
    )
      items.push('separator', {
        label: 'Удалить приватную копию',
        icon: Trash2,
        danger: true,
        disabled: locked,
        run: () => {
          if (
            confirm(
              'Удалить приватную облачную копию? Локальные и публичные копии сохранятся.'
            )
          )
            return act(
              () =>
                removePrivateResource(owner, card.private!, () =>
                  assertPrivatePublicationUnused(card.private!)
                ),
              true
            )
        },
      })
    return items
  }
  return (
    <ActionMenus>
      <section
        className="atlas-resource-gallery"
        aria-label={
          mode === 'local' ? 'Локальные изображения' : 'Облачные изображения'
        }
        aria-busy={checking || busy}
      >
        {pick && (
          <LibraryToolbar
            settings={settings}
            label="Поиск изображений"
            actions={
              <>
                <button
                  className="lib-button lib-icon"
                  aria-label="Обновить изображения"
                  disabled={busy}
                  onClick={() => bump((x) => x + 1)}
                >
                  <RefreshCw size={17} />
                </button>
              </>
            }
          />
        )}
        {!pick && error && (
          <LibraryStatus level="error" title="Не удалось обновить изображения">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => {
                setError('')
                bump((x) => x + 1)
              }}
            >
              Повторить
            </button>
            <button className="secondary" onClick={() => setError('')}>
              Закрыть сообщение
            </button>
          </LibraryStatus>
        )}
        {!pick && warning && (
          <LibraryStatus
            level="warning"
            title="Проверка использования изображений"
          >
            <p>{warning}</p>
          </LibraryStatus>
        )}
        {!pick && (checking || busy) && (
          <LibraryStatus level="busy" title="Обновляем изображения…" />
        )}
        {pick && error && (
          <p className="atlas-picker-alert" role="alert">
            {error}
          </p>
        )}
        {!cards ? (
          <LibraryState
            title={
              error
                ? 'Каталог изображений недоступен'
                : 'Загружаем изображения…'
            }
            error={!!error}
          />
        ) : !ordered.length ? (
          <LibraryState
            title={
              cards.length ? 'Нет изображений по фильтру' : 'Нет изображений'
            }
          />
        ) : (
          <LibraryItems
            settings={settings}
            columns={['Формат и размер', 'Использование']}
          >
            {ordered.map((card) => (
              <LibraryCard
                key={card.key}
                name={card.name}
                card={
                  {
                    className: 'atlas-resource-card',
                    'data-resource-key': card.key,
                  } as React.HTMLAttributes<HTMLElement>
                }
                thumbnail={<Thumb card={card} owner={owner} />}
                open={() => show(card)}
                blockOpen={busy || blocked}
                first={
                  card.mime.split('/')[1].toUpperCase() +
                  ' · ' +
                  (card.size === null
                    ? '—'
                    : Math.max(1, Math.round(card.size / 1024)) + ' КиБ')
                }
                second={
                  pick ? undefined : (
                    <span className="atlas-resource-meta">
                      {mode === 'local' ? (
                        <Monitor
                          size={13}
                          aria-label={
                            card.retained ? 'На устройстве' : 'В старом JSON'
                          }
                        />
                      ) : (
                        <>
                          {card.private && (
                            <Cloud size={13} aria-label="Приватное облако" />
                          )}
                          {!!card.public.length && (
                            <Globe2 size={13} aria-label="Публичная копия" />
                          )}
                        </>
                      )}
                      <button
                        className="atlas-resource-links"
                        onClick={() => links(card)}
                        title="Связанные документы"
                      >
                        {card.refs.length
                          ? 'Связей: ' + card.refs.length
                          : card.known
                            ? card.trash.length
                              ? 'В корзине'
                              : 'Нет связей'
                            : 'Не проверено'}
                      </button>
                    </span>
                  )
                }
                actions={pick ? [] : actions(card)}
                disabled={locked}
                notice={setError}
                controls={
                  pick ? (
                    <button
                      className="lib-button lib-secondary"
                      disabled={busy}
                      onClick={() => choose(card)}
                    >
                      Выбрать
                    </button>
                  ) : undefined
                }
              />
            ))}
          </LibraryItems>
        )}
        {preview && (
          <FileDialog title={preview.name} close={() => setPreview(undefined)}>
            <img
              className="atlas-file-preview-image"
              src={preview.url}
              alt={preview.name}
            />
          </FileDialog>
        )}
        {selected && detail && (
          <FileDialog
            title={
              detail.kind === 'links'
                ? 'Связанные документы'
                : detail.kind === 'copies'
                  ? 'Публичные копии'
                  : selected.name
            }
            close={() => setDetail(undefined)}
            locked={busy}
          >
            {detail.kind === 'links' ? (
              <div className="atlas-file-detail-list">
                {!selected.known && (
                  <p>Использование проверено не полностью.</p>
                )}
                {!selected.refs.length && !selected.trash.length && (
                  <p>Связанные документы не найдены.</p>
                )}
                {selected.refs.map((r) => (
                  <div key={r.kind + ':' + r.id}>
                    {r.entry && openLesson ? (
                      <button
                        className="lib-button lib-text"
                        onClick={() => {
                          setDetail(undefined)
                          openLesson(r.entry!)
                        }}
                      >
                        {r.title}
                      </button>
                    ) : r.kind === 'publication' ? (
                      <a
                        className="file-link"
                        href={'#p/' + r.id}
                        onClick={() => setDetail(undefined)}
                      >
                        {r.title}
                      </a>
                    ) : (
                      <span>
                        {label(r)}: {r.title}
                      </span>
                    )}
                  </div>
                ))}
                {selected.trash.map((r) => (
                  <p key={'trash:' + r.kind + ':' + r.id}>Корзина: {r.title}</p>
                ))}
              </div>
            ) : detail.kind === 'properties' ? (
              <dl className="atlas-file-properties">
                <dt>Название</dt>
                <dd>{selected.name}</dd>
                <dt>Формат</dt>
                <dd>{selected.mime}</dd>
                <dt>Размер</dt>
                <dd>{selected.size ?? 'Неизвестно'} байт</dd>
                <dt>Расположение</dt>
                <dd>
                  {mode === 'local'
                    ? selected.retained
                      ? 'На устройстве'
                      : 'В старом JSON'
                    : selected.private
                      ? 'Приватное облако'
                      : 'Публичный ресурс'}
                </dd>
                <dt>Публичных копий</dt>
                <dd>{selected.public.length}</dd>
                <dt>SHA-256</dt>
                <dd>{selected.sha ?? 'Неизвестно'}</dd>
              </dl>
            ) : (
              <div className="atlas-file-detail-list">
                {selected.public.map((row) => (
                  <section key={resourceKey(row)}>
                    <strong>{row.name}</strong>
                    <div className="atlas-file-dialog-actions">
                      <button
                        className="secondary"
                        disabled={locked}
                        onClick={() =>
                          void act(async () =>
                            download(
                              await readLibraryLegacyImage(row),
                              row.name
                            )
                          )
                        }
                      >
                        <Download size={15} /> Скачать
                      </button>
                      <button
                        className="secondary"
                        disabled={locked}
                        onClick={() => {
                          const name = prompt(
                            'Название файла',
                            row.name
                          )?.trim()
                          if (name)
                            void act(() => updateFile(row, { name }), true)
                        }}
                      >
                        <Pencil size={15} /> Переименовать
                      </button>
                    </div>
                    <label>
                      Папка
                      <select
                        disabled={locked}
                        value={row.folder}
                        onChange={(e) => {
                          const folder = e.target.value
                          void act(() => updateFile(row, { folder }), true)
                        }}
                      >
                        <option value="">Без папки</option>
                        {[
                          ...new Set(
                            [...(folders ?? []), row.folder].filter(Boolean)
                          ),
                        ].map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                    <p>Публичные копии не удаляются этим интерфейсом.</p>
                  </section>
                ))}
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </FileDialog>
        )}
      </section>
    </ActionMenus>
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

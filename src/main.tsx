import { rememberImage } from './storage'
import { useHistory } from './StudioTools'
import { GridDesigner } from './GridDesigner'
import { templateFrom } from './catalog'
import { templateInstructions } from './instructions'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BookOpen,
  Library,
  Globe2,
  BookOpenText,
  Plus,
  Upload,
  Play,
  ArrowUpRight,
  Monitor,
  UserRound,
  Layers3,
  FolderOpen,
  FileJson,
  Pencil,
  Trash2,
  Link2,
  LogOut,
  CloudOff,
  Menu,
  X,
  ChevronRight,
  Compass,
  QrCode,
} from 'lucide-react'
import { newDeck, validateDeck, type Deck, MAX_DOCUMENT_BYTES } from './model'
import { embedImages } from './media'
import {
  adminId,
  client,
  listPublished,
  readPublishedForInventory,
  readPublic,
  unpublish,
} from './cloud'
import { entries, saveEntry, type Entry } from './storage'
import { FileLibrary } from './Files'
import { publish, fingerprint } from './publication'
import { collectStyles } from './styleLibrary'
import { TemplateLibrary } from './TemplateLibrary'
import { ImportPreview } from './ImportPreview'
import { builtins, validateTemplate, type Template } from './catalog'
import { getCatalog, saveLocal, type CatalogRow } from './templateStore'
import { instructions, download } from './instructions'
import { Editor } from './Editor'
import { Viewer } from './Viewer'
import { ReceiveLesson, SendLesson } from './TransferScreen'
import { parsePair, receiveHash } from './transfer'
import { Stage } from './Stage'
import { example } from './example'
import relief from './assets/relief.webp'
import { registerShell, ensureShell } from './offline'
import guide from '../docs/USER_GUIDE.md?raw'
import './style.css'

registerShell()
const localMode =
  !client && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
const ownerKey = 'atlas-owner-' + adminId
const link = (id: string) => location.href.split('#')[0] + '#p/' + id
const errorText = (err: unknown) =>
  err instanceof Error ? err.message : 'Не удалось выполнить действие.'
function App() {
  const [owner, setOwner] = useState(false),
    [list, setList] = useState<Entry[]>([]),
    [page, setPage] = useState('library'),
    [drawer, setDrawer] = useState(false)
  const [doc, setDoc] = useState<Deck | null>(null),
    [watch, setWatch] = useState<Deck | null>(null),
    [status, setStatus] = useState('Сохранено')
  const current = useRef<Deck | null>(null),
    rev = useRef(0),
    queue = useRef(Promise.resolve()),
    failure = useRef<unknown>(null)

  // Во время перетаскивания изменяем документ только в памяти.
  // Сохраняем итоговое состояние после отпускания мыши.
  const dragPointer = useRef<number | null>(null)
  const pendingSave = useRef<Deck | null>(null)
  const [modal, setModal] = useState(''),
    [message, notice] = useState(''),
    [busy, setBusy] = useState(''),
    [value, setValue] = useState(''),
    [pw, password] = useState('')
  const [publishedTitles, setPublishedTitles] = useState<
    Record<string, string>
  >({})
  const [pubs, setPubs] = useState<string[]>([]),
    [publicError, pubError] = useState(''),
    [hash, setHash] = useState(location.hash),
    [publicDeck, setPublicDeck] = useState<Deck | null>(null)
  const [online, setOnline] = useState(navigator.onLine),
    [libraryError, libError] = useState(''),
    importer = useRef<HTMLInputElement>(null)
  const allowed = localMode || owner
  const [signedInOwner, setSignedInOwner] = useState<boolean | null>(
    client ? null : false
  )
  const [transferLogin, setTransferLogin] = useState(0)
  const [catalog, setCatalog] = useState<CatalogRow[]>(
    builtins.map((template) => ({ template, builtin: true }))
  )
  const [catalogKind, setCatalogKind] =
    useState<Template['kind']>('presentation')
  const [scope, setScope] = useState('')
  const [editingTemplate, setEditingTemplate] = useState<{
    t: Template
    row?: CatalogRow
  } | null>(null)
  const templateHistory = useHistory(
    editingTemplate?.t,
    (t) => {
      if (t)
        setEditingTemplate((v) =>
          v && v.t.deck.id === t.deck.id ? { ...v, t } : v
        )
    },
    editingTemplate?.t.deck.id
  )
  const [editorSession, setEditorSession] = useState(0)
  const lessonHistory = useHistory(
    doc,
    (d) => {
      if (d) change((prev) => (prev.id === d.id ? d : prev))
    },
    doc ? doc.id + '/' + editorSession : undefined
  )
  const [preview, setPreview] = useState<Deck | null>(null)
  const access = useRef(allowed)
  access.current = allowed
  async function refreshCatalog() {
    const result = await getCatalog(allowed, owner)
    if (access.current === allowed) {
      setCatalog(result.rows)
      setScope(result.scope)
    }
    return result
  }
  const visibleRows = allowed
    ? catalog
    : builtins.map((template) => ({ template, builtin: true }))
  useEffect(() => {
    void refreshCatalog().catch((e) => notice(errorText(e)))
    if (!allowed) setEditingTemplate(null)
  }, [allowed, online])
  const styleLibrary = useMemo(
    () =>
      collectStyles([
        ...visibleRows.map((r) => r.template.deck),
        ...(allowed ? list.map((e) => e.deck) : []),
      ]),
    [catalog, allowed, list]
  )
  async function getInstructions() {
    await task('Формируем инструкцию…', async () => {
      const result = await refreshCatalog()
      if (allowed !== access.current) return
      const templates = await Promise.all(
        result.rows.map(async ({ template }) => {
          if (
            !navigator.onLine ||
            !template.deck.slides.some(
              (s) =>
                s.background?.startsWith('https:') ||
                s.items.some((o) => o.src.startsWith('https:'))
            )
          )
            return template
          try {
            return { ...template, deck: await embedImages(template.deck) }
          } catch {
            return template
          }
        })
      )
      if (allowed !== access.current) return
      const styleCatalog = collectStyles([
        ...templates.map((t) => t.deck),
        ...(allowed ? (await entries()).map((e) => e.deck) : []),
      ])
      download(
        page === 'templates'
          ? 'atlas-template-instructions.txt'
          : 'atlas-presentation-instructions.txt',
        page === 'templates'
          ? templateInstructions(templates, result.scope, styleCatalog)
          : instructions(templates, result.scope, styleCatalog),
        'text/plain'
      )
      notice(result.scope + '. Инструкция скачана.')
    })
  }
  async function refresh() {
    setList(await entries())
    libError('')
  }
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      notice(errorText(e))
    } finally {
      setBusy('')
    }
  }
  function dialog(name: string) {
    setPreview(null)
    setValue('')
    password('')
    setModal(name)
  }
  function closeTransfer() {
    location.hash = ''
    navigate('published')
  }
  function navigate(next: string) {
    setPage(next)
    setDrawer(false)
  }
  useEffect(() => {
    const network = () => setOnline(navigator.onLine),
      route = () => setHash(location.hash)
    window.addEventListener('online', network)
    window.addEventListener('offline', network)
    window.addEventListener('hashchange', route)
    return () => {
      window.removeEventListener('online', network)
      window.removeEventListener('offline', network)
      window.removeEventListener('hashchange', route)
    }
  }, [])
  useEffect(() => {
    if (!client) return
    if (!online && localStorage.getItem(ownerKey) === 'yes') setOwner(true)
    const { data } = client.auth.onAuthStateChange((evt, s) => {
      const ok = s?.user.id.toLowerCase() === adminId
      setSignedInOwner(ok)
      if (ok) localStorage.setItem(ownerKey, 'yes')
      if (evt === 'SIGNED_OUT' && navigator.onLine)
        localStorage.removeItem(ownerKey)
      setOwner(
        ok || (!navigator.onLine && localStorage.getItem(ownerKey) === 'yes')
      )
    })
    return () => data.subscription.unsubscribe()
  }, [online])
  useEffect(() => {
    if (allowed) refresh().catch((e) => libError(errorText(e)))
    else {
      setList([])
      setDoc(null)
      current.current = null
    }
  }, [allowed])
  useEffect(() => {
    if (page !== 'files' || !allowed) return
    void refresh().catch((e) => libError(errorText(e)))
  }, [page, allowed])
  useEffect(() => {
    let live = true
    pubError('')
    setPublicDeck(null)
    if (hash.startsWith('#p/'))
      readPublic(hash.slice(3))
        .then(validateDeck)
        .then((d) => {
          if (live) setPublicDeck(d)
        })
        .catch((e) => {
          if (live) pubError(errorText(e))
        })
    return () => {
      live = false
    }
  }, [hash])
  useEffect(() => {
    if (page !== 'published' || !owner) return
    let live = true
    async function load() {
      const ids = await listPublished()
      if (!live) return
      setPubs(ids)
      for (const id of ids) {
        try {
          const deck = validateDeck(await readPublic(id))
          if (!live) return
          setPublishedTitles((titles) => ({ ...titles, [id]: deck.title }))
        } catch {
          if (!live) return
        }
      }
    }
    load().catch((e) => {
      if (live) notice(errorText(e))
    })
    return () => {
      live = false
    }
  }, [page, owner])
  const [baseline, setBaseline] = useState(''),
    [signature, setSignature] = useState<{ doc: Deck; hash: string } | null>(
      null
    )
  const openedPublication = useRef('')
  const afterExit = useRef<null | (() => Promise<void>)>(null)
  const marker = (id: string) => ownerKey + '-published-' + id
  useEffect(() => {
    if (!doc || status !== 'Сохранено') return
    let live = true
    const timer = window.setTimeout(
      () =>
        fingerprint(doc)
          .then((hash) => {
            if (live) setSignature({ doc, hash })
          })
          .catch((e) => {
            if (live) notice(errorText(e))
          }),
      180
    )
    return () => {
      clearTimeout(timer)
      live = false
    }
  }, [doc, status])
  useEffect(() => {
    if (!doc || status === 'Сохранено') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [doc, status])
  const same =
    !!baseline && signature?.doc === doc && signature.hash === baseline
  const canPublish =
    owner &&
    online &&
    !busy &&
    status === 'Сохранено' &&
    signature?.doc === doc &&
    !same
  async function publishedHash(id: string) {
    if (!(await listPublished()).includes(id)) return ''
    const remote = validateDeck(await readPublishedForInventory(id))
    if (remote.id !== id) throw Error('Идентификатор публикации не совпадает.')
    return fingerprint(remote)
  }
  const documentId = doc?.id
  useEffect(() => {
    if (!documentId || !online || !owner) return
    let live = true
    const observed = openedPublication.current
    publishedHash(documentId)
      .then((hash) => {
        if (live && observed === openedPublication.current) setBaseline(hash)
      })
      .catch((e) => {
        if (live) notice(errorText(e))
      })
    return () => {
      live = false
    }
  }, [documentId, online, owner])
  function open(d: Deck, revision: number) {
    setEditorSession((value) => value + 1)
    openedPublication.current = localStorage.getItem(marker(d.id)) || ''
    setBaseline(openedPublication.current)
    current.current = d
    rev.current = revision
    queue.current = Promise.resolve()
    failure.current = null
    setStatus('Сохранено')
    setDoc(d)
  }

  function persist(next: Deck) {
    setStatus('Сохранение…')

    const expected = rev.current++

    queue.current = queue.current.then(async () => {
      if (failure.current) return

      try {
        await saveEntry(next, expected)

        if (current.current === next) {
          setStatus('Сохранено')
        }
      } catch (e) {
        failure.current = e
        setStatus('Ошибка записи')
        notice(errorText(e))
      }
    })
  }

  function flushPendingSave() {
    const next = pendingSave.current
    pendingSave.current = null

    if (next) {
      persist(next)
    }
  }

  function change(fn: (d: Deck) => Deck) {
    const prev = current.current
    if (!prev) return

    const next = fn(prev)
    if (next === prev) return

    // Сразу обновляем состояние документа и изображение на экране.
    current.current = next
    setDoc(next)

    if (dragPointer.current !== null) {
      // Пока кнопка мыши удерживается, запись в IndexedDB
      // не выполняется. Храним только последнее состояние.
      pendingSave.current = next
      setStatus('Есть несохранённые изменения')
      return
    }

    // Обычные изменения сохраняются по прежней схеме.
    persist(next)
  }

  useEffect(() => {
    function startDrag(e: PointerEvent) {
      if (e.target instanceof Element && e.target.closest('.atlas-stage')) {
        dragPointer.current = e.pointerId
      }
    }

    function finishDrag(e: PointerEvent) {
      if (dragPointer.current !== e.pointerId) return

      dragPointer.current = null
      flushPendingSave()
    }

    function finishOnBlur() {
      dragPointer.current = null
      flushPendingSave()
    }

    // Capture позволяет завершить операцию, даже если
    // pointerup обработан вложенным элементом редактора.
    window.addEventListener('pointerdown', startDrag, true)
    window.addEventListener('pointerup', finishDrag, true)
    window.addEventListener('pointercancel', finishDrag, true)
    window.addEventListener('blur', finishOnBlur)

    return () => {
      window.removeEventListener('pointerdown', startDrag, true)
      window.removeEventListener('pointerup', finishDrag, true)
      window.removeEventListener('pointercancel', finishDrag, true)
      window.removeEventListener('blur', finishOnBlur)
    }
  }, [])

  const newerPublication =
    !!baseline && baseline !== openedPublication.current && !same
  async function syncPublication() {
    const draft = current.current
    if (!draft || !owner || !online)
      throw Error('Для синхронизации нужен вход и подключение к сети.')
    flushPendingSave()
    await queue.current
    if (failure.current) throw failure.current
    const remote = validateDeck(await readPublic(draft.id))
    if (remote.id !== draft.id)
      throw Error('Идентификатор публикации не совпадает.')
    const hash = await fingerprint(remote)
    if (current.current !== draft)
      throw Error('Черновик изменился. Повторите синхронизацию.')
    const revision = rev.current
    await saveEntry(remote, revision, false, true)
    localStorage.setItem(marker(remote.id), hash)
    open(remote, revision + 1)
    setModal('')
    await refresh()
    notice(
      'Открыта актуальная публикация. Предыдущий черновик сохранён в библиотеке с пометкой «до синхронизации».'
    )
  }
  function requestExit(next?: () => Promise<void>) {
    afterExit.current = next ?? null
    if (same) void task('Сохранение…', closeEditor)
    else setModal('leave')
  }
  async function closeEditor() {
    dragPointer.current = null
    flushPendingSave()
    await queue.current
    if (failure.current)
      throw Error(
        'Не удалось сохранить черновик. Экспортируйте JSON перед выходом.'
      )
    if (afterExit.current) {
      await afterExit.current()
      afterExit.current = null
      setModal('')
      return
    }
    current.current = null
    setDoc(null)
    setModal('')
    navigate('library')
    await refresh()
  }
  async function insert(d: Deck) {
    await saveEntry(d, 0)
    await refresh()
    open(d, 1)
    setModal('')
  }
  function need(name: string) {
    dialog(allowed ? name : 'login')
  }
  async function importData(raw: string) {
    const d = validateDeck(raw)
    const used = new Set<string | undefined>(
      d.theme.styles.map((s) => s.values.font)
    )
    for (const s of d.slides)
      for (const o of s.items) {
        used.add(o.overrides?.font)
        o.paragraphs?.forEach((p) => p.runs.forEach((r) => used.add(r.font)))
      }
    for (const g of [
      ...Object.values(d.master.schemes),
      ...d.slides.flatMap((s) => (s.structure ? [s.structure] : [])),
    ])
      for (const c of g.cells) used.add(c.style?.font)
    for (const f of styleLibrary.fonts)
      if (used.has(f.id) && !d.resources.fonts.some((a) => a.id === f.id))
        d.resources.fonts.push(structuredClone(f))
    if (new Blob([JSON.stringify(d)]).size > MAX_DOCUMENT_BYTES)
      throw new Error('Со встроенными шрифтами файл превышает 64 МиБ.')
    validateDeck(d)
    setValue(raw)
    setPreview(d)
    setModal('preview')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    await task('Подождите…', async () => {
      if (modal === 'login') {
        if (!client)
          throw new Error(
            'Настройте Supabase по инструкции SUPABASE_SETUP.md. Для локальной работы запустите проект на localhost.'
          )
        const { data, error } = await client.auth.signInWithPassword({
          email: value.trim(),
          password: pw,
        })
        if (error)
          throw new Error(
            'Не удалось войти. Проверьте почту, пароль и подключение.'
          )
        if (data.user?.id !== adminId) {
          await client.auth.signOut({ scope: 'local' })
          throw new Error('Для этого аккаунта доступ к редактору закрыт.')
        }
        if (hash.startsWith('#transfer/')) setTransferLogin((n) => n + 1)
        setModal('')
      } else if (modal === 'create') await insert(newDeck(value))
      else if (modal === 'import') await importData(value)
    })
  }
  async function act(id: 'export' | 'publish' | 'offline', exitAfter = false) {
    const d = current.current
    if (!d) return
    await task(
      id === 'publish'
        ? 'Публикация…'
        : id === 'offline'
          ? 'Проверяем файлы…'
          : 'Подготовка JSON…',
      async () => {
        if (id === 'export') {
          const data = validateDeck(d),
            file = new Blob([JSON.stringify(data)], {
              type: 'application/json',
            })
          if (file.size > MAX_DOCUMENT_BYTES)
            throw new Error(
              'Для импорта файл должен быть меньше 64 МБ. Разделите занятие.'
            )
          const url = URL.createObjectURL(file),
            a = document.createElement('a')
          a.href = url
          a.download = (d.title.replace(/[\\/]/g, '_') || 'Методичка') + '.json'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 5000)
        } else if (id === 'offline') {
          await ensureShell()
          const prepared = await embedImages(d, rememberImage)
          await queue.current
          if (current.current !== d)
            throw new Error('Методичка изменилась. Повторите подготовку.')
          change(() => prepared)
          await queue.current
          if (failure.current) throw failure.current
          notice(
            'Готово к офлайн-показу. Приложение и все изображения сохранены.'
          )
        } else {
          if (!owner)
            throw new Error(
              'Для публикации подключите Supabase и войдите как владелец.'
            )
          if (
            d.resources.fonts.length &&
            !confirm(
              'Шрифты будут встроены в публичную презентацию и доступны зрителям. Лицензия разрешает распространение?'
            )
          )
            return
          flushPendingSave()
          await queue.current
          if (failure.current) throw failure.current
          if (current.current !== d)
            throw Error('Документ изменился. Повторите публикацию.')
          const draftHash = await fingerprint(d)
          const published = await publish(d, async () => {
            const remoteHash = await publishedHash(d.id)
            setBaseline(remoteHash)
            if (
              remoteHash &&
              remoteHash !== openedPublication.current &&
              remoteHash !== draftHash &&
              !confirm(
                'Облачная версия отличается от последней открытой на этом устройстве. Заменить её текущей методичкой?'
              )
            )
              return false
            return current.current === d
          })
          if (!published) return
          const hash = await fingerprint(d)
          localStorage.setItem(marker(d.id), hash)
          openedPublication.current = hash
          setBaseline(hash)
          if (exitAfter && current.current === d) {
            await closeEditor()
            return
          }
          setPubs((p) => Array.from(new Set([...p, d.id])))
          setValue(link(d.id))
          setModal('link')
        }
      }
    )
  }
  async function remove(en: Entry) {
    if (
      !confirm(
        'Удалить локальную методичку «' +
          en.deck.title +
          '»? Публикация останется доступна.'
      )
    )
      return
    await task('Удаление…', async () => {
      await saveEntry(en.deck, en.revision, true)
      await refresh()
    })
  }
  async function logout() {
    await task('Выход…', async () => {
      if (client) {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) throw error
      }
      localStorage.removeItem(ownerKey)
      setOwner(false)
      setPubs([])
      navigate('library')
    })
  }
  const nav = [
    ['library', 'Мои методички', Library],
    ['templates', 'Шаблоны', Layers3],
    ['files', 'Мои файлы', FolderOpen],
    ['published', 'Опубликованные', Globe2],
    ['guide', 'Руководство', BookOpenText],
  ] as const
  const home = (
    <div className="shell">
      <aside className={'sidebar ' + (drawer ? 'opened' : '')}>
        <div className="brand">
          <span className="brand-icon">
            <BookOpen />
          </span>
          Атлас уроков
        </div>
        <div className="side-rule" />
        <small className="nav-label">Рабочее пространство</small>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => navigate(key)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <div className="avatar">
            <UserRound size={20} />
          </div>
          <div>
            <b>
              {localMode
                ? 'Локальный режим'
                : owner
                  ? 'Преподаватель'
                  : 'Гостевой режим'}
            </b>
            <small>
              {localMode
                ? 'На этом устройстве'
                : owner
                  ? 'Владелец'
                  : 'Только просмотр'}
            </small>
          </div>
          {owner ? (
            <button title="Выйти" onClick={logout}>
              <LogOut size={17} />
            </button>
          ) : (
            !localMode && (
              <button title="Войти" onClick={() => dialog('login')}>
                <ArrowUpRight size={17} />
              </button>
            )
          )}
        </div>
      </aside>
      <div className="desk">
        <header className="top">
          <button
            className="hamb"
            aria-label="Навигация"
            onClick={() => setDrawer(!drawer)}
          >
            <Menu />
          </button>
          <span>Рабочее пространство</span>
          <ChevronRight size={14} />
          <b>{nav.find((n) => n[0] === page)?.[1]}</b>
          <div className="device">
            {online ? <Monitor size={15} /> : <CloudOff size={15} />}{' '}
            {online ? 'На этом устройстве' : 'Офлайн'}
          </div>
        </header>
        <main className="library">
          <div className="title-row">
            <h1>
              {page === 'library'
                ? 'Мои методички'
                : page === 'guide'
                  ? 'Руководство'
                  : page === 'templates'
                    ? 'Шаблоны'
                    : page === 'files'
                      ? 'Мои файлы'
                      : 'Опубликованные'}
            </h1>
            {(page === 'library' || page === 'templates') && (
              <button
                className="secondary instructions-button"
                onClick={getInstructions}
              >
                <FileJson size={17} />
                {page === 'templates'
                  ? 'Скачать инструкцию для генерации шаблона'
                  : 'Скачать инструкцию для генерации презентации'}
              </button>
            )}
            {page === 'published' && (
              <button
                className="primary"
                onClick={() => (location.hash = receiveHash)}
              >
                <QrCode size={18} /> Получить методичку с телефона
              </button>
            )}
            {page === 'library' && (
              <button className="primary" onClick={() => need('create')}>
                <Plus size={18} />
                Создать методичку
              </button>
            )}
          </div>
          {page === 'library' ? (
            <>
              <article className="feature">
                <div className="feature-copy">
                  <div className="feature-tag">
                    <Compass size={15} />
                    Пример методички
                  </div>
                  <h2>
                    Как читать
                    <br />
                    <em>рельеф</em>
                  </h2>
                  <div className="feature-meta">
                    <span>География</span>
                    <i />4 слайда
                  </div>
                  <button onClick={() => setWatch(example)}>
                    <Play size={15} fill="currentColor" />
                    Открыть пример
                  </button>
                </div>
                <div
                  className="plate"
                  style={{ backgroundImage: 'url(' + relief + ')' }}
                >
                  <span className="plate-north">
                    N<br />↑
                  </span>
                  <div className="scale-line">
                    0<span>1 км</span>
                  </div>
                </div>
              </article>
              <section className="collection">
                <div className="section-title">
                  <h2>
                    Локальная библиотека <span>{list.length}</span>
                  </h2>
                  <button className="secondary" onClick={() => need('import')}>
                    <Upload size={16} />
                    Импорт JSON
                  </button>
                </div>
                {libraryError ? (
                  <p role="alert">{libraryError}</p>
                ) : list.length ? (
                  <div className="cards">
                    {list.map((en) => (
                      <article className="card" key={en.deck.id}>
                        <button
                          className="card-open"
                          onClick={() => setWatch(en.deck)}
                        >
                          <div className="card-preview">
                            <Stage deck={en.deck} slide={en.deck.slides[0]} />
                          </div>
                          <b>{en.deck.title}</b>
                          <small>
                            {en.deck.slides.length} слайд. ·{' '}
                            {new Date(en.updated).toLocaleDateString('ru-RU')}
                          </small>
                        </button>
                        <div className="card-actions">
                          <button
                            className="icon"
                            type="button"
                            title="Редактировать методичку"
                            aria-label={'Редактировать ' + en.deck.title}
                            onClick={() => open(en.deck, en.revision)}
                          >
                            <Pencil size={16} />
                          </button>

                          <button
                            className="icon"
                            type="button"
                            title="Удалить локальную методичку"
                            aria-label={'Удалить ' + en.deck.title}
                            onClick={() => remove(en)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <span className="folder">
                      <FolderOpen strokeWidth={1.4} />
                    </span>
                    <h3>
                      {allowed
                        ? 'Здесь появятся ваши методички'
                        : 'Библиотека преподавателя'}
                    </h3>
                    <p>
                      {allowed
                        ? 'Создайте первую методичку или импортируйте готовый JSON.'
                        : 'Войдите в аккаунт владельца, чтобы открыть локальные методички.'}
                    </p>
                    {!allowed && (
                      <button
                        className="secondary"
                        onClick={() => dialog('login')}
                      >
                        Войти
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : page === 'templates' ? (
            <>
              <p className="catalog-scope">{scope}</p>
              <TemplateLibrary
                kind={catalogKind}
                setKind={setCatalogKind}
                rows={visibleRows}
                allowed={allowed}
                onlineOwner={owner && online}
                create={insert}
                edit={(t, row) => {
                  setEditingTemplate({ t, row })
                }}
                refresh={async () => {
                  await refreshCatalog()
                }}
                notice={notice}
              />
            </>
          ) : page === 'files' ? (
            <FileLibrary
              entries={allowed ? list : []}
              openLesson={(entry) => open(entry.deck, entry.revision)}
              openJSON={importData}
              online={online}
              owner={owner}
              allowed={allowed}
              login={() => dialog('login')}
            />
          ) : page === 'guide' ? (
            <article className="guide">
              {guide
                .split('\n')
                .filter(Boolean)
                .filter((l) => !l.startsWith('# '))
                .map((line, i) =>
                  line.startsWith('## ') ? (
                    <h2 key={i}>{line.slice(3)}</h2>
                  ) : (
                    <p key={i}>{line}</p>
                  )
                )}
            </article>
          ) : (
            <section>
              {owner ? (
                pubs.length ? (
                  pubs.map((id) => (
                    <div className="pub" key={id}>
                      <Globe2 />
                      <div>
                        <strong>
                          {publishedTitles[id] ||
                            list.find((en) => en.deck.id === id)?.deck.title ||
                            'Опубликованная методичка'}
                        </strong>
                        <a href={link(id)}>{link(id)}</a>
                      </div>
                      <button
                        className="icon"
                        aria-label="Редактировать"
                        onClick={() =>
                          task('Открываем методичку…', async () => {
                            const remote = validateDeck(await readPublic(id))
                            if (remote.id !== id)
                              throw Error(
                                'Идентификатор публикации не совпадает со ссылкой.'
                              )
                            const hash = await fingerprint(remote)
                            const local = (await entries()).find(
                              (e) => e.deck.id === id
                            )
                            if (local) {
                              if (
                                (await fingerprint(local.deck)) !== hash &&
                                !confirm(
                                  'На устройстве есть свой черновик. Открыть его с сохранением локальных изменений?'
                                )
                              )
                                return
                              open(local.deck, local.revision)
                            } else {
                              localStorage.setItem(marker(id), hash)
                              await insert(remote)
                              notice(
                                'Создан черновик из публикации. Нераспределённые элементы исходного черновика доступны только на исходном устройстве.'
                              )
                            }
                          })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Снять методичку с публикации?'))
                            task('Снимаем с публикации…', async () => {
                              await unpublish(id)
                              localStorage.removeItem(marker(id))
                              setPubs(await listPublished())
                            })
                        }}
                      >
                        Снять с публикации
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    <Globe2 />
                    <h3>Публикаций пока нет</h3>
                    <p>В верхней панели редактора нажмите «Опубликовать».</p>
                  </div>
                )
              ) : (
                <div className="empty">
                  <Globe2 />
                  <h3>Публикации владельца</h3>
                  <p>Гости открывают занятия по прямой ссылке.</p>
                  <button className="secondary" onClick={() => dialog('login')}>
                    Вход преподавателя
                  </button>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  )
  return (
    <>
      {hash === receiveHash ? (
        <ReceiveLesson
          close={closeTransfer}
          online={online}
          enabled={!!client}
        />
      ) : hash === '#transfer' || hash.startsWith('#transfer/') ? (
        <SendLesson
          key={hash + ':' + transferLogin}
          pair={parsePair(hash)}
          close={closeTransfer}
          login={() => dialog('login')}
          authorized={signedInOwner}
          online={online}
          enabled={!!client}
        />
      ) : hash.startsWith('#p/') ? (
        publicDeck ? (
          <Viewer
            initialMode="slides"
            deck={publicDeck}
            onClose={() => (location.hash = '')}
          />
        ) : (
          <main className="empty">
            <BookOpen />
            <p>{publicError || 'Открываем методичку…'}</p>
            <button onClick={() => (location.hash = '')}>В библиотеку</button>
          </main>
        )
      ) : watch ? (
        <Viewer deck={watch} onClose={() => setWatch(null)} />
      ) : editingTemplate?.t.format === 3 && allowed ? (
        <GridDesigner
          libraryAvailable={owner && online}
          template={editingTemplate.t}
          set={templateHistory.set}
          history={templateHistory}
          notice={notice}
          back={() => {
            if (
              confirm(
                'Закрыть конструктор? Изменения после последнего сохранения будут потеряны.'
              )
            )
              setEditingTemplate(null)
          }}
          save={() =>
            task('Сохраняем шаблон…', async () => {
              const t = validateTemplate(editingTemplate.t)
              t.deck.master.name = t.deck.title
              await saveLocal(t, editingTemplate.row)
              await refreshCatalog()
              setEditingTemplate(null)
              setCatalogKind(t.kind)
              navigate('templates')
              notice('Шаблон сохранён.')
            })
          }
        />
      ) : editingTemplate && allowed ? (
        <Editor
          libraryAvailable={owner && online}
          key={editingTemplate.t.deck.id}
          history={templateHistory}
          gridTemplateKind={
            editingTemplate.t.format === 3 ? editingTemplate.t.kind : undefined
          }
          deck={editingTemplate.t.deck}
          status="Редактор шаблона"
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          description={editingTemplate.t.description}
          describe={(description) =>
            templateHistory.update((t) => t && { ...t, description })
          }
          change={(fn) =>
            templateHistory.update((t) => t && { ...t, deck: fn(t.deck) })
          }
          back={() => {
            if (confirm('Закрыть редактор без сохранения шаблона?'))
              setEditingTemplate(null)
          }}
          saveTemplate={() =>
            task('Сохраняем шаблон…', async () => {
              const t = validateTemplate(editingTemplate.t)
              await saveLocal(t, editingTemplate.row)
              await refreshCatalog()
              setEditingTemplate(null)
              setCatalogKind(t.kind)
              navigate('templates')
              notice('Шаблон сохранён.')
            })
          }
          view={() => setWatch(editingTemplate.t.deck)}
          action={() => {}}
          notice={notice}
        />
      ) : doc && allowed ? (
        <Editor
          key={doc.id + '/' + editorSession}
          history={lessonHistory}
          saveAs={() =>
            requestExit(async () => {
              await queue.current
              if (failure.current) throw failure.current
              const t = templateFrom(current.current!)
              await saveLocal(t)
              const result = await refreshCatalog()
              const row = result.rows.find(
                (r) => r.template.deck.id === t.deck.id
              )
              if (!row) throw Error('Не удалось открыть сохранённый шаблон')
              setDoc(null)
              current.current = null
              setCatalogKind('presentation')
              navigate('templates')
              setEditingTemplate({ t, row })
            })
          }
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          deck={doc}
          change={(fn) => lessonHistory.update((d) => d && fn(d))}
          status={status}
          libraryAvailable={owner && online}
          publishLabel={
            same
              ? 'Опубликовано'
              : newerPublication
                ? 'Синхронизовать'
                : baseline
                  ? 'Обновить публикацию'
                  : 'Опубликовать'
          }
          canPublish={canPublish}
          back={() => requestExit()}
          view={() => setWatch(doc)}
          action={(id) =>
            id === 'publish' && newerPublication ? setModal('sync') : act(id)
          }
          notice={notice}
        />
      ) : (
        home
      )}
      {modal && (
        <div className="overlay">
          <section
            className={
              'dialog ' + (modal === 'preview' ? 'import-preview' : '')
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="dismiss icon"
              aria-label="Закрыть"
              onClick={() => setModal('')}
            >
              <X size={19} />
            </button>
            <div className="dialog-icon">
              {modal === 'import' ? (
                <FileJson />
              ) : modal === 'link' ? (
                <Link2 />
              ) : modal === 'login' ? (
                <UserRound />
              ) : (
                <Layers3 />
              )}
            </div>
            <h2 id="dialog-title">
              {
                {
                  sync: 'Публикация изменилась',
                  leave: 'Выход из редактора',
                  preview: 'Предпросмотр импорта',
                  create: 'Новая методичка',
                  import: 'Импорт JSON',
                  login: 'Вход преподавателя',
                  link: 'Методичка опубликована',
                }[modal]
              }
            </h2>
            {modal === 'sync' ? (
              <>
                <p>
                  Можно открыть актуальную облачную версию. Текущий черновик
                  останется в библиотеке отдельной копией.
                </p>
                <button onClick={() => task('Синхронизация…', syncPublication)}>
                  Загрузить опубликованную версию
                </button>
                <button onClick={() => act('publish')}>
                  Опубликовать текущий черновик
                </button>
                <button onClick={() => setModal('')}>
                  Продолжить редактирование
                </button>
              </>
            ) : modal === 'leave' ? (
              <>
                <p>
                  {baseline
                    ? 'Есть неопубликованные изменения.'
                    : 'Методичка ещё не опубликована.'}
                </p>
                <button
                  disabled={!canPublish}
                  onClick={() => act('publish', true)}
                >
                  Опубликовать и выйти
                </button>
                <button onClick={() => task('Сохранение…', closeEditor)}>
                  Оставить локально и выйти
                </button>
                <button onClick={() => setModal('')}>
                  Продолжить редактирование
                </button>
              </>
            ) : modal === 'preview' && preview ? (
              <ImportPreview
                deck={preview}
                back={() => setModal('import')}
                accept={() =>
                  task('Импорт…', async () => {
                    await insert({ ...preview, id: crypto.randomUUID() })
                    setPreview(null)
                  })
                }
              />
            ) : modal === 'link' ? (
              <>
                <p>По ссылке доступны слайды и заметки преподавателя.</p>
                <input
                  readOnly
                  value={value}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="primary"
                  onClick={() =>
                    task('Копирование…', async () => {
                      await navigator.clipboard.writeText(value)
                      notice('Ссылка скопирована.')
                    })
                  }
                >
                  Скопировать ссылку
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                {modal === 'import' ? (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => importer.current?.click()}
                    >
                      <Upload />
                      Выбрать файл JSON
                    </button>
                    <label>
                      Или вставьте JSON
                      <textarea
                        required
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    {modal === 'login' ? 'Электронная почта' : 'Название'}
                    <input
                      autoFocus
                      required
                      type={modal === 'login' ? 'email' : 'text'}
                      maxLength={200}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={
                        modal === 'login'
                          ? 'teacher@example.org'
                          : 'Например, Тестовый урок'
                      }
                    />
                  </label>
                )}
                {modal === 'login' && (
                  <label>
                    Пароль
                    <input
                      required
                      type="password"
                      autoComplete="current-password"
                      value={pw}
                      onChange={(e) => password(e.target.value)}
                    />
                  </label>
                )}
                <button className="primary" type="submit">
                  {modal === 'create'
                    ? 'Создать'
                    : modal === 'import'
                      ? 'Импортировать'
                      : 'Войти'}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
      <input
        type="file"
        hidden
        ref={importer}
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f)
            task('Импорт…', async () => {
              if (f.size > MAX_DOCUMENT_BYTES)
                throw new Error('Файл превышает 64 МБ.')
              const raw = await f.text()
              setValue(raw)
              await importData(raw)
            })
        }}
      />
      {busy && (
        <div className="working" role="status">
          {busy}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button aria-label="Закрыть уведомление" onClick={() => notice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)

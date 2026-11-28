import { ConfirmDialogHost, openConfirm, askConfirm } from './ConfirmDialog'
import { sameDocument, useSaveOperation } from './documentSave'
import type { SaveControl } from './EditorHeader'
import { LibraryStatusDetails, useLibraryStatus } from './LibraryStatus'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { FORMAT_VERSION } from './schema'
import {
  desktopEditingMessage,
  isPhone,
  useLibraryScroll,
} from './libraryNavigation'
import { useHistory } from './StudioTools'
import { GridDesigner } from './GridDesigner'
import { copyDeck, templateFrom } from './catalog'
import { useCourses } from './courseSync'
import { useCoursePreferences } from './coursePreferences'
import { workingCardDeck } from './workingDocument'
import { useWorkingSync } from './useWorkingSync'
import {
  fetchWorking,
  openWorking,
  openWorkingTransient,
  workingKey,
  workingMetadata,
  removeWorkingCloud,
  requestCloudCreation,
} from './workingSync'
import { PublishedLibrary, publicationTitle } from './PublishedLibrary'
import { indexPublications, publicationDocument } from './publicationCatalog'
import { WorkingSyncPanel, syncSummary } from './WorkingSyncPanel'
import { useCoursePublications } from './coursePublications'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BookOpen,
  Library,
  Globe2,
  BookOpenText,
  Upload,
  Play,
  UserRound,
  Layers3,
  FolderOpen,
  FileJson,
  Link2,
  LogOut,
  Menu,
  X,
  ChevronRight,
  LogIn,
  RefreshCw,
} from 'lucide-react'
import {
  newDeck,
  readJSON,
  validateDeck,
  type Deck,
  MAX_DOCUMENT_BYTES,
} from './model'
import { embedImages } from './media'
import {
  adminId,
  client,
  listPublished,
  readPublishedForInventory,
  readPublic,
  unpublish,
} from './cloud'
import {
  entries,
  saveEntry,
  rememberImage,
  saveOriginal,
  setWorkingOwner,
  type Entry,
  writeTemplate,
  workingRecords,
} from './storage'
import { FileLibrary } from './Files'
import { publish, fingerprint } from './publication'
import { collectStyles } from './styleLibrary'
import { TemplateLibrary } from './TemplateLibrary'
import { LessonLibrary, type LessonRow } from './LessonLibrary'
import { ActionMenus } from './ActionMenu'
import { useLibrarySettings } from './Library'
import { useStoredPreference } from './workspacePreferences'
import { ImportPreview } from './ImportPreview'
import { builtins, validateTemplate, type Template } from './catalog'
import {
  deleteTemplate,
  getCatalog,
  loadCatalogRow,
  saveLocal,
  saveTemplateLocally,
  type CatalogRow,
} from './templateStore'
import { download } from './instructions'
import { Editor } from './Editor'
import { Viewer } from './Viewer'
import { QrImage, ReceiveLesson, SendLesson } from './TransferScreen'
import { parsePair, receiveHash } from './transfer'
import { Stage } from './Stage'
import { example } from './example'
import { registerShell, ensureShell } from './offline'
import guide from '../docs/USER_GUIDE.md?raw'
import {
  saveOfflinePresentation,
  readOfflinePresentation,
} from './offlinePresentations'
import './style.css'
import { AvailabilityProps } from './AvailabilityControl'

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
  const current = useRef<Deck | null>(null)
  const savedDeck = useRef<Deck | null>(null)
  const rev = useRef(0)
  const saveOperation = useSaveOperation()
  const [modal, setModal] = useState(''),
    [message, notice] = useState(''),
    [busy, setBusy] = useState(''),
    [value, setValue] = useState(''),
    [pw, password] = useState('')
  const modalContainer = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!modal) return
    const source =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    modalContainer.current?.querySelector<HTMLElement>('.dismiss')?.focus()
    return () => {
      if (source?.isConnected) source.focus()
    }
  }, [modal])
  const [publicError, pubError] = useState(''),
    [hash, setHash] = useState(location.hash),
    [publicDeck, setPublicDeck] = useState<Deck | null>(null)
  const [online, setOnline] = useState(navigator.onLine),
    [libraryError, libError] = useState(''),
    [listReady, setListReady] = useState(false),
    importer = useRef<HTMLInputElement>(null)
  const allowed = localMode || owner
  const workingOwner = owner ? adminId : null

  const workingOwnerRef = useRef(workingOwner)
  workingOwnerRef.current = workingOwner
  const editorOwnerRef = useRef<string | null>(null)
  setWorkingOwner(workingOwner)
  const phone = isPhone()
  const editorOrigin = useRef('library')
  const libraryContent = useRef<HTMLElement>(null)
  const [signedInOwner, setSignedInOwner] = useState<boolean | null>(
    client ? null : false
  )
  const [transferLogin, setTransferLogin] = useState(0)
  const [catalog, setCatalog] = useState<CatalogRow[]>(
    builtins.map((template) => ({ template, builtin: true }))
  )
  const [catalogKind, setCatalogKind] = useStoredPreference<Template['kind']>(
    'atlas.library.v1.template-tab',
    'presentation',
    (stored) =>
      stored === 'presentation' || stored === 'layout' ? stored : undefined
  )
  const lessonsSettings = useLibrarySettings('lessons')
  const courseScope = owner ? adminId : localMode ? 'local' : null
  const courses = useCourses(courseScope, online)
  const courseLocation = useCoursePreferences(courseScope, lessonsSettings)
  const activeCourse = courses.snapshot.courses.find(
    (c) => c.id === courseLocation.id
  )
  const creationCourse = useRef<string | null>(null)
  const templateCourse = useRef<string | null>(null)
  const [publicationStamp, publicationChanged] = useState(0)
  const inTransfer =
    hash === receiveHash ||
    hash === '#transfer' ||
    hash.startsWith('#transfer/')
  const publications = useCoursePublications(
    !inTransfer &&
      !hash.startsWith('#p/') &&
      (page === 'library' || page === 'published')
      ? page
      : null,
    online,
    workingOwner,
    !!signedInOwner,
    publicationStamp
  )
  const publishedSettings = useLibrarySettings('published')
  const publicLocation = useCoursePreferences(
    'public:' + (workingOwner ?? 'guest'),
    publishedSettings
  )
  useEffect(() => {
    if (courses.ready && courseLocation.id && !activeCourse)
      courseLocation.setLocation(null)
  }, [courses.ready, courseLocation.id, activeCourse])
  const presentationSettings = useLibrarySettings('presentation')
  const layoutSettings = useLibrarySettings('layout')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const catalogRequest = useRef(0)
  const [editingTemplate, setEditingTemplate] = useState<{
    t: Template
    row?: CatalogRow
    baseline: string
  } | null>(null)

  const editingTemplateRef = useRef(editingTemplate)
  editingTemplateRef.current = editingTemplate
  const working = useWorkingSync(
    workingOwner,
    online,
    !!signedInOwner,
    doc ? 'lesson' : editingTemplate ? 'template' : undefined,
    doc?.id ?? editingTemplate?.t.deck.id
  )
  const baseSync = syncSummary(
    working,
    courses,
    online,
    !!signedInOwner,
    localMode
  )
  const pageStatuses = useLibraryStatus()
  const hasPageError = pageStatuses.some((item) => item.level === 'error')
  const hasPageWarning = pageStatuses.some((item) => item.level === 'warning')
  const hasPageBusy = pageStatuses.some((item) => item.level === 'busy')
  const sync =
    baseSync.label === 'Обнаружен конфликт' ||
    baseSync.label === 'Ошибка синхронизации'
      ? baseSync
      : hasPageError
        ? { label: 'Ошибка библиотеки', Icon: AlertCircle }
        : !online
          ? baseSync
          : hasPageWarning
            ? { label: 'Требуется внимание', Icon: AlertTriangle }
            : hasPageBusy || busy
              ? { label: 'Обновление…', Icon: RefreshCw }
              : baseSync
  const libraryRows = useMemo(() => {
    const rows = new Map<string, LessonRow>(
      list.map((entry) => [entry.deck.id.toLowerCase(), entry])
    )
    for (const record of working.records) {
      if (record.kind !== 'lesson') continue
      const row = rows.get(record.id),
        meta = record.meta
      if (row) {
        rows.set(record.id, {
          ...row,
          cloudMeta: meta && !meta.deleted ? meta : undefined,
          syncConflict: !!record.conflict,
        })

        continue
      }
      if (!row && (record.deleted || meta?.deleted)) {
        rows.delete(record.id)
      } else if (!row && meta && !meta.deleted && !record.dirty)
        rows.set(record.id, {
          deck: workingCardDeck(meta.id, meta.title),
          revision: 0,
          updated: Date.parse(meta.updated),
          slideCount: meta.slides,
          working: meta,
          cloudMeta: meta,
        })
    }
    for (const publication of publications.rows) {
      if (rows.has(publication.id)) continue
      rows.set(publication.id, {
        deck: workingCardDeck(publication.id, publicationTitle(publication)),
        revision: 0,
        updated: Date.parse(publication.updated),
        slideCount: publication.slides ?? 0,
        publication,
      })
    }
    return [...rows.values()]
  }, [list, working.records, publications.rows])
  const activeSyncConflict = working.records.some(
    (record) =>
      record.conflict &&
      ((doc &&
        workingKey(record.kind, record.id) === workingKey('lesson', doc.id)) ||
        (editingTemplate &&
          workingKey(record.kind, record.id) ===
            workingKey('template', editingTemplate.t.deck.id)))
  )
  function retrySync() {
    working.retry()
    courses.retry()
    publicationChanged((stamp) => stamp + 1)
  }
  const templateDirty =
    editingTemplate !== null &&
    (!editingTemplate.row ||
      JSON.stringify(editingTemplate.t) !== editingTemplate.baseline)
  const lessonDirty = !!doc && !sameDocument(doc, savedDeck.current)
  const documentDirty = lessonDirty || templateDirty
  const activeKind = doc ? 'lesson' : editingTemplate ? 'template' : undefined

  const activeId = doc?.id ?? editingTemplate?.t.deck.id

  const activeRecord = working.records.find(
    (record) =>
      record.kind === activeKind && record.id === activeId?.toLowerCase()
  )
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

  const homeVisible =
    !(doc && allowed && !phone) &&
    !watch &&
    !(editingTemplate && allowed && !phone) &&
    !hash.startsWith('#p/') &&
    !inTransfer
  useLibraryScroll(
    libraryContent,
    homeVisible,
    page === 'templates'
      ? page + '/' + catalogKind
      : page === 'library'
        ? page + '/' + courseLocation.key
        : page === 'published'
          ? page + '/' + publicLocation.key
          : page
  )

  function allowEditing() {
    if (phone) {
      notice(desktopEditingMessage)
      return false
    }
    return allowed
  }

  const access = useRef(allowed)
  access.current = allowed
  async function refreshCatalog() {
    const request = ++catalogRequest.current
    setCatalogLoading(true)
    setCatalogError('')
    try {
      const result = await getCatalog(allowed)
      if (access.current === allowed && request === catalogRequest.current) {
        setCatalog(result.rows)
      }
      return result
    } catch (error) {
      if (access.current === allowed && request === catalogRequest.current)
        setCatalogError(errorText(error))
      throw error
    } finally {
      if (access.current === allowed && request === catalogRequest.current)
        setCatalogLoading(false)
    }
  }
  async function prepareForOffline(deck: Deck) {
    await ensureShell(deck)

    const prepared = await embedImages(deck, rememberImage)

    await saveOfflinePresentation(prepared)

    notice('Методичка подготовлена к офлайн-показу.')
  }
  const visibleRows = allowed
    ? catalog
    : builtins.map((template) => ({ template, builtin: true }))
  useEffect(() => {
    void refreshCatalog().catch(() => {})
    if (!allowed) setEditingTemplate(null)
  }, [allowed, working.records])
  const inEditor = !!(doc || editingTemplate)
  const styleLibrary = useMemo(
    () =>
      inEditor
        ? collectStyles([
            ...visibleRows
              .filter((row) => !('meta' in row && row.meta))
              .map((row) => row.template.deck),
            ...(allowed ? list.map((entry) => entry.deck) : []),
          ])
        : undefined,
    [catalog, allowed, list, inEditor]
  )

  async function refresh() {
    try {
      const rows = await entries()
      if (access.current) setList(rows)
      libError('')
    } catch (error) {
      libError(errorText(error))
      throw error
    } finally {
      setListReady(true)
    }
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
    notice('')
    setPreview(null)
    setValue('')
    password('')
    setModal(name)
  }
  function closeTransfer() {
    location.hash = ''
    navigate('published')
  }
  function navigate(next: string, destination: string | null = null) {
    templateCourse.current = next === 'templates' ? destination : null
    const protectedPages = ['templates', 'files']

    if (!allowed && protectedPages.includes(next)) {
      setPage('library')
      setDrawer(false)
      return
    }

    setPage(next)
    setDrawer(false)
  }
  useEffect(() => {
    if (!allowed && ['templates', 'files'].includes(page)) {
      setPage('library')
      setDrawer(false)
    }
  }, [allowed, page])
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
      setListReady(false)
      setDoc(null)
      current.current = null
      savedDeck.current = null
    }
  }, [allowed, working.records])
  useEffect(() => {
    if (page !== 'files' || !allowed) return
    void refresh().catch((e) => libError(errorText(e)))
  }, [page, allowed])

  useEffect(() => {
    let live = true

    pubError('')
    setPublicDeck(null)

    if (hash.startsWith('#p/')) {
      const id = hash.slice(3)

      void (async () => {
        try {
          let deck: Deck

          if (!navigator.onLine) {
            // Нет интернета — открываем подготовленную копию.
            const cached = await readOfflinePresentation(id)

            if (!cached) {
              throw new Error(
                'Методичка не подготовлена к офлайн-показу. ' +
                  'Подключитесь к интернету и подготовьте её заранее.'
              )
            }

            deck = cached
          } else {
            // Интернет есть — получаем актуальную публикацию.
            deck = validateDeck(await readPublic(id))
          }

          if (live) {
            setPublicDeck(deck)
          }
        } catch (e) {
          if (live) {
            pubError(errorText(e))
          }
        }
      })()
    }

    return () => {
      live = false
    }
  }, [hash])

  const [baseline, setBaseline] = useState(''),
    [signature, setSignature] = useState<{ doc: Deck; hash: string } | null>(
      null
    )
  const openedPublication = useRef('')
  const [publicationVerified, setPublicationVerified] = useState(false)
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
    if (!documentDirty && !saveOperation.saving) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [documentDirty, saveOperation.saving])
  const same =
    !!baseline && signature?.doc === doc && signature.hash === baseline
  async function publishedHash(id: string) {
    if (!(await listPublished()).includes(id)) return ''
    const remote = validateDeck(await readPublishedForInventory(id))
    if (remote.id !== id) throw Error('Идентификатор публикации не совпадает.')
    return fingerprint(remote)
  }
  const documentId = doc?.id

  useEffect(() => {
    setPublicationVerified(false)

    if (!documentId || !online || !owner) return

    let live = true

    const observed = openedPublication.current

    publishedHash(documentId)
      .then((hash) => {
        if (live && observed === openedPublication.current) {
          setBaseline(hash)
          setPublicationVerified(true)
        }
      })
      .catch((error) => {
        if (live) {
          setPublicationVerified(false)
          notice(errorText(error))
        }
      })

    return () => {
      live = false
    }
  }, [documentId, online, owner])
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
    if (!allowEditing()) return
    editorOwnerRef.current = workingOwnerRef.current
    if (!current.current) editorOrigin.current = page
    setEditorSession((value) => value + 1)
    openedPublication.current = localStorage.getItem(marker(d.id)) || ''
    setBaseline(openedPublication.current)
    setPublicationVerified(false)
    current.current = d
    rev.current = revision
    savedDeck.current = d
    saveOperation.clearError()
    setStatus('Сохранено')
    setDoc(d)
  }

  function change(fn: (d: Deck) => Deck) {
    const prev = current.current
    if (!prev) return
    const next = fn(prev)
    if (next === prev || sameDocument(next, prev)) return
    current.current = next
    setDoc(next)
    setStatus(
      sameDocument(next, savedDeck.current)
        ? 'Сохранено'
        : 'Есть несохранённые изменения'
    )
  }

  async function persistLesson(forceLocal = false) {
    const draft = current.current
    if (!draft) throw Error('Методичка не открыта.')
    if (!forceLocal && sameDocument(draft, savedDeck.current)) return
    const expected = rev.current
    const savingOwner = editorOwnerRef.current
    if (savingOwner !== workingOwnerRef.current)
      throw Error('Изменился сеанс авторизации. Экспортируйте JSON.')
    setStatus('Сохранение…')
    try {
      const validated = validateDeck(draft)
      await saveEntry(
        validated,
        expected,
        false,
        false,
        undefined,
        false,
        savingOwner
      )
      if (
        current.current?.id !== draft.id ||
        savingOwner !== workingOwnerRef.current
      )
        throw Error('Изменился открытый документ или сеанс авторизации.')
      rev.current = expected + 1
      savedDeck.current = draft
      setStatus(
        sameDocument(current.current, draft)
          ? 'Сохранено'
          : 'Есть несохранённые изменения'
      )
      void refresh().catch((e) => notice(errorText(e)))
    } catch (err) {
      setStatus('Ошибка записи')
      throw err
    }
  }

  async function saveActive(forceLocal = false) {
    return saveOperation.run(async () => {
      if (current.current) await persistLesson(forceLocal)
      else if (
        editingTemplateRef.current &&
        (!editingTemplateRef.current.row ||
          JSON.stringify(editingTemplateRef.current.t) !==
            editingTemplateRef.current.baseline ||
          forceLocal)
      )
        await persistActiveTemplate()
      else if (!editingTemplateRef.current) throw Error('Документ не открыт.')
    })
  }
  function saveFromButton() {
    if (!documentDirty || saveOperation.lock.current || busy) return
    void saveActive()
      .then(() => notice('Документ сохранён.'))
      .catch((e) => notice(errorText(e)))
  }
  const saveControl: SaveControl = {
    dirty: documentDirty,
    saving: saveOperation.saving,
    error: documentDirty ? saveOperation.error : undefined,
    disabled: !!busy,
    onSave: saveFromButton,
  }
  async function ensureSaved() {
    if (saveOperation.lock.current)
      throw Error('Дождитесь завершения сохранения.')
    const draft = current.current
    const editor = editingTemplateRef.current
    const template = editor?.t
    const dirty = draft
      ? !sameDocument(draft, savedDeck.current)
      : !!editor &&
        (!editor.row || JSON.stringify(editor.t) !== editor.baseline)
    if (!dirty) return true
    if (
      !(await askConfirm(
        'Перед этим действием необходимо сохранить изменения.',
        {
          title: 'Несохранённые изменения',
          label: 'Сохранить и продолжить',
        }
      ))
    )
      return false
    if (draft && current.current !== draft)
      throw Error('Документ изменился. Повторите действие.')
    await saveActive()
    if (draft && !sameDocument(current.current, savedDeck.current))
      throw Error('Есть новые несохранённые изменения.')
    if (template && editingTemplateRef.current?.t !== template)
      throw Error('Шаблон изменился. Повторите действие.')
    return true
  }

  const newerPublication =
    !!baseline && baseline !== openedPublication.current && !same
  async function syncPublication() {
    const draft = current.current
    if (!draft || !owner || !online)
      throw Error('Для синхронизации нужен вход и подключение к сети.')
    if (!sameDocument(draft, savedDeck.current))
      throw Error('Сначала сохраните изменения.')
    const remote = validateDeck(await readPublic(draft.id))
    if (remote.id !== draft.id)
      throw Error('Идентификатор публикации не совпадает.')
    const hash = await fingerprint(remote)
    if (current.current !== draft)
      throw Error('Черновик изменился. Повторите синхронизацию.')
    const revision = rev.current
    if (editorOwnerRef.current !== workingOwnerRef.current)
      throw Error('Изменился сеанс авторизации.')
    await saveEntry(
      remote,
      revision,
      false,
      true,
      undefined,
      false,
      editorOwnerRef.current
    )
    localStorage.setItem(marker(remote.id), hash)
    open(remote, revision + 1)
    setModal('')
    await refresh()
    notice(
      'Открыта актуальная публикация. Предыдущий черновик сохранён в библиотеке с пометкой «до синхронизации».'
    )
  }
  function closeTemplateEditor() {
    editingTemplateRef.current = null
    setEditingTemplate(null)
    setModal('')
  }

  function requestTemplateExit() {
    if (!editingTemplate || saveOperation.lock.current || busy) return
    if (!templateDirty) {
      closeTemplateEditor()
      return
    }
    void openConfirm({
      title: 'Несохранённые изменения',
      description: 'Сохранить изменения шаблона перед выходом?',
      actions: [
        {
          id: 'save',
          label: 'Сохранить и выйти',
          variant: 'primary',
          onClick: async () => {
            await saveActive()
            if (editingTemplateRef.current?.t !== editingTemplate.t)
              throw Error('Шаблон изменился. Повторите действие.')
            closeTemplateEditor()
          },
        },
        {
          id: 'discard',
          label: 'Выйти без сохранения',
          variant: 'danger',
          onClick: closeTemplateEditor,
        },
        { id: 'cancel', label: 'Продолжить редактирование' },
      ],
    })
  }
  async function persistActiveTemplate() {
    const editor = editingTemplateRef.current
    if (!editor) throw Error('Шаблон не открыт.')
    const savingOwner = editorOwnerRef.current
    if (savingOwner !== workingOwnerRef.current)
      throw Error('Изменился сеанс авторизации. Экспортируйте шаблон.')
    const template = validateTemplate(structuredClone(editor.t))
    if (template.format === FORMAT_VERSION)
      template.deck.master.name = template.deck.title
    await saveLocal(template, editor.row)
    if (
      savingOwner !== workingOwnerRef.current ||
      editingTemplateRef.current?.t.deck.id !== template.deck.id
    )
      throw Error('Изменился открытый шаблон или сеанс авторизации.')
    // The write has committed; update the expected revision even if catalog refresh fails.
    const row: CatalogRow = {
      template,
      entry: {
        template,
        revision: (editor.row?.entry?.revision ?? 0) + 1,
        cloudRevision: editor.row?.entry?.cloudRevision ?? 0,
        dirty: true,
      },
      remote: editor.row?.remote,
    }
    const latest = editingTemplateRef.current
    if (latest?.t.deck.id === template.deck.id)
      editingTemplateRef.current = {
        ...latest,
        row,
        baseline: JSON.stringify(editor.t),
      }
    setEditingTemplate((current) =>
      current?.t.deck.id === template.deck.id
        ? { ...current, row, baseline: JSON.stringify(editor.t) }
        : current
    )
    void refreshCatalog().catch((e) => notice(errorText(e)))
    return row.entry
  }
  function requestExit(next?: () => Promise<void>) {
    const draft = current.current
    if (!draft || saveOperation.lock.current || busy) return
    const dirty = !sameDocument(draft, savedDeck.current)
    if (!dirty) {
      void task('Выход…', () => finishLessonExit(next))
      return
    }
    void openConfirm({
      title: 'Несохранённые изменения',
      description: 'Сохранить изменения методички перед выходом?',
      actions: [
        {
          id: 'save',
          label: 'Сохранить и выйти',
          variant: 'primary',
          onClick: async () => {
            await saveActive()
            if (!sameDocument(current.current, savedDeck.current))
              throw Error('Есть новые несохранённые изменения.')
            await finishLessonExit(next)
          },
        },
        {
          id: 'discard',
          label: 'Выйти без сохранения',
          variant: 'danger',
          onClick: async () => {
            if (next) {
              current.current = savedDeck.current
              setDoc(savedDeck.current)
              setStatus('Сохранено')
            }
            await closeEditor(next)
          },
        },
        { id: 'cancel', label: 'Продолжить редактирование' },
      ],
    })
  }
  async function finishLessonExit(next?: () => Promise<void>) {
    const draft = current.current
    if (!draft || !sameDocument(draft, savedDeck.current))
      throw Error('Есть несохранённые изменения.')
    if (
      baseline &&
      owner &&
      online &&
      publicationVerified &&
      (await fingerprint(draft)) !== baseline
    ) {
      const result = await openConfirm({
        title: 'Обновление публикации',
        description:
          'Сохранённая методичка отличается от опубликованной версии.',
        actions: [
          {
            id: 'publish',
            label: 'Опубликовать и выйти',
            variant: 'primary',
            onClick: () => publishCurrent(false),
          },
          { id: 'local', label: 'Выйти без обновления публикации' },
          { id: 'cancel', label: 'Продолжить редактирование' },
        ],
      })
      if (result !== 'publish' && result !== 'local') return
    }
    if (current.current !== draft)
      throw Error('Методичка изменилась. Повторите выход.')
    await closeEditor(next)
  }
  async function closeEditor(next?: () => Promise<void>) {
    if (next) {
      await next()
      setModal('')
      return
    }
    current.current = null
    savedDeck.current = null
    setDoc(null)
    setModal('')
    navigate(editorOrigin.current)
    void refresh().catch((e) => notice(errorText(e)))
  }
  async function viewPublication(id: string) {
    if (online) return publicationDocument(id)
    const cached = await readOfflinePresentation(id)
    if (cached) return cached
    throw Error(
      'Сохраните эту публикацию для офлайн-показа при подключении к сети.'
    )
  }

  async function lessonBody(entry: LessonRow) {
    if (entry.working && workingOwner) {
      const result = await fetchWorking(workingOwner, 'lesson', entry.deck.id)
      if (!result.document || result.meta.deleted || 'deck' in result.document)
        throw Error('Облачный черновик недоступен.')
      return result.document
    }
    if (entry.publication) return viewPublication(entry.deck.id)
    return entry.deck
  }
  async function savePublicationLocally(id: string): Promise<Entry> {
    if (!allowed) throw Error('Для сохранения методички необходимо войти.')
    id = id.toLowerCase()
    const existing = (await entries()).find(
      (entry) => entry.deck.id.toLowerCase() === id
    )
    if (existing) return existing
    const workingRow = working.records.find(
      (row) => row.kind === 'lesson' && row.id === id
    )
    let meta = workingRow?.meta
    if (workingOwner && online && signedInOwner && !working.checked && !meta) {
      try {
        meta = await workingMetadata(workingOwner, 'lesson', id)
      } catch (error) {
        if (!errorText(error).includes('Примените cloud-sync.sql')) throw error
      }
    }
    if (workingOwner && meta && !meta.deleted) {
      await openWorking(workingOwner, meta)
      const cached = (await entries()).find(
        (entry) => entry.deck.id.toLowerCase() === id
      )
      if (!cached) throw Error('Не удалось сохранить облачный черновик.')
      await refresh()
      return cached
    }

    const remote = validateDeck(await readPublic(id))

    if (remote.id !== id) {
      throw Error('Идентификатор публикации не совпадает со ссылкой.')
    }

    const hash = await fingerprint(remote)

    await saveEntry(remote, 0)

    localStorage.setItem(marker(id), hash)

    await refresh()

    const saved = (await entries()).find((entry) => entry.deck.id === id)

    if (!saved) {
      throw Error('Не удалось получить сохранённую методичку.')
    }

    return saved
  }
  async function insert(d: Deck, destination: string | null = null) {
    if (!allowEditing()) return
    if (destination && !courseScope) throw Error('Войдите как преподаватель.')
    await saveEntry(
      d,
      0,
      false,
      false,
      destination && courseScope
        ? { scope: courseScope, course: destination }
        : undefined
    )
    await refresh()
    open(d, 1)
    if (destination) editorOrigin.current = 'library'
    setModal('')
  }
  function need(name: string) {
    if (phone) {
      allowEditing()
      return
    }
    dialog(allowed ? name : 'login')
  }
  async function importData(raw: string) {
    if (!allowEditing()) return
    const available = collectStyles([
      ...visibleRows
        .filter((row) => !('meta' in row && row.meta))
        .map((row) => row.template.deck),
      ...list.map((entry) => entry.deck),
    ]).fonts
    const d = validateDeck(raw, available)
    setValue(raw)
    setPreview(d)
    setModal('preview')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (phone && modal !== 'login') {
      allowEditing()
      return
    }
    if (!allowed && modal !== 'login') {
      dialog('login')
      return
    }
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
      } else if (modal === 'create')
        await insert(newDeck(value), creationCourse.current)
      else if (modal === 'import') await importData(value)
    })
  }
  function exportDeck(deck: Deck) {
    const json = JSON.stringify(validateDeck(deck))
    if (new Blob([json]).size > MAX_DOCUMENT_BYTES)
      throw new Error(
        'Для импорта файл должен быть меньше 64 МБ. Разделите занятие.'
      )
    download((deck.title.replace(/[\\/]/g, '_') || 'Методичка') + '.json', json)
  }
  async function publishCurrent(showLink = true): Promise<boolean> {
    const d = current.current
    if (!d || !sameDocument(d, savedDeck.current))
      throw Error('Сначала сохраните изменения методички.')
    if (!owner || !online || editorOwnerRef.current !== workingOwnerRef.current)
      throw Error(
        'Для публикации войдите как владелец и подключитесь к интернету.'
      )
    if (
      d.resources.fonts.length &&
      !(await askConfirm(
        'Шрифты будут встроены в публичную презентацию и доступны зрителям. Лицензия разрешает распространение?',
        { title: 'Лицензия шрифтов', label: 'Разрешено' }
      ))
    )
      return false
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
        !(await askConfirm(
          'Облачная версия отличается от последней открытой на этом устройстве. Заменить её текущей методичкой?',
          {
            title: 'Конфликт публикаций',
            label: 'Заменить публикацию',
            variant: 'warning',
          }
        ))
      )
        return false
      return (
        current.current === d &&
        editorOwnerRef.current === workingOwnerRef.current
      )
    })
    if (!published) return false
    localStorage.setItem(marker(d.id), draftHash)
    openedPublication.current = draftHash
    setBaseline(draftHash)
    setPublicationVerified(true)
    publicationChanged((stamp) => stamp + 1)
    if (showLink) {
      setValue(link(d.id))
      setModal('link')
    }
    return true
  }
  async function act(id: 'export' | 'publish' | 'offline') {
    const draft = current.current
    if (!draft) return
    if (id === 'export') {
      await task('Подготовка JSON…', async () => exportDeck(draft))
      return
    }
    if (id === 'publish') {
      await task('Публикация…', async () => {
        if (!(await ensureSaved())) return
        if (newerPublication) {
          await openConfirm({
            title: 'Публикация изменилась',
            description: 'Выберите, какую версию использовать.',
            actions: [
              {
                id: 'remote',
                label: 'Загрузить опубликованную версию',
                description: 'Сохранённый черновик останется отдельной копией.',
                variant: 'warning',
                onClick: syncPublication,
              },
              {
                id: 'local',
                label: 'Опубликовать текущий черновик',
                variant: 'primary',
                onClick: () => publishCurrent(),
              },
              { id: 'cancel', label: 'Продолжить редактирование' },
            ],
          })
        } else await publishCurrent()
      })
      return
    }
    await task('Проверяем файлы…', async () => {
      if (!(await ensureSaved())) return
      const d = current.current
      if (!d) return
      await prepareForOffline(d)
    })
  }
  async function toggleActiveLocal(enabled: boolean) {
    if (doc) {
      const draft = current.current

      if (!draft) throw Error('Методичка не открыта.')
      if (!(await ensureSaved())) return
      if (current.current !== draft)
        throw Error('Методичка изменилась. Повторите действие.')

      if (enabled) {
        if (rev.current === 0) await saveActive(true)

        await refresh()

        notice('Методичка сохранена на устройстве.')
        return
      }

      if (
        !(await askConfirm(
          'Удалить методичку с этого устройства?\n\n' +
            'Редактор будет закрыт. Облачная копия ' +
            'и публикация сохранятся, если они существуют.',
          { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
        ))
      )
        return

      if (editorOwnerRef.current !== workingOwnerRef.current)
        throw Error('Изменился сеанс авторизации.')
      await saveEntry(
        draft,
        rev.current,
        true,
        false,
        undefined,
        false,
        editorOwnerRef.current
      )

      current.current = null
      savedDeck.current = null

      setDoc(null)
      setModal('')

      navigate(editorOrigin.current)

      await refresh()

      notice('Локальная копия удалена.')
      return
    }

    if (editingTemplate) {
      if (!(await ensureSaved())) return
      const editor = editingTemplateRef.current
      if (!editor) throw Error('Шаблон не открыт.')

      if (enabled) {
        if (editor.row?.meta && !editor.row?.entry) {
          await saveTemplateLocally(editor.row)

          const result = await refreshCatalog()

          const row = result.rows.find(
            (item) => item.template.deck.id === editor.t.deck.id
          )

          if (!row?.entry) throw Error('Локальная копия шаблона не найдена.')

          setEditingTemplate((current) =>
            current?.t.deck.id === editor.t.deck.id
              ? { ...current, row }
              : current
          )
        } else if (!editor.row?.entry) {
          await saveActive(true)
        }

        notice('Шаблон сохранён на устройстве.')
        return
      }

      if (!editor.row?.entry) throw Error('Локальная копия отсутствует.')

      if (
        !(await askConfirm(
          'Удалить шаблон с устройства?\n\n' +
            'Редактор будет закрыт. Облачная копия ' +
            'сохранится, если она существует.',
          { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
        ))
      )
        return

      await writeTemplate(editor.row.entry, true)

      closeTemplateEditor()

      await refreshCatalog()

      navigate('templates')

      notice('Локальная копия шаблона удалена.')
    }
  }
  async function toggleActiveCloud(enabled: boolean) {
    if (!workingOwner || !signedInOwner || !online)
      throw Error('Необходимо войти в аккаунт и подключиться к интернету.')

    const kind = activeKind
    const id = activeId

    if (!kind || !id) throw Error('Документ не открыт.')

    if (!enabled) {
      if (
        !(await askConfirm(
          'Удалить рабочую копию из облака?\n\n' +
            'Локальные копии на устройствах ' +
            'и публикация сохранятся.',
          { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
        ))
      )
        return

      if (!(await ensureSaved())) return

      // Если это единственная рабочая копия,
      // после удаления закрываем редактор.
      const records = await workingRecords(workingOwner)

      const record = records.find(
        (item) => item.kind === kind && item.id === id.toLowerCase()
      )

      await removeWorkingCloud(workingOwner, kind, id)

      if (!record?.localId) {
        if (kind === 'lesson') {
          current.current = null
          setDoc(null)
          navigate(editorOrigin.current)
        } else {
          closeTemplateEditor()
          navigate('templates')
        }
      }

      working.retry()

      await refresh()
      await refreshCatalog()

      notice('Рабочая облачная копия удалена.')
      return
    }

    if (!(await ensureSaved())) return

    // Включение облачного хранения.
    // Сначала гарантируем наличие локального JSON.

    if (kind === 'lesson') {
      if (rev.current === 0) await saveActive(true)
    } else if (!editingTemplateRef.current?.row?.entry) {
      await saveActive(true)
    }

    await requestCloudCreation(workingOwner, kind, id)

    working.retry()

    notice('Документ поставлен в очередь загрузки в облако.')
  }
  async function toggleActivePublication(enabled: boolean) {
    const draft = current.current

    if (!draft) throw Error('Методичка не открыта.')

    if (!owner || !signedInOwner || !online)
      throw Error('Для публикации необходимо подключение к облаку.')

    if (!(await ensureSaved())) return

    if (enabled) {
      if (
        !(await askConfirm(
          'Опубликовать текущую методичку?\n\n' +
            'Она будет доступна по публичной ссылке.',
          { title: 'Публикация', label: 'Опубликовать' }
        ))
      )
        return

      await publishCurrent()
      return
    }

    if (
      !(await askConfirm(
        'Снять методичку с публикации?\n\n' +
          'Публичная ссылка перестанет работать. ' +
          'Рабочие копии сохранятся.',
        {
          title: 'Снятие с публикации',
          label: 'Снять с публикации',
          variant: 'warning',
        }
      ))
    )
      return

    // Не удаляем публикацию, которую другой
    // компьютер успел обновить после проверки.
    const latestHash = await publishedHash(draft.id)

    if (latestHash !== baseline)
      throw Error('Публикация изменилась. Повторно откройте методичку.')

    await unpublish(draft.id)

    localStorage.removeItem(marker(draft.id))

    openedPublication.current = ''

    setBaseline('')
    setPublicationVerified(true)

    publicationChanged((stamp) => stamp + 1)

    notice('Методичка снята с публикации.')
  }
  async function resolveActiveConflict() {
    if (
      !(await askConfirm(
        'Для разрешения конфликта необходимо ' +
          'сохранить работу и закрыть редактор. Продолжить?',
        { title: 'Конфликт версий', label: 'Продолжить', variant: 'warning' }
      ))
    )
      return

    if (!(await ensureSaved())) return
    if (doc) {
      if (!sameDocument(current.current, savedDeck.current))
        throw Error('Сначала сохраните изменения.')
      await closeEditor()
    }
    if (editingTemplate) {
      closeTemplateEditor()
      navigate('templates')
    }

    working.retry()

    dialog('working-sync')
  }
  const availability: AvailabilityProps | undefined =
    activeId && activeKind
      ? {
          state: {
            local: doc ? rev.current > 0 : !!editingTemplate?.row?.entry,

            cloud: !client
              ? false
              : activeRecord?.meta
                ? !activeRecord.meta.deleted
                : working.checked && !working.errors.length
                  ? false
                  : null,

            published: doc
              ? publicationVerified && online
                ? !!baseline
                : null
              : undefined,

            publicationOutdated:
              !!doc &&
              publicationVerified &&
              !!baseline &&
              (lessonDirty ||
                (signature?.doc === doc && signature.hash !== baseline)),

            pending: !!activeRecord?.dirty,

            syncing: working.syncing && !!activeRecord?.dirty,

            conflict: !!activeRecord?.conflict,

            offline: !online,

            error: !!activeRecord?.dirty && working.errors.length > 0,

            localSaving: saveOperation.saving,

            localError: documentDirty && !!saveOperation.error,
          },

          disabled: !!busy || saveOperation.saving,

          cloudDisabled: !workingOwner || !signedInOwner,

          onLocal: toggleActiveLocal,

          onCloud: toggleActiveCloud,

          onPublished: doc ? toggleActivePublication : undefined,

          onSync: () => {
            working.retry()
          },

          onConflict: resolveActiveConflict,

          onUpdatePublication: doc ? () => act('publish') : undefined,

          onError: notice,
        }
      : undefined
  function libraryAvailabilityState(
    kind: 'lesson' | 'template',
    id: string,
    local: boolean
  ) {
    const record = working.records.find(
      (item) => item.kind === kind && item.id === id.toLowerCase()
    )

    return {
      local,

      cloud: !client
        ? false
        : working.checked && !working.errors.length && online && signedInOwner
          ? !!record?.meta && !record.meta.deleted
          : null,

      pending: !!record?.dirty,

      syncing: !!record?.dirty && working.syncing,

      conflict: !!record?.conflict,

      offline: !online,

      error: !!record?.dirty && working.errors.length > 0,
    }
  }
  function lessonAvailability(entry: LessonRow): AvailabilityProps {
    const id = entry.deck.id

    return {
      state: {
        ...libraryAvailabilityState('lesson', id, !!entry.revision),

        published: !client
          ? false
          : publications.checked
            ? publications.published.has(id.toLowerCase())
            : null,
      },

      disabled: !!busy,

      cloudDisabled: !workingOwner || !signedInOwner,

      onLocal: async (enabled) => {
        if (enabled) {
          await savePublicationLocally(id)

          notice('Методичка сохранена на устройстве.')
        } else {
          await remove(entry, false)
        }

        working.retry()
      },

      onCloud: async (enabled) => {
        if (!workingOwner || !signedInOwner)
          throw Error('Необходимо войти в аккаунт.')

        if (enabled) {
          if (!entry.revision) await savePublicationLocally(id)

          await requestCloudCreation(workingOwner, 'lesson', id)

          working.retry()

          notice('Методичка поставлена в очередь загрузки.')
        } else {
          await remove(entry, true)
        }
      },

      onPublished: async (enabled) => {
        if (!owner || !signedInOwner || !online)
          throw Error('Для публикации необходим интернет.')

        if (enabled) {
          if (
            !(await askConfirm(
              'Опубликовать методичку «' +
                entry.deck.title +
                '»? Она будет доступна по публичной ссылке.',
              { title: 'Публикация', label: 'Опубликовать' }
            ))
          )
            return

          const deck = await lessonBody(entry)

          if (
            deck.resources.fonts.length &&
            !(await askConfirm(
              'Шрифты будут доступны зрителям. ' +
                'Лицензия разрешает распространение?',
              { title: 'Лицензия шрифтов', label: 'Разрешено' }
            ))
          )
            return

          const published = await publish(
            deck,
            async () => !(await publishedHash(id))
          )

          if (!published)
            throw Error('Публикация уже существует. ' + 'Обновите библиотеку.')

          localStorage.setItem(marker(id), await fingerprint(deck))

          publicationChanged((stamp) => stamp + 1)

          setValue(link(id))
          setModal('link')
        } else {
          if (
            !(await askConfirm(
              'Снять методичку с публикации? ' + 'Рабочие копии сохранятся.',
              {
                title: 'Снятие с публикации',
                label: 'Снять с публикации',
                variant: 'warning',
              }
            ))
          )
            return

          await unpublish(id)

          localStorage.removeItem(marker(id))

          publicationChanged((stamp) => stamp + 1)

          notice('Методичка снята с публикации.')
        }
      },

      onSync: () => {
        working.retry()
      },

      onConflict: () => {
        dialog('working-sync')
      },

      onError: notice,
    }
  }
  function templateAvailability(row: CatalogRow): AvailabilityProps {
    const id = row.template.deck.id

    return {
      state: libraryAvailabilityState('template', id, !!row.entry),

      disabled: !!busy || !!row.builtin,

      cloudDisabled: !workingOwner || !signedInOwner,

      onLocal: async (enabled) => {
        if (enabled) {
          await saveTemplateLocally(row)

          notice('Шаблон сохранён на устройстве.')
        } else {
          if (
            !(await askConfirm(
              'Удалить локальную копию шаблона? ' +
                'Облачная копия сохранится, ' +
                'если она существует.',
              { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
            ))
          )
            return

          await deleteTemplate(row, false)

          notice('Локальная копия шаблона удалена.')
        }

        working.retry()

        await refreshCatalog()
      },

      onCloud: async (enabled) => {
        if (!workingOwner || !signedInOwner)
          throw Error('Необходимо войти в аккаунт.')

        if (enabled) {
          if (!row.entry) await saveTemplateLocally(row)

          await requestCloudCreation(workingOwner, 'template', id)

          working.retry()

          notice('Шаблон поставлен в очередь загрузки.')
        } else {
          if (
            !(await askConfirm(
              'Удалить облачную копию шаблона? ' +
                'Локальные копии сохранятся.',
              { title: 'Удаление копии', label: 'Удалить', variant: 'danger' }
            ))
          )
            return

          await deleteTemplate(row, true)

          working.retry()

          notice('Облачная копия шаблона удалена.')
        }

        await refreshCatalog()
      },

      onSync: () => {
        working.retry()
      },

      onConflict: () => {
        dialog('working-sync')
      },

      onError: notice,
    }
  }
  async function remove(en: LessonRow, cloud = false) {
    const title = en.deck.title

    const message = cloud
      ? 'Удалить облачную копию «' +
        title +
        '»?\n\n' +
        'Локальные копии и публикация сохранятся.'
      : 'Удалить локальную копию «' +
        title +
        '»?\n\n' +
        'Облачная копия и публикация, если они существуют, сохранятся.'

    if (
      !(await askConfirm(message, {
        title: 'Удаление копии',
        label: 'Удалить',
        variant: 'danger',
      }))
    )
      return

    await task('Удаление…', async () => {
      if (cloud) {
        if (!workingOwner) throw Error('Необходимо войти в аккаунт.')

        await removeWorkingCloud(workingOwner, 'lesson', en.deck.id)

        working.retry()

        notice('Облачная копия удалена.')
      } else {
        if (!en.revision) throw Error('Локальная копия отсутствует.')

        await saveEntry(en.deck, en.revision, true, false, undefined, false)

        notice('Локальная копия удалена.')
      }

      await refresh()
    })
  }
  async function logout() {
    await task('Выход…', async () => {
      if (!(await ensureSaved())) return
      if (client) {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) throw error
      }
      localStorage.removeItem(ownerKey)
      setOwner(false)
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
  const visibleNav = nav.filter(
    ([key]) => allowed || !['templates', 'files'].includes(key)
  )
  const home = (
    <div className="shell" hidden={!homeVisible} inert={!!modal}>
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
          {visibleNav.map(([key, label, Icon]) => (
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
              <button
                title="Войти"
                aria-label="Войти"
                onClick={() => dialog('login')}
              >
                <LogIn size={18} />
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
          <button
            className="device"
            onClick={() => dialog('working-sync')}
            aria-label={'Синхронизация: ' + sync.label}
            title={sync.label}
          >
            <sync.Icon size={15} />
            <span>{sync.label}</span>
          </button>
        </header>
        <main
          className="library"
          ref={libraryContent}
          data-library={
            ['library', 'templates', 'published', 'files'].includes(page) ||
            undefined
          }
        >
          {!['library', 'templates', 'published', 'files'].includes(page) && (
            <div className="title-row">
              <h1>
                {page === 'guide'
                  ? 'Руководство'
                  : page === 'files'
                    ? 'Мои файлы'
                    : 'Опубликованные'}
              </h1>
            </div>
          )}
          {phone && page === 'files' && (
            <p className="phone-edit-message">{desktopEditingMessage}</p>
          )}
          {page === 'library' ? (
            <ActionMenus>
              <LessonLibrary
                availabilityFor={lessonAvailability}
                settings={courseLocation.settings}
                rows={allowed ? libraryRows : []}
                courses={courses}
                course={activeCourse}
                openCourse={courseLocation.setLocation}
                published={publications.published}
                publicationsLoading={publications.loading}
                publicationsError={publications.failure}
                allowed={allowed}
                editable={allowed && !phone}
                loading={!listReady}
                error={libraryError}
                create={() => {
                  creationCourse.current = activeCourse?.id ?? null
                  need('create')
                }}
                fromTemplate={() => {
                  setCatalogKind('presentation')
                  navigate('templates', activeCourse?.id ?? null)
                }}
                importJSON={() => {
                  creationCourse.current = activeCourse?.id ?? null
                  need('import')
                }}
                view={(entry) =>
                  void task('Открываем методичку…', async () =>
                    setWatch(await lessonBody(entry))
                  )
                }
                edit={(entry) => {
                  if (entry.revision) {
                    open(entry.deck, entry.revision)
                    return
                  }

                  void task('Открываем методичку…', async () => {
                    if (entry.working && workingOwner) {
                      const document = await openWorkingTransient(
                        workingOwner,
                        'lesson',
                        entry.deck.id
                      )

                      if ('deck' in document)
                        throw Error('Ожидалась методичка, а не шаблон.')

                      open(document, 0)
                      return
                    }

                    const saved = await savePublicationLocally(entry.deck.id)

                    open(saved.deck, saved.revision)
                  })
                }}
                duplicate={(entry, course) =>
                  task('Создаём копию…', async () => {
                    const deck = await lessonBody(entry)
                    await insert(
                      copyDeck(deck, deck.title.slice(0, 990) + ' — копия'),
                      course
                    )
                  })
                }
                saveLocally={(entry) =>
                  task('Сохраняем методичку…', async () => {
                    await savePublicationLocally(entry.deck.id)
                    notice('Методичка сохранена на устройстве.')
                  })
                }
                remove={remove}
                cloud={!!workingOwner}
                exportJSON={(entry) =>
                  task('Подготовка JSON…', async () =>
                    exportDeck(await lessonBody(entry))
                  )
                }
                login={() => dialog('login')}
                example={() => navigate('guide')}
                retry={() => void refresh().catch(() => {})}
                notice={notice}
              />
            </ActionMenus>
          ) : page === 'templates' && allowed ? (
            <ActionMenus>
              <TemplateLibrary
                availabilityFor={templateAvailability}
                kind={catalogKind}
                setKind={setCatalogKind}
                rows={visibleRows}
                settings={
                  catalogKind === 'presentation'
                    ? presentationSettings
                    : layoutSettings
                }
                editable={!phone}
                loading={catalogLoading}
                error={catalogError}
                connection={
                  owner && !online
                    ? 'offline'
                    : owner && working.errors.length
                      ? 'error'
                      : undefined
                }
                create={(deck) => insert(deck, templateCourse.current)}
                edit={(t, row) => {
                  if (allowEditing()) {
                    editorOwnerRef.current = workingOwnerRef.current
                    saveOperation.clearError()
                    setEditingTemplate({
                      t,
                      row,
                      baseline: JSON.stringify(t),
                    })
                  }
                }}
                refresh={async () => {
                  await refreshCatalog()
                }}
                notice={notice}
              />
            </ActionMenus>
          ) : page === 'files' && allowed ? (
            <FileLibrary
              onMaintenance={async () => {
                await refresh()
                await refreshCatalog()
                working.retry()
              }}
              entries={allowed ? list : []}
              openLesson={(entry) =>
                phone ? setWatch(entry.deck) : open(entry.deck, entry.revision)
              }
              openJSON={
                phone
                  ? undefined
                  : (raw) => {
                      creationCourse.current = null
                      return importData(raw)
                    }
              }
              online={online}
              owner={owner}
              allowed={allowed}
              login={() => dialog('login')}
            />
          ) : page === 'guide' ? (
            <>
              <section
                className="lib-guide-example"
                aria-label="Пример методички"
              >
                <div className="lib-thumbnail" aria-hidden="true">
                  <Stage deck={example} slide={example.slides[0]} />
                </div>
                <div>
                  <h2>Пример методички</h2>
                  <p>
                    {example.title} · {example.slides.length} слайда
                  </p>
                  <button
                    className="lib-button lib-text"
                    onClick={() => setWatch(example)}
                  >
                    <Play size={16} /> Открыть пример
                  </button>
                </div>
              </section>
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
            </>
          ) : !allowed && ['templates', 'files'].includes(page) ? (
            <div className="empty">
              <BookOpen />
              <h3>Доступ ограничен</h3>
              <p>Войдите как преподаватель, чтобы открыть этот раздел.</p>
              <button className="primary" onClick={() => dialog('login')}>
                <LogIn size={17} />
                Войти
              </button>
            </div>
          ) : (
            <PublishedLibrary
              rows={publications.rows}
              snapshot={courses.snapshot}
              settings={publicLocation.settings}
              course={publicLocation.id ?? ''}
              openCourse={(id) => publicLocation.setLocation(id || null)}
              owner={owner}
              editable={owner && !phone}
              online={online}
              loading={publications.loading}
              failed={publications.failure}
              notice={notice}
              retry={() => publicationChanged((stamp) => stamp + 1)}
              login={() => dialog('login')}
              receive={() => (location.hash = receiveHash)}
              backfill={() =>
                void task('Индексируем публикации…', async () => {
                  const failed = await indexPublications(
                    adminId,
                    publications.rows,
                    (count) => setBusy('Обработано публикаций: ' + count)
                  )
                  publicationChanged((stamp) => stamp + 1)
                  notice(
                    failed.length
                      ? 'Не удалось индексировать публикаций: ' + failed.length
                      : 'Каталог публикаций обновлён.'
                  )
                })
              }
              action={(action, id) =>
                void task('Публикации…', async () => {
                  if (action === 'view') setWatch(await viewPublication(id))
                  else if (action === 'copy') {
                    await navigator.clipboard.writeText(link(id))
                    notice('Ссылка скопирована.')
                  } else if (action === 'qr') {
                    dialog('publication-qr')
                    setValue(link(id))
                  } else if (action === 'edit') {
                    const saved = await savePublicationLocally(id)
                    open(saved.deck, saved.revision)
                  } else if (action === 'save') {
                    await savePublicationLocally(id)
                    notice('Рабочая копия доступна в «Моих методичках».')
                  } else if (action === 'export') {
                    await exportDeck(await publicationDocument(id))
                  } else if (action === 'offline') {
                    await prepareForOffline(await publicationDocument(id))
                  } else if (
                    await askConfirm('Снять методичку с публикации?', {
                      title: 'Снятие с публикации',
                      label: 'Снять с публикации',
                      variant: 'warning',
                    })
                  ) {
                    await unpublish(id)
                    localStorage.removeItem(marker(id))
                    publicationChanged((stamp) => stamp + 1)
                  }
                })
              }
            />
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
          courses={courses.snapshot}
          online={online}
          enabled={!!client}
        />
      ) : hash.startsWith('#p/') ? (
        publicDeck ? (
          <Viewer
            key={publicDeck.id}
            initialMode="teacher"
            deck={publicDeck}
            onPrepare={prepareForOffline}
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
        <Viewer
          deck={watch}
          onPrepare={async (deck) => {
            if (current.current?.id === deck.id) {
              if (!(await ensureSaved())) throw Error('Подготовка отменена.')
              const saved = current.current
              if (!saved || saved.id !== deck.id)
                throw Error('Документ изменился.')
              await prepareForOffline(saved)
            } else await prepareForOffline(deck)
          }}
          onClose={() => setWatch(null)}
        />
      ) : editingTemplate?.t.format === FORMAT_VERSION && allowed && !phone ? (
        <GridDesigner
          key={editingTemplate.t.deck.id}
          libraryAvailable={allowed}
          template={editingTemplate.t}
          availability={availability}
          set={templateHistory.set}
          history={templateHistory}
          notice={notice}
          back={requestTemplateExit}
          save={saveFromButton}
          saveControl={saveControl}
        />
      ) : editingTemplate && allowed && !phone ? (
        <Editor
          libraryAvailable={allowed}
          key={editingTemplate.t.deck.id}
          history={templateHistory}
          gridTemplateKind={
            editingTemplate.t.format === FORMAT_VERSION
              ? editingTemplate.t.kind
              : undefined
          }
          deck={editingTemplate.t.deck}
          allowBleed={editingTemplate.t.kind === 'presentation'}
          status="Редактор шаблона"
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          resolveTemplate={async (template) => {
            const row = catalog.find(
              (r) => r.template.deck.id === template.deck.id
            )
            return row ? (await loadCatalogRow(row)).template : template
          }}
          description={editingTemplate.t.description}
          describe={(description) =>
            templateHistory.update((t) => t && { ...t, description })
          }
          change={(fn) =>
            templateHistory.update((t) => t && { ...t, deck: fn(t.deck) })
          }
          back={requestTemplateExit}
          availability={availability}
          saveTemplate={saveFromButton}
          saveControl={saveControl}
          view={() => setWatch(editingTemplate.t.deck)}
          exportTemplate={() =>
            download(
              editingTemplate.t.deck.title + '.atlas.json',
              JSON.stringify(editingTemplate.t, null, 2)
            )
          }
          action={() => {}}
          notice={notice}
        />
      ) : doc && allowed && !phone ? (
        <Editor
          key={doc.id + '/' + editorSession}
          history={lessonHistory}
          saveControl={saveControl}
          saveAs={() =>
            requestExit(async () => {
              if (
                !current.current ||
                !sameDocument(current.current, savedDeck.current)
              )
                throw Error('Сначала сохраните методичку.')
              const t = templateFrom(current.current)
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
              editorOwnerRef.current = workingOwnerRef.current
              saveOperation.clearError()
              setEditingTemplate({
                t,
                row,
                baseline: JSON.stringify(t),
              })
            })
          }
          styleLibrary={styleLibrary}
          templates={visibleRows.map((r) => r.template)}
          resolveTemplate={async (template) => {
            const row = catalog.find(
              (r) => r.template.deck.id === template.deck.id
            )
            return row ? (await loadCatalogRow(row)).template : template
          }}
          deck={doc}
          change={(fn) => lessonHistory.update((d) => d && fn(d))}
          status={
            rev.current === 0 && status === 'Сохранено'
              ? 'Открыто из облака'
              : status
          }
          libraryAvailable={allowed}
          availability={availability}
          back={() => requestExit()}
          view={() => setWatch(doc)}
          action={(id) => void act(id)}
          notice={notice}
        />
      ) : null}
      {home}
      <ConfirmDialogHost />
      {modal && (
        <div className="overlay">
          <section
            className={
              'dialog ' +
              (modal === 'preview'
                ? 'import-preview'
                : modal === 'working-sync'
                  ? 'working-dialog'
                  : '')
            }
            ref={modalContainer}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setModal('')
                return
              }
              if (event.key !== 'Tab') return
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
                ),
              ].filter((element) => element.getClientRects().length)
              const first = controls[0],
                last = controls.at(-1)
              if (
                (!event.shiftKey && document.activeElement === last) ||
                (event.shiftKey && document.activeElement === first)
              ) {
                event.preventDefault()
                const target = event.shiftKey ? last : first
                target?.focus()
              }
            }}
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
              ) : modal === 'working-sync' ? (
                <RefreshCw />
              ) : (
                <Layers3 />
              )}
            </div>
            <h2 id="dialog-title">
              {
                {
                  'working-sync': 'Синхронизация',
                  'publication-qr': 'QR-код публикации',
                  preview: 'Предпросмотр импорта',
                  create: 'Новая методичка',
                  import: 'Импорт JSON',
                  login: 'Вход преподавателя',
                  link: 'Методичка опубликована',
                }[modal]
              }
            </h2>

            {modal === 'working-sync' ? (
              <>
                <LibraryStatusDetails />
                <WorkingSyncPanel
                  owner={workingOwner}
                  sync={working}
                  courses={courses}
                  online={online}
                  authorized={!!signedInOwner}
                  local={localMode}
                  inEditor={inEditor}
                  retry={retrySync}
                  notice={notice}
                  view={(deck) => {
                    setModal('')
                    setWatch(deck)
                  }}
                  openCourses={() => {
                    setModal('')
                    navigate('library')
                  }}
                  login={() => dialog('login')}
                />
              </>
            ) : modal === 'publication-qr' ? (
              <QrImage address={value} label="QR-код публикации" />
            ) : modal === 'preview' && preview ? (
              <ImportPreview
                deck={preview}
                back={() => setModal('import')}
                accept={() =>
                  task('Импорт…', async () => {
                    const deck = { ...preview, id: crypto.randomUUID() }
                    await saveOriginal('lesson', deck.id, readJSON(value))
                    await insert(deck, creationCourse.current)
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

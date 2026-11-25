import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  Clipboard,
  Monitor,
  QrCode,
  Smartphone,
} from 'lucide-react'
import { listPublished, readPublic } from './cloud'
import { validateDeck } from './model'
import {
  cancelTransfer,
  inspectTransfer,
  pairLink,
  pollTransfer,
  publicLessonLink,
  sendTransfer,
  startTransfer,
  transferMessage,
  withTransferTimeout,
  type Pair,
  type WaitingTransfer,
} from './transfer'

function Frame({
  title,
  close,
  phone,
  children,
}: {
  title: string
  close: () => void
  phone?: boolean
  children: ReactNode
}) {
  const Icon = phone ? Smartphone : Monitor
  return (
    <main className="transfer-screen" aria-labelledby="transfer-title">
      <section className="transfer-panel">
        <button className="transfer-back" onClick={close}>
          <ArrowLeft size={16} /> К публикациям
        </button>
        <div className="transfer-heading">
          <span className="transfer-icon">
            <Icon aria-hidden="true" size={23} />
          </span>
          <h1 id="transfer-title">{title}</h1>
        </div>
        {children}
      </section>
    </main>
  )
}

function QrImage({ address, label }: { address: string; label: string }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setImage('')
    setError(false)
    import('qrcode')
      .then(({ default: QR }) =>
        QR.toDataURL(address, {
          margin: 4,
          scale: 8,
          errorCorrectionLevel: 'M',
        })
      )
      .then((result) => {
        if (active) setImage(result)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [address])
  return (
    <div className="transfer-qr">
      {image ? (
        <img src={image} alt={label} />
      ) : error ? (
        <p role="alert">Не удалось создать QR-код. Обновите экран передачи.</p>
      ) : (
        <p role="status">Создаём QR-код…</p>
      )}
    </div>
  )
}

function Code({ code }: { code: string }) {
  return (
    <div className="transfer-code">
      <span>Код подтверждения устройства</span>
      <strong>{code}</strong>
    </div>
  )
}

function availableError(online: boolean, enabled: boolean) {
  if (!online) return 'Нет интернета. Подключитесь к сети и попробуйте снова.'
  if (!enabled)
    return 'Передача доступна после подключения приложения к Supabase.'
  return ''
}

type ReceiverState =
  | { kind: 'creating' }
  | { kind: 'waiting'; request: WaitingTransfer }
  | { kind: 'problem'; text: string }
  | { kind: 'received'; id: string }

export function ReceiveLesson({
  close,
  online,
  enabled,
}: {
  close: () => void
  online: boolean
  enabled: boolean
}) {
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<ReceiverState>({ kind: 'creating' })
  const [pollError, setPollError] = useState('')
  const [seconds, setSeconds] = useState(120)
  const pending = useRef<WaitingTransfer | null>(null)

  useEffect(() => {
    let active = true
    setPollError('')
    setState({ kind: 'creating' })
    const problem = availableError(navigator.onLine, enabled)
    if (problem) setState({ kind: 'problem', text: problem })
    else
      startTransfer()
        .then((request) => {
          if (!active) {
            void cancelTransfer(request).catch(() => {})
            return
          }
          pending.current = request
          setSeconds(Math.ceil((request.deadline - Date.now()) / 1000))
          setState({ kind: 'waiting', request })
        })
        .catch((error) => {
          if (active)
            setState({ kind: 'problem', text: (error as Error).message })
        })
    return () => {
      active = false
      const request = pending.current
      pending.current = null
      if (request && request.deadline > Date.now())
        void cancelTransfer(request).catch(() => {})
    }
  }, [attempt, enabled])

  const request = state.kind === 'waiting' ? state.request : null
  useEffect(() => {
    if (!request) return
    const controller = new AbortController()
    let nextPoll: number
    function expire() {
      controller.abort()
      pending.current = null
      setState({ kind: 'problem', text: transferMessage('expired') })
    }
    const expires = window.setTimeout(
      expire,
      Math.max(0, request.deadline - Date.now())
    )
    const ticker = window.setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((request.deadline - Date.now()) / 1000)))
    }, 500)
    async function poll(current: WaitingTransfer) {
      if (controller.signal.aborted || Date.now() >= current.deadline) return
      try {
        const result = await pollTransfer(current, controller.signal)
        if (controller.signal.aborted) return
        setPollError('')
        if (result.status === 'received' && result.publication_id) {
          pending.current = null
          setState({ kind: 'received', id: result.publication_id })
          return
        }
        if (result.status !== 'waiting' && result.status !== 'rate_limited') {
          pending.current = null
          setState({ kind: 'problem', text: transferMessage(result.status) })
          return
        }
      } catch {
        if (controller.signal.aborted) return
        setPollError('Связь прервалась. Проверяем подключение…')
      }
      nextPoll = window.setTimeout(() => void poll(current), 2300)
    }
    if (online) void poll(request)
    return () => {
      controller.abort()
      window.clearTimeout(expires)
      window.clearTimeout(nextPoll)
      window.clearInterval(ticker)
    }
  }, [request, online])

  return (
    <Frame
      title={
        state.kind === 'received'
          ? 'Методичка получена'
          : 'Передать методичку на этот компьютер'
      }
      close={close}
    >
      {state.kind === 'creating' && <p role="status">Создаём QR-код…</p>}
      {state.kind === 'problem' && (
        <>
          <p role="alert">{state.text}</p>
          <button
            className="primary"
            disabled={!online || !enabled}
            onClick={() => retry((n) => n + 1)}
          >
            Создать новый QR-код
          </button>
        </>
      )}
      {request && (
        <div className="transfer-wait">
          <QrImage
            address={pairLink(request)}
            label="Одноразовый QR-код подключения компьютера"
          />
          <div className="transfer-instructions">
            <p>
              Наведите камеру телефона на QR-код, откройте ссылку и сверьте код
              на обоих экранах.
            </p>
            <Code code={request.code} />
            <p role="status" className="transfer-status">
              <span className="transfer-indicator" aria-hidden="true" />
              {!online
                ? 'Нет интернета. Ожидание продолжится после подключения.'
                : pollError || 'Ожидаем передачу'}
            </p>
            <p className="transfer-time">Код действует ещё {seconds} с</p>
            <button className="secondary" onClick={close}>
              Отменить ожидание
            </button>
          </div>
        </div>
      )}
      {state.kind === 'received' && (
        <Received id={state.id} again={() => retry((n) => n + 1)} />
      )}
    </Frame>
  )
}

function Received({ id, again }: { id: string; again: () => void }) {
  const [title, setTitle] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [qr, showQr] = useState(false)
  const address = publicLessonLink(id)
  useEffect(() => {
    const controller = new AbortController()
    withTransferTimeout(
      (signal) => readPublic(id, signal),
      10000,
      controller.signal
    )
      .then(validateDeck)
      .then((deck) => {
        if (!controller.signal.aborted && deck.id === id) setTitle(deck.title)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [id])
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopyStatus('Публичная ссылка скопирована.')
    } catch {
      setCopyStatus('Выделите и скопируйте ссылку из поля.')
    }
  }
  return (
    <>
      {title && <p className="transfer-lesson-title">{title}</p>}
      <div className="transfer-actions">
        <a className="primary" href={'#p/' + id}>
          Открыть методичку
        </a>
        <button className="secondary" onClick={() => void copy()}>
          <Clipboard size={17} /> Скопировать ссылку
        </button>
      </div>
      <input
        className="transfer-link"
        aria-label="Публичная ссылка"
        value={address}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      {copyStatus && <p role="status">{copyStatus}</p>}
      <div className="transfer-share">
        <button
          className="secondary"
          aria-expanded={qr}
          onClick={() => showQr(!qr)}
        >
          <QrCode size={18} />{' '}
          {qr ? 'Скрыть QR-код для учеников' : 'Показать QR-код для учеников'}
        </button>
        {qr && (
          <div className="transfer-student">
            <h2>Публичный QR-код для учеников</h2>
            <p>Открывает эту методичку без входа в аккаунт.</p>
            <QrImage address={address} label="Публичный QR-код для учеников" />
          </div>
        )}
      </div>
      <button className="transfer-back" onClick={again}>
        Получить другую методичку
      </button>
    </>
  )
}

type Lesson = { id: string; title: string }
async function lessonChoices(signal: AbortSignal): Promise<Lesson[]> {
  const ids = await listPublished(signal)
  const choices: Lesson[] = []
  let index = 0
  async function worker() {
    while (!signal.aborted && index < ids.length) {
      const id = ids[index++]
      try {
        const deck = validateDeck(await readPublic(id, signal))
        if (deck.id === id) choices.push({ id, title: deck.title })
      } catch {
        if (signal.aborted) return
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))
  if (ids.length && !choices.length)
    throw Error(
      'Не удалось прочитать опубликованные методички. Попробуйте снова.'
    )
  return choices.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export function SendLesson({
  pair,
  close,
  login,
  authorized,
  online,
  enabled,
}: {
  pair: Pair | null
  close: () => void
  login: () => void
  authorized: boolean | null
  online: boolean
  enabled: boolean
}) {
  const [attempt, retry] = useState(0)
  const [details, setDetails] = useState<{
    code: string
    deadline: number
    lessons: Lesson[]
  }>()
  const [selected, select] = useState('')
  const [confirmed, confirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [terminal, setTerminal] = useState(false)
  const sendingRequest = useRef<AbortController | null>(null)
  const id = pair?.id,
    senderToken = pair?.senderToken
  const availability = availableError(online, enabled)

  useEffect(() => {
    if (!id || !senderToken || !authorized || availability || sent) return
    const controller = new AbortController()
    const active = () => !controller.signal.aborted
    setDetails(undefined)
    select('')
    confirm(false)
    setError('')
    setTerminal(false)
    setNeedsLogin(false)
    setLoading(true)
    async function load(request: Pair, signal: AbortSignal) {
      const result = await inspectTransfer(request, signal)
      if (!active()) return
      if (result.status !== 'waiting') {
        setTerminal(true)
        setNeedsLogin(result.status === 'forbidden')
        setError(transferMessage(result.status))
        return
      }
      const lessons = await lessonChoices(signal)
      if (active() && !signal.aborted) setDetails({ ...result, lessons })
      else if (active())
        setError('Не удалось загрузить публикации вовремя. Попробуйте снова.')
    }
    withTransferTimeout(
      (signal) => load({ id, senderToken }, signal),
      25000,
      controller.signal
    )
      .catch((err) => {
        if (active()) setError((err as Error).message)
      })
      .finally(() => {
        if (active()) setLoading(false)
      })
    return () => controller.abort()
  }, [id, senderToken, authorized, availability, attempt, sent])

  useEffect(() => () => sendingRequest.current?.abort(), [])

  useEffect(() => {
    if (!details || sent || sending) return
    const timer = window.setTimeout(
      () => {
        setError(transferMessage('expired'))
        setTerminal(true)
      },
      Math.max(0, details.deadline - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [details, sent, sending])

  async function submit() {
    if (
      !pair ||
      !details ||
      !selected ||
      !confirmed ||
      sendingRequest.current ||
      !authorized ||
      terminal
    )
      return
    const controller = new AbortController()
    sendingRequest.current = controller
    setSending(true)
    setError('')
    try {
      const result = await sendTransfer(pair, selected, controller.signal)
      if (controller.signal.aborted) return
      if (result.status === 'sent') setSent(true)
      else {
        setNeedsLogin(result.status === 'forbidden')
        setError(transferMessage(result.status))
        if (result.status === 'missing_publication') {
          select('')
          setDetails({
            ...details,
            lessons: details.lessons.filter((lesson) => lesson.id !== selected),
          })
        } else setTerminal(true)
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) setSending(false)
      sendingRequest.current = null
    }
  }

  return (
    <Frame
      title={
        sent
          ? 'Ссылка передана на компьютер'
          : 'Выберите методичку для передачи'
      }
      close={close}
      phone
    >
      {sent ? (
        <p className="transfer-success" role="status">
          <Check size={19} /> На компьютере нажмите «Открыть методичку».
        </p>
      ) : !pair ? (
        <p role="alert">{transferMessage('invalid')}</p>
      ) : availability ? (
        <p role="alert">{availability}</p>
      ) : authorized === null ? (
        <p role="status">Проверяем вход…</p>
      ) : !authorized ? (
        <>
          <p>Войдите в аккаунт преподавателя, чтобы выбрать публикацию.</p>
          <button className="primary" onClick={login}>
            Войти в аккаунт преподавателя
          </button>
        </>
      ) : (
        <>
          {loading && <p role="status">Загружаем публикации…</p>}
          {error && <p role="alert">{error}</p>}
          {needsLogin && (
            <button className="primary" onClick={login}>
              Войти в аккаунт преподавателя
            </button>
          )}
          {!details && error && !terminal && (
            <button className="secondary" onClick={() => retry((n) => n + 1)}>
              Попробовать снова
            </button>
          )}
          {details && !terminal && (
            <>
              <Code code={details.code} />
              {details.lessons.length ? (
                <form
                  className="transfer-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submit()
                  }}
                >
                  <fieldset className="transfer-choices" disabled={sending}>
                    <legend>Опубликованные методички</legend>
                    {details.lessons.map((lesson) => (
                      <label key={lesson.id}>
                        <input
                          type="radio"
                          name="publication"
                          value={lesson.id}
                          checked={selected === lesson.id}
                          onChange={() => select(lesson.id)}
                        />
                        <span>{lesson.title}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="transfer-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => confirm(e.currentTarget.checked)}
                      disabled={sending}
                    />
                    Код совпадает с кодом на компьютере
                  </label>
                  <button
                    className="primary"
                    disabled={!selected || !confirmed || sending}
                  >
                    {sending ? 'Передаём…' : 'Передать на компьютер'}
                  </button>
                </form>
              ) : (
                <p>Доступных опубликованных методичек нет.</p>
              )}
            </>
          )}
        </>
      )}
    </Frame>
  )
}

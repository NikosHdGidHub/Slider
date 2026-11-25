import { client, createGuestClient } from './cloud'
import { digest } from './digest'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const token = /^[0-9a-f]{64}$/
const deviceCode = /^[0-9A-F]{6}$/

export const receiveHash = '#receive-lesson'
export type Pair = { id: string; senderToken: string }
export type WaitingTransfer = Pair & {
  receiverToken: string
  code: string
  deadline: number
}

export function parsePair(hash: string): Pair | null {
  const [route, id, secret, ...rest] = hash.split('/')
  return route === '#transfer' &&
    uuid.test(id) &&
    token.test(secret) &&
    !rest.length
    ? { id, senderToken: secret }
    : null
}

function appLink(hash: string) {
  return location.origin + location.pathname + hash
}

export const pairLink = ({ id, senderToken }: Pair) =>
  appLink('#transfer/' + id + '/' + senderToken)
export const publicLessonLink = (id: string) => appLink('#p/' + id)

export type TransferStatus =
  | 'waiting'
  | 'rate_limited'
  | 'expired'
  | 'used'
  | 'canceled'
  | 'invalid'
  | 'forbidden'
  | 'missing_publication'
  | 'sent'
  | 'received'

type Response = {
  status: TransferStatus
  id?: string
  code?: string
  remaining_ms?: number
  publication_id?: string
}
const statuses = new Set<TransferStatus>([
  'waiting',
  'rate_limited',
  'expired',
  'used',
  'canceled',
  'invalid',
  'forbidden',
  'missing_publication',
  'sent',
  'received',
])

export function transferMessage(status: TransferStatus) {
  switch (status) {
    case 'expired':
      return 'QR-код устарел. Создайте новый запрос на компьютере.'
    case 'used':
      return 'Этот запрос уже использован. Создайте новый QR-код на компьютере.'
    case 'canceled':
      return 'Ожидание отменено на компьютере.'
    case 'forbidden':
      return 'Для передачи войдите в аккаунт преподавателя.'
    case 'missing_publication':
      return 'Методичка больше не опубликована.'
    case 'rate_limited':
      return 'Слишком много запросов. Подождите немного и попробуйте снова.'
    case 'invalid':
      return 'Запрос недействителен. Создайте новый QR-код на компьютере.'
    default:
      return 'Не удалось завершить передачу.'
  }
}

export async function withTransferTimeout<T>(
  action: (signal: AbortSignal) => PromiseLike<T>,
  milliseconds: number,
  parent?: AbortSignal
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = window.setTimeout(abort, milliseconds)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  try {
    return await action(controller.signal)
  } finally {
    window.clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
  }
}

async function rpc(
  action: 'start' | 'poll' | 'cancel' | 'inspect' | 'send',
  args: Record<string, string>,
  signal?: AbortSignal
): Promise<Response> {
  const api =
    action === 'inspect' || action === 'send' ? client : createGuestClient()
  if (!api) throw Error('Для передачи необходимо подключить Supabase.')
  const { data, error, status } = await withTransferTimeout(
    (request) => api.rpc('atlas_transfer_' + action, args).abortSignal(request),
    10000,
    signal
  )
  if (status === 401 || status === 403) return { status: 'forbidden' }
  if (error?.code === 'PGRST202')
    throw Error('Передача пока не настроена на сервере.')
  if (error || !data || !statuses.has(data.status))
    throw Error('Не удалось связаться с облаком. Проверьте подключение.')
  return data as Response
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

function waitingDetails(result: Response, startedAt: number) {
  if (result.status !== 'waiting') throw Error(transferMessage(result.status))
  if (
    !result.code ||
    !deviceCode.test(result.code) ||
    typeof result.remaining_ms !== 'number' ||
    !Number.isFinite(result.remaining_ms) ||
    result.remaining_ms <= 0 ||
    result.remaining_ms > 120000
  )
    throw Error('Сервер вернул некорректный запрос передачи.')
  return { code: result.code, deadline: startedAt + result.remaining_ms }
}

export async function startTransfer(): Promise<WaitingTransfer> {
  const senderToken = randomToken(),
    receiverToken = randomToken()
  const [sender_hash, receiver_hash] = await Promise.all([
    digest(new Blob([senderToken])),
    digest(new Blob([receiverToken])),
  ])
  const startedAt = Date.now()
  const result = await rpc('start', { sender_hash, receiver_hash })
  const details = waitingDetails(result, startedAt)
  if (!result.id || !uuid.test(result.id))
    throw Error('Сервер вернул некорректный запрос передачи.')
  return { id: result.id, ...details, senderToken, receiverToken }
}

export async function pollTransfer(
  { id, receiverToken }: WaitingTransfer,
  signal: AbortSignal
) {
  const result = await rpc(
    'poll',
    { request_id: id, receiver_token: receiverToken },
    signal
  )
  if (
    result.status === 'received' &&
    (!result.publication_id || !uuid.test(result.publication_id))
  )
    throw Error('Получен некорректный идентификатор методички.')
  return result
}

export function cancelTransfer({ id, receiverToken }: WaitingTransfer) {
  return rpc('cancel', { request_id: id, receiver_token: receiverToken })
}

export async function inspectTransfer(pair: Pair, signal: AbortSignal) {
  const startedAt = Date.now()
  const result = await rpc(
    'inspect',
    { request_id: pair.id, sender_token: pair.senderToken },
    signal
  )
  return result.status === 'waiting'
    ? { status: result.status, ...waitingDetails(result, startedAt) }
    : { status: result.status }
}

export function sendTransfer(
  pair: Pair,
  publicationId: string,
  signal: AbortSignal
) {
  if (!uuid.test(publicationId))
    throw Error('Некорректный идентификатор методички.')
  return rpc(
    'send',
    {
      request_id: pair.id,
      sender_token: pair.senderToken,
      publication_id: publicationId,
    },
    signal
  )
}

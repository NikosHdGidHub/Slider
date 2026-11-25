import { mediaSlides } from './grid.ts'
import { importSVG } from './vectorImport'
import { imageSource, MAX_DOCUMENT_BYTES, validateDeck } from './model'
import type { Deck } from './model'

const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const RASTER_MIME = ['image/png', 'image/jpeg', 'image/webp']

function decode(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  return image
    .decode()
    .then(() => {
      if (!image.naturalWidth || !image.naturalHeight)
        throw new Error('У изображения нет размеров.')
      return image
    })
    .catch(() => {
      throw new Error('Не удалось открыть изображение. Проверьте формат файла.')
    })
}

function dataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new Error('Не удалось прочитать файл изображения.'))
    reader.readAsDataURL(blob)
  })
}

export async function originalBackground(file: File) {
  if (!RASTER_MIME.includes(file.type) || file.size > MAX_IMAGE_BYTES)
    throw Error(
      'Для оригинала нужен PNG, JPEG или WebP до 16 МиБ. Выберите оптимизацию или меньший файл.'
    )
  const src = imageSource(await dataURL(file))
  await decode(src)
  return src
}
export async function optimize(
  file: Blob,
  limit = MAX_IMAGE_BYTES
): Promise<{ src: string; width: number; height: number }> {
  if (!file.size || file.size > limit)
    throw new Error('Выберите файл размером до ' + limit / 1048576 + ' МиБ.')
  const svg = file.type === 'image/svg+xml'
  if (!svg && !RASTER_MIME.includes(file.type))
    throw new Error('Выберите изображение JPEG, PNG, WebP или SVG.')
  if (svg) await importSVG(file)
  const objectURL = URL.createObjectURL(file)
  try {
    const image = await decode(objectURL)
    const scale = Math.min(
      1,
      1920 / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Браузеру не удалось обработать изображение.')
    context.drawImage(image, 0, 0, width, height)
    const webp = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Не удалось преобразовать изображение.'))
        },
        'image/webp',
        0.82
      )
    )
    const compact = !svg && scale === 1 && file.size <= webp.size ? file : webp
    return { src: imageSource(await dataURL(compact)), width, height }
  } finally {
    URL.revokeObjectURL(objectURL)
  }
}

async function readImageResponse(response: Response): Promise<Blob> {
  const tooLarge = () => new Error('Изображение превышает 16 МБ.')
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES)
    throw tooLarge()
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Пустой ответ сервера.')
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      parts.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  const type = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
  return new Blob(parts, { type })
}

export async function embedImages(deck: Deck): Promise<Deck> {
  const copy = validateDeck(deck)
  const embedded = new Map<string, string>()
  async function embed(src: string): Promise<string> {
    const existing = embedded.get(src)
    if (existing) return existing
    let result = src
    if (src.startsWith('data:')) {
      await decode(src)
    } else {
      try {
        const response = await fetch(src, {
          credentials: 'omit',
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) throw new Error(String(response.status))
        const blob = await readImageResponse(response)
        if (RASTER_MIME.includes(blob.type) && blob.size <= MAX_IMAGE_BYTES) {
          result = imageSource(await dataURL(blob))
          await decode(result)
        } else {
          result = (await optimize(blob)).src
        }
      } catch {
        throw new Error(
          'Не удалось сохранить изображение. Проверьте доступность файла, разрешение CORS и подключение к интернету.'
        )
      }
    }
    embedded.set(src, result)
    return result
  }
  for (const slide of mediaSlides(copy)) {
    if (slide.background) slide.background = await embed(slide.background)
    for (const item of slide.items) {
      if (item.type === 'image') item.src = await embed(item.src)
    }
  }
  if (new Blob([JSON.stringify(copy)]).size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      'Со встроенными изображениями методичка превышает 64 МБ. Уменьшите изображения или разделите занятие.'
    )
  }
  return copy
}

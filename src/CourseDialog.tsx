import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Folder } from 'lucide-react'
import {
  courseColors,
  courseDetails,
  type Course,
  type CourseColor,
} from './courseModel'

export type CourseDialogMode =
  | { kind: 'create' }
  | { kind: 'rename' | 'color' | 'delete'; course: Course; members?: string[] }
  | { kind: 'move'; ids: string[]; from: string }

export function CourseDialog({
  mode,
  courses,
  close,
  save,
}: {
  mode: CourseDialogMode
  courses: Course[]
  close: () => void
  save: (fields: {
    title: string
    color: string
    destination: string
  }) => Promise<void>
}) {
  const initial = 'course' in mode ? mode.course : undefined
  const [title, setTitle] = useState(initial?.title ?? '')
  const [color, setColor] = useState<CourseColor>(initial?.color ?? '#407f69')
  const [destination, setDestination] = useState(
    mode.kind === 'move' ? mode.from : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const panel = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    if (!panel.open) panel.showModal()
    return () => {
      panel.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  const editing = mode.kind === 'create' || destination === 'new'
  const heading = {
    create: 'Новый курс',
    rename: 'Переименовать курс',
    color: 'Цвет папки',
    delete: 'Удалить курс',
    move:
      mode.kind === 'move' && mode.ids.length > 1
        ? 'Переместить методички'
        : 'Переместить в курс',
  }[mode.kind]

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      if (editing || mode.kind === 'rename') courseDetails(title, color)
      await save({ title, color, destination })
      close()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось сохранить изменения.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="dialog course-dialog"
      aria-labelledby="course-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) close()
      }}
    >
      <h2 id="course-dialog-title">{heading}</h2>
      <form onSubmit={submit}>
        {mode.kind === 'move' && (
          <label>
            Курс назначения
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Без курса</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
              <option value="new">Создать новый курс…</option>
            </select>
          </label>
        )}
        {(editing || mode.kind === 'rename') && (
          <label>
            Название курса
            <input
              autoFocus={mode.kind !== 'move'}
              value={title}
              maxLength={120}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {(editing || mode.kind === 'color') && (
          <fieldset className="course-palette">
            <legend>Цвет папки</legend>
            {Object.entries(courseColors).map(([id, label]) => (
              <label key={id} title={label} style={{ color: id }}>
                <input
                  type="radio"
                  name="course-color"
                  aria-label={label}
                  checked={color === id}
                  onChange={() => setColor(id as CourseColor)}
                />
                <Folder size={22} fill="currentColor" />
              </label>
            ))}
          </fieldset>
        )}
        {mode.kind === 'delete' && (
          <p>
            Удалить курс «{mode.course.title}»?{' '}
            {!!mode.members?.length &&
              'Методички вернутся в раздел отдельных методичек. Их черновики и публикации сохранятся.'}
          </p>
        )}
        {error && (
          <p role="alert" className="course-dialog-error">
            {error}
          </p>
        )}
        <div className="course-dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={busy}
          >
            Отмена
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? 'Сохраняем…'
              : mode.kind === 'delete'
                ? 'Удалить курс'
                : mode.kind === 'move'
                  ? 'Переместить'
                  : mode.kind === 'create'
                    ? 'Создать курс'
                    : 'Сохранить'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

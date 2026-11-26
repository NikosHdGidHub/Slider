export const courseColors = {
  '#407f69': 'Зелёный',
  '#426a9c': 'Синий',
  '#795da5': 'Сиреневый',
  '#a16b33': 'Охра',
  '#a05367': 'Розовый',
  '#52636f': 'Серый',
} as const

export type CourseColor = keyof typeof courseColors
export interface Course {
  id: string
  title: string
  color: CourseColor
}
export interface CourseSnapshot {
  revision: number
  courses: Course[]
  lessons: Record<string, string[]>
}
type Details = Pick<Course, 'title' | 'color'>
export type CourseCommand =
  | { kind: 'create'; course: Course }
  | { kind: 'edit'; id: string; before: Partial<Details>; details: Partial<Details> }
  | { kind: 'delete'; id: string; before: Course; members: string[] }
  | { kind: 'move'; ids: string[]; before: Record<string, string | null>; to: string | null }
  | { kind: 'order'; id: string | null; before: string[]; order: string[] }

export interface CourseAttempt {
  id: string
  count: number
  snapshot: CourseSnapshot
}
export interface CourseRecord {
  base: CourseSnapshot
  pending: CourseCommand[]
  attempt?: CourseAttempt
  conflict?: CourseSnapshot
}

export const emptyCourses = (): CourseSnapshot => ({ revision: 0, courses: [], lessons: {} })
export const emptyCourseRecord = (): CourseRecord => ({ base: emptyCourses(), pending: [] })
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const titleLimit = 120

export function courseDetails(title: string, color: string): Details {
  const clean = title.trim()
  if (!clean || [...clean].length > titleLimit)
    throw Error('Введите название курса длиной от 1 до 120 символов.')
  if (!Object.hasOwn(courseColors, color)) throw Error('Выберите цвет папки.')
  return { title: clean, color: color as CourseColor }
}

export function readCourseSnapshot(value: unknown): CourseSnapshot {
  const s = value as CourseSnapshot
  if (!s || !Number.isSafeInteger(s.revision) || s.revision < 0 ||
      !Array.isArray(s.courses) || !s.lessons || typeof s.lessons !== 'object' || Array.isArray(s.lessons))
    throw Error('Облако вернуло некорректную структуру курсов.')
  const courseIds = new Set<string>()
  const lessonIds = new Set<string>()
  for (const course of s.courses) {
    if (!course || typeof course.id !== 'string' || !uuid.test(course.id) || courseIds.has(course.id) ||
        typeof course.title !== 'string' || courseDetails(course.title, course.color).title !== course.title)
      throw Error('Облако вернуло некорректный курс.')
    courseIds.add(course.id)
    const order = s.lessons[course.id]
    if (!Array.isArray(order)) throw Error('В курсе отсутствует порядок занятий.')
    for (const id of order) {
      if (typeof id !== 'string' || !uuid.test(id) || lessonIds.has(id))
        throw Error('Некорректная принадлежность методички.')
      lessonIds.add(id)
    }
  }
  if (Object.keys(s.lessons).length !== courseIds.size) throw Error('Обнаружена связь с неизвестным курсом.')
  return s
}

const equal = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])
export function memberships(state: CourseSnapshot) {
  return new Map(Object.entries(state.lessons).flatMap(([course, ids]) => ids.map((id) => [id, course] as const)))
}

// Change the positions of supplied records while keeping the slots of unavailable records intact.
export function orderVisible(full: string[], order: string[]) {
  const ranked = new Set(order)
  let index = 0
  return full.map((id) => ranked.has(id) ? order[index++] : id)
}

export function moveCommand(state: CourseSnapshot, ids: string[], to: string | null): CourseCommand {
  const current = memberships(state)
  const unique = [...new Set(ids)]
  return { kind: 'move', ids: unique, to, before: Object.fromEntries(unique.map((id) => [id, current.get(id) ?? null])) }
}

export class CourseConflict extends Error {
  constructor() { super('Структура курсов изменилась на другом устройстве.') }
}
function requireUnchanged(condition: boolean) {
  if (!condition) throw new CourseConflict()
}

export function applyCourseCommands(base: CourseSnapshot, commands: CourseCommand[], local?: CourseSnapshot): CourseSnapshot {
  const state = structuredClone(base)
  const ensure = (id: string) => {
    const existing = state.courses.find((c) => c.id === id)
    if (existing) return existing
    const restored = local?.courses.find((c) => c.id === id)
    if (!restored) throw new CourseConflict()
    const course = { ...restored }
    state.courses.push(course)
    const current = memberships(state)
    state.lessons[id] = local!.lessons[id].filter((lesson) => !current.has(lesson))
    return course
  }
  for (const command of commands) {
    switch (command.kind) {
      case 'create': {
        const existing = state.courses.find((c) => c.id === command.course.id)
        requireUnchanged(!existing || (existing.title === command.course.title && existing.color === command.course.color))
        if (!existing) {
          state.courses.push({ ...command.course })
          state.lessons[command.course.id] = []
        }
        break
      }
      case 'edit': {
        if (local && !local.courses.some((c) => c.id === command.id) && !state.courses.some((c) => c.id === command.id)) break
        const course = ensure(command.id)
        if (!local) requireUnchanged(
          (['title', 'color'] as const).every((field) =>
            command.details[field] === undefined || course[field] === command.before[field] || course[field] === command.details[field])
        )
        Object.assign(course, command.details)
        break
      }
      case 'delete': {
        const course = state.courses.find((c) => c.id === command.id)
        if (!course) break
        if (!local) requireUnchanged(course.title === command.before.title && course.color === command.before.color &&
          equal([...state.lessons[course.id]].sort(), [...command.members].sort()))
        state.courses = state.courses.filter((c) => c.id !== course.id)
        delete state.lessons[course.id]
        break
      }
      case 'move': {
        if (command.to) ensure(command.to)
        const current = memberships(state)
        const moving = new Set(command.ids.filter((id) => (current.get(id) ?? null) !== command.to))
        if (!local) requireUnchanged([...moving].every((id) => (current.get(id) ?? null) === command.before[id]))
        for (const id of Object.keys(state.lessons))
          state.lessons[id] = state.lessons[id].filter((lesson) => !moving.has(lesson))
        if (command.to) state.lessons[command.to].push(...moving)
        break
      }
      case 'order': {
        const id = command.id
        if (id) ensure(id)
        const current = id ? state.lessons[id] : state.courses.map((c) => c.id)
        if (equal(current, command.order)) break
        const common = new Set(current)
        const expected = new Set(command.before)
        if (!local) requireUnchanged(equal(current.filter((v) => expected.has(v)), command.before.filter((v) => common.has(v))))
        const order = orderVisible(current, command.order.filter((v) => common.has(v)))
        if (id) state.lessons[id] = order
        else {
          const rows = new Map(state.courses.map((c) => [c.id, c]))
          state.courses = order.map((v) => rows.get(v)!)
        }
        break
      }
    }
  }
  return state
}

export function visibleCourses(record: CourseRecord) {
  return applyCourseCommands(record.base, record.pending)
}

export function stageCourseSync(record: CourseRecord, remote: CourseSnapshot, id: string): CourseRecord {
  if (!record.pending.length) return { base: remote, pending: [] }
  if (record.attempt) return record
  try {
    const snapshot = applyCourseCommands(remote, record.pending)
    return { base: remote, pending: record.pending, attempt: { id, count: record.pending.length, snapshot } }
  } catch (error) {
    if (!(error instanceof CourseConflict)) throw error
    return { ...record, conflict: remote }
  }
}

export function acknowledgeCourseSync(record: CourseRecord, attempt: CourseAttempt, remote: CourseSnapshot): CourseRecord {
  if (record.attempt?.id !== attempt.id) return record
  const pending = record.pending.slice(attempt.count)
  try {
    applyCourseCommands(remote, pending)
    return { base: remote, pending }
  } catch (error) {
    if (!(error instanceof CourseConflict)) throw error
    return { base: { ...attempt.snapshot, revision: remote.revision }, pending, conflict: remote }
  }
}

export function appendCourseCommands(record: CourseRecord, commands: CourseCommand[], cloud: boolean): CourseRecord {
  const snapshot = applyCourseCommands(visibleCourses(record), commands)
  return cloud ? { ...record, pending: [...record.pending, ...commands] } : { base: snapshot, pending: [] }
}

export function resolveCourseConflict(record: CourseRecord, choice: 'local' | 'remote'): CourseRecord {
  const remote = record.conflict
  if (!remote) return record
  if (choice === 'remote') return { base: remote, pending: [] }
  const desired = applyCourseCommands(remote, record.pending, visibleCourses(record))
  const commands: CourseCommand[] = []
  for (const course of remote.courses) {
    const next = desired.courses.find((c) => c.id === course.id)
    if (!next) {
      commands.push({ kind: 'delete', id: course.id, before: course, members: remote.lessons[course.id] })
    } else if (course.title !== next.title || course.color !== next.color) {
      const before: Partial<Details> = {}
      const details: Partial<Details> = {}
      if (course.title !== next.title) { before.title = course.title; details.title = next.title }
      if (course.color !== next.color) { before.color = course.color; details.color = next.color }
      commands.push({ kind: 'edit', id: course.id, before, details })
    }
  }
  for (const course of desired.courses)
    if (!remote.courses.some((c) => c.id === course.id)) commands.push({ kind: 'create', course })

  let working = applyCourseCommands(remote, commands)
  const previous = memberships(working)
  const next = memberships(desired)
  const moves = new Map<string | null, string[]>()
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const to = next.get(id) ?? null
    if (to !== (previous.get(id) ?? null)) moves.set(to, [...(moves.get(to) ?? []), id])
  }
  for (const [to, ids] of moves) {
    const move = moveCommand(working, ids, to)
    commands.push(move)
    working = applyCourseCommands(working, [move])
  }
  for (const id of [null, ...desired.courses.map((c) => c.id)]) {
    const before = id ? working.lessons[id] : working.courses.map((c) => c.id)
    const order = id ? desired.lessons[id] : desired.courses.map((c) => c.id)
    if (!equal(before, order)) commands.push({ kind: 'order', id, before, order })
  }
  return { base: remote, pending: commands }
}

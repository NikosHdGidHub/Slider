import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acknowledgeCourseSync,
  appendCourseCommands,
  applyCourseCommands,
  courseDetails,
  emptyCourseRecord,
  memberships,
  moveCommand,
  orderVisible,
  readCourseSnapshot,
  resolveCourseConflict,
  stageCourseSync,
  visibleCourses,
} from '../src/courseModel.ts'

const id = (n) => '0a100001-0000-4000-8000-' + n.toString().padStart(12, '0')
const add = (n, title = 'Курс ' + n) => ({
  kind: 'create',
  course: { id: id(n), ...courseDetails(title, '#407f69') },
})
const a = id(1),
  b = id(2),
  c = id(3),
  x = id(4),
  y = id(5),
  z = id(6)
let base = applyCourseCommands(emptyCourseRecord().base, [
  add(1),
  add(2),
  moveCommand(emptyCourseRecord().base, [x, y, z], a),
])
base = { ...base, revision: 1 }

test('bulk move and course delete leave immutable, unique UUID associations', () => {
  const moved = applyCourseCommands(base, [moveCommand(base, [x, y, x], b)])
  assert.deepEqual(moved.lessons[b], [x, y])
  assert.deepEqual(moved.lessons[a], [z])
  const detached = applyCourseCommands(moved, [
    { kind: 'delete', id: b, before: moved.courses[1], members: [x, y] },
  ])
  assert.deepEqual([...memberships(detached)], [[z, a]])
  assert.deepEqual(base.lessons[a], [x, y, z])
  assert.throws(() => applyCourseCommands(base, [moveCommand(base, [x], c)]))
  assert.throws(() => courseDetails('   ', '#407f69'))
  assert.throws(() => courseDetails('Курс', '#ffaabb'))
  assert.throws(() =>
    readCourseSnapshot({ ...base, lessons: { ...base.lessons, [b]: [x] } })
  )
})

test('visible reordering leaves hidden lessons and independently added courses intact', () => {
  assert.deepEqual(orderVisible([x, y, z], [z, x]), [z, y, x])
  const order = { kind: 'order', id: a, before: [x, y, z], order: [z, y, x] }
  const offline = appendCourseCommands({ base, pending: [] }, [order], true)
  const remote = { ...applyCourseCommands(base, [add(3)]), revision: 2 }
  const staged = stageCourseSync(offline, remote, id(9))
  assert.equal(staged.attempt.snapshot.revision, 2)
  assert.deepEqual(staged.attempt.snapshot.lessons[a], [z, y, x])
  assert.equal(staged.attempt.snapshot.courses[2].id, c)
})

test('conflicting moves are kept locally and resolution preserves unrelated cloud changes', () => {
  const remote = {
    ...applyCourseCommands(base, [add(3), moveCommand(base, [x], c)]),
    revision: 2,
  }
  const local = appendCourseCommands(
    { base, pending: [] },
    [moveCommand(base, [x], b)],
    true
  )
  const conflict = stageCourseSync(local, remote, id(9))
  assert.deepEqual(conflict.conflict, remote)
  assert.deepEqual(visibleCourses(conflict).lessons[b], [x])
  assert.deepEqual(
    visibleCourses(resolveCourseConflict(conflict, 'remote')),
    remote
  )
  const rebased = visibleCourses(resolveCourseConflict(conflict, 'local'))
  assert.deepEqual(rebased.lessons[b], [x])
  assert.ok(rebased.courses.some((course) => course.id === c))
  assert.deepEqual(rebased.lessons[c], [])
})

test('acknowledgement removes only the sent prefix; late receipt is ignored', () => {
  const local = appendCourseCommands(
    { base, pending: [] },
    [moveCommand(base, [x], b)],
    true
  )
  const staged = stageCourseSync(local, base, id(9))
  const newer = appendCourseCommands(staged, [add(3)], true)
  const server = { ...staged.attempt.snapshot, revision: 2 }
  const ack = acknowledgeCourseSync(newer, staged.attempt, server)
  assert.equal(ack.pending.length, 1)
  assert.deepEqual(visibleCourses(ack).lessons[b], [x])
  assert.ok(visibleCourses(ack).courses.some((course) => course.id === c))
  assert.equal(acknowledgeCourseSync(ack, staged.attempt, server), ack)
})

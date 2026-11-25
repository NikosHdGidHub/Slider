import { readFileSync } from 'node:fs'
import {
  baseTemplate,
  createGridTemplate,
  twoByTwo,
  validateTemplate,
} from '../src/catalog.ts'
import { cell } from '../src/grid.ts'
import { newShape, newText } from '../src/model.ts'

const icon =
  'data:image/png;base64,' +
  readFileSync(
    new URL('../public/icons/atlas-192.png', import.meta.url)
  ).toString('base64')
const diagram =
  'data:image/png;base64,' +
  readFileSync(new URL('./fixtures/orbits.png', import.meta.url)).toString(
    'base64'
  )
const font = (file) => ({
  id: 'teacherFont',
  label: file === 'Sans' ? 'Классная гарнитура' : 'Посторонняя гарнитура',
  format: 'woff',
  data: readFileSync(
    new URL('../src/assets/fonts/' + file + '.woff', import.meta.url)
  ).toString('base64'),
})

function main(title, description) {
  const result = createGridTemplate('presentation', title)
  result.description = description
  return result
}
function text(text, x, y, w, h, properties = {}) {
  return { ...newText(), text, x, y, w, h, ...properties }
}
function fixed(shape) {
  return { ...shape, role: 'decoration', fixed: true }
}

export function selectionFixtures() {
  const frame = main(
    'Меловая рамка',
    'Верхний колонтитул и экзаменационная рамка'
  )
  frame.deck.header = 'Школа · Кафедра естествознания'
  for (const role of ['title', 'normal', 'end']) {
    frame.deck.master.schemes[role] = {
      rows: [1, 8],
      cols: [1],
      padding: [38, 90, 52, 90],
      cells: [
        {
          ...cell(0, 0, 'header', 'header'),
          padding: [0, 14, 0, 14],
          style: { size: 23, bold: true, color: '#31614f' },
        },
        cell(1, 0, 'area', 'body'),
      ],
    }
  }
  for (const slide of frame.deck.slides) {
    slide.color = '#f3f5e8'
    slide.items.push(
      fixed({
        ...newShape('rect'),
        x: 24,
        y: 24,
        w: 1232,
        h: 672,
        fill: { type: 'none' },
        stroke: '#287458',
        strokeWidth: 4,
      })
    )
    slide.items.push(
      fixed(
        text('АТЛАС', 1090, 47, 105, 31, {
          size: 22,
          color: '#28614a',
          align: 'right',
        })
      )
    )
    slide.notes = 'SECRET_PRIVATE_TEACHER_NOTES'
  }

  const roles = main(
    'Три сезона',
    'Разные схемы для начала, объяснения и вывода'
  )
  roles.deck.slides.forEach((slide, index) => {
    slide.color = ['#f1e9fb', '#edf5f4', '#fff0df'][index]
    slide.items.push(
      fixed({
        ...newShape('rect'),
        x: 0,
        y: 704,
        w: 1280,
        h: 16,
        fill: {
          type: 'solid',
          color: ['#6d4895', '#327d72', '#de9856'][index],
        },
      })
    )
  })

  const grid = main(
    'Лаборатория 2 × 3',
    'Объединённые ячейки и слот для изображения'
  )
  grid.deck.header = 'Наблюдения и доказательства'
  grid.deck.master.schemes.normal = {
    rows: [1, 8, 1],
    cols: [1],
    padding: [26, 66, 26, 66],
    cells: [
      {
        ...cell(0, 0, 'header', 'header'),
        style: { size: 20, bold: true, color: '#2b6350' },
      },
      cell(1, 0, 'area', 'body'),
      {
        ...cell(2, 0, 'footer', 'footer'),
        value: 'Лабораторная тетрадь',
        style: { size: 19, color: '#45665a' },
      },
    ],
  }
  grid.deck.slides[1].structure = {
    rows: [1, 2.8, 1],
    cols: [1.1, 1],
    padding: [17, 24, 15, 24],
    cells: [
      {
        ...cell(0, 0, 'title', 'question'),
        cols: 2,
        padding: [9, 20, 8, 20],
        style: { size: 46, bold: true },
      },
      {
        ...cell(1, 0, 'description', 'reason'),
        padding: [10, 20, 12, 20],
        fill: '#e7f0e9',
        style: { size: 38 },
      },
      {
        ...cell(1, 1, 'image', 'photo'),
        padding: [10, 14, 12, 14],
        fill: '#e9f1ed',
      },
      {
        ...cell(2, 0, 'caption', 'answer'),
        cols: 2,
        padding: [8, 20, 8, 20],
        style: { size: 28 },
      },
    ],
  }
  grid.deck.slides[1].items.push({
    ...newText(),
    type: 'image',
    text: '',
    src: diagram,
    slot: 's/photo',
  })

  const fonts = main(
    'Типографика атласа',
    'Пользовательский шрифт и крупные подписи'
  )
  fonts.deck.resources.fonts = [font('Sans')]
  fonts.deck.theme.palette = ['#113c36', '#e2eee7', '#cf7a43']
  fonts.deck.theme.styles[0].values.font = 'teacherFont'
  fonts.deck.theme.styles[2].values.font = 'teacherFont'
  fonts.deck.master.schemes.title.cells[0].style = {
    font: 'teacherFont',
    size: 38,
  }
  fonts.deck.slides[0].items.push(
    fixed({
      ...text('УЧЕБНАЯ СЕРИЯ', 80, 610, 420, 45, {
        size: 28,
        overrides: { font: 'teacherFont' },
      }),
    })
  )
  fonts.deck.slides.forEach((slide) => {
    slide.color = '#f1ece5'
  })

  const artwork = main(
    'Графика и изображения',
    'Градиент и закреплённый векторный контур'
  )
  for (const slide of artwork.deck.slides) {
    slide.background = icon
    slide.effects = { fit: 'contain', brightness: 48 }
    slide.items.push(
      fixed({
        ...newShape('path'),
        x: 965,
        y: 440,
        w: 235,
        h: 230,
        closed: true,
        fill: {
          type: 'linear',
          angle: 25,
          stops: [
            { offset: 0, color: '#e4f8eb' },
            { offset: 1, color: '#316a52' },
          ],
        },
        stroke: '#164738',
        strokeWidth: 6,
      })
    )
    slide.items.push(
      fixed({
        ...newText(),
        type: 'image',
        x: 1030,
        y: 42,
        w: 115,
        h: 115,
        text: '',
        src: icon,
      })
    )
  }

  const local = main(
    'Локальная версия · клены',
    'LOCAL_ONLY_CANARY, изменения ещё на устройстве'
  )
  local.deck.resources.fonts = [font('Serif')]
  local.deck.theme.styles[0].values.font = 'teacherFont'
  local.deck.theme.styles[0].label = 'UNRELATED_STYLE_CANARY'
  local.deck.slides[0].color = '#ecf6ee'

  return {
    standard: baseTemplate,
    frame,
    roles,
    grid,
    fonts,
    artwork,
    local,
    layout: twoByTwo,
  }
}

export const fixtureIcon = icon
export const validatedFixtures = () =>
  Object.fromEntries(
    Object.entries(selectionFixtures()).map(([key, template]) => [
      key,
      validateTemplate(template),
    ])
  )

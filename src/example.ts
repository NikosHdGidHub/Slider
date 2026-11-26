import { newDeck, newSlide, newText, type Slide } from './model'
import relief from './assets/relief.webp'
export const example = newDeck('Как читать рельеф')
const pages = [
  [
    'Рельеф на карте',
    'Как линии превращаются в горы',
    'Попросите учеников найти самую высокую часть массива и объяснить свой выбор.',
  ],
  [
    'Горизонтали',
    'Каждая линия соединяет точки одинаковой высоты.',
    'Предложите проследить пальцем одну горизонталь, не переходя на соседнюю.',
  ],
  [
    'Крутизна склона',
    'Чем ближе горизонтали друг к другу, тем круче склон.',
    'Сравните два участка карты. Где подъём потребует больше усилий?',
  ],
  [
    'Проверьте себя',
    'Как выбрать самый пологий путь к вершине?',
    'Обсудите варианты маршрута и попросите обосновать решение.',
  ],
]
example.slides = pages.map(([title, body, notes], i): Slide => {
  const slide = newSlide()
  slide.color = '#dce2c1'
  slide.notes = notes
  slide.items = [
    {
      ...newText(),
      type: 'image',
      src: relief,
      text: '',
      x: 575,
      y: 88,
      w: 705,
      h: 545,
    },
    {
      ...newText(),
      text: 'ГЕОГРАФИЯ  /  ' + String(i + 1).padStart(2, '0'),
      x: 55,
      y: 82,
      w: 500,
      h: 50,
      overrides: { size: 24, color: '#315748' },
    },
    {
      ...newText(),
      text: title,
      x: 55,
      y: 194,
      w: 590,
      h: 210,
      overrides: { size: 75, color: '#183f34' },
    },
    {
      ...newText(),
      text: body,
      x: 58,
      y: 430,
      w: 520,
      h: 200,
      overrides: { size: 36, color: '#315748' },
    },
  ]
  return slide
})

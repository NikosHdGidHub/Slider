import type { TextStyle } from './model.ts'

export const textTypes = {
  title: 'Заголовок',
  subtitle: 'Подзаголовок',
  description: 'Описание',
  text: 'Текст',
  header: 'Верхний колонтитул',
  footer: 'Нижний колонтитул',
  caption: 'Подпись',
} as const

export type TextType = keyof typeof textTypes
export type StrictTextType = Exclude<TextType, 'text'>
export type SystemStyles = Record<TextType, TextStyle>
export const textTypeIds = Object.keys(textTypes) as TextType[]
export function isTextType(value: string | undefined): value is TextType {
  return !!value && Object.hasOwn(textTypes, value)
}

export function defaultSystemStyles(): SystemStyles {
  const base: TextStyle = {
    font: 'sans',
    color: '#183e45',
    fit: true,
    minSize: 16,
  }
  return {
    title: { ...base, size: 56, weight: '700' },
    subtitle: { ...base, size: 40 },
    description: { ...base, size: 32 },
    text: { ...base, size: 32 },
    header: { ...base, size: 24 },
    footer: { ...base, size: 24 },
    caption: { ...base, size: 22 },
  }
}

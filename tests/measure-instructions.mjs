import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  presentationInstructionsForTemplate,
  templateInstructions,
} from '../src/instructions.ts'
import { validatedFixtures } from './instruction-fixtures.mjs'

const inputs = validatedFixtures()
const templates = Object.values(inputs)
const scope = 'Встроенные, локальные и облачные шаблоны'
const baseline = process.argv[2]
  ? await import(pathToFileURL(resolve(process.argv[2], 'src/instructions.ts')))
  : undefined
const priorFixtures = baseline?.presentationInstructionsForTemplate
  ? (
      await import(
        pathToFileURL(
          resolve(process.argv[2], 'tests/instruction-fixtures.mjs')
        )
      )
    ).validatedFixtures()
  : undefined
const oldPresentation = baseline?.instructions?.(templates, scope)
const oldTemplate = baseline?.instructions
  ? baseline.templateInstructions(templates, scope)
  : undefined
const reports = []
const byteLength = (text) => Buffer.byteLength(text, 'utf8')

function report(label, text, old) {
  const blocks = text.split('\n\n')
  const bytes = byteLength(text)
  const oldBytes = old ? byteLength(old) : undefined
  const json = Object.fromEntries(
    text
      .split('\n')
      .filter((block) => block.startsWith('{'))
      .map((block) => {
        const value = JSON.parse(block)
        return [
          value.$defs
            ? 'schema'
            : value.presentation
              ? 'seed'
              : value.deck
                ? 'example'
                : value.fonts && value.cellTypes
                  ? 'reference'
                  : Object.keys(value)[0],
          value,
        ]
      })
  )
  const seed = json.seed?.presentation
  const fonts =
    seed?.resources.fonts.reduce((n, asset) => n + byteLength(asset.data), 0) ??
    0
  const images = blocks.find((block) => block.startsWith('{"@image/')) ?? ''
  reports.push({
    label,
    old: oldBytes,
    new: bytes,
    delta: oldBytes
      ? Math.round(((oldBytes - bytes) / oldBytes) * 1000) / 10
      : undefined,
    schema: byteLength(JSON.stringify(json.schema)),
    catalog: json.reference
      ? byteLength(JSON.stringify(json.reference.fonts))
      : 0,
    document: seed
      ? byteLength(JSON.stringify(seed))
      : json.example
        ? byteLength(JSON.stringify(json.example))
        : 0,
    seed: seed ? byteLength(JSON.stringify(json.seed)) - fonts : 0,
    geometry: byteLength(
      blocks.find((block) => block.startsWith('[{"kind"')) ?? ''
    ),
    fonts,
    images: byteLength(images),
    example: json.example ? byteLength(JSON.stringify(json.example)) : 0,
  })
}

for (const kind of [
  'standard',
  'frame',
  'roles',
  'grid',
  'artwork',
  'fonts',
  'local',
])
  report(
    kind,
    await presentationInstructionsForTemplate(inputs[kind]),
    priorFixtures
      ? await baseline.presentationInstructionsForTemplate(priorFixtures[kind])
      : oldPresentation
  )
for (const kind of ['presentation', 'layout'])
  report(
    'new ' + kind,
    templateInstructions(kind),
    priorFixtures ? baseline.templateInstructions(kind) : oldTemplate
  )
console.table(reports)

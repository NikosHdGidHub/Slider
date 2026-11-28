import type { Cell, Insets } from './grid'
import { Num } from './Properties'
import { PropertySection } from './Workspace'

export function CellAppearance({ cell, change }: { cell: Cell; change: (patch: Partial<Cell>) => void }) {
  return <PropertySection id="object-editor-cell" title="Свойства ячейки" initial>
    <small>Ячейка {cell.row + 1} × {cell.col + 1}</small>
    <label>Фон ячейки<input type="color" value={cell.fill ?? '#ffffff'} onChange={(e) => change({ fill: e.target.value })} /></label>
    <button type="button" onClick={() => change({ fill: undefined })}>Убрать заливку</button>
    <label>Цвет рамки<input type="color" value={cell.border ?? '#333333'} onChange={(e) => change({ border: e.target.value })} /></label>
    <Num label="Толщина рамки" min={0} max={64} value={cell.width ?? 0} change={(width) => change({ width })} />
    <div className="field-pair">
      {['Сверху', 'Справа', 'Снизу', 'Слева'].map((label, index) => <Num key={label} label={'Отступ · ' + label} min={0} max={1279} value={cell.padding[index]} change={(value) => change({ padding: cell.padding.map((v, i) => i === index ? value : v) as Insets })} />)}
    </div>
  </PropertySection>
}

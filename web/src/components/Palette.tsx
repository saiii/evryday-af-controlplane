import type { DragEvent } from 'react'
import { CATALOGUE, COMPONENT_TYPES } from '../../../src/shared/catalogue'
import type { ComponentType } from '../../../src/shared/catalogue'

// The dataTransfer type a palette drag is carried under. The value is the kebab id.
export const PALETTE_DRAG_TYPE = 'application/x-af-component-type'

export default function Palette() {
    const startDrag = (event: DragEvent<HTMLLIElement>, type: ComponentType) => {
        event.dataTransfer.setData(PALETTE_DRAG_TYPE, type)
        event.dataTransfer.effectAllowed = 'move'
    }

    return (
        <ul className="palette">
            {COMPONENT_TYPES.map((type) => (
                <li
                    key={type}
                    className="palette-entry"
                    draggable
                    onDragStart={(event) => startDrag(event, type)}
                    style={{ borderLeftColor: CATALOGUE[type].colour }}
                >
                    {CATALOGUE[type].label}
                </li>
            ))}
        </ul>
    )
}

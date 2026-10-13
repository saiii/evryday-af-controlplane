import type { NodeProps } from '@xyflow/react'
import { CATALOGUE } from '../../../src/shared/catalogue'
import type { ComponentFlowNode } from '../af-mapping'

export default function ComponentNode({ data, selected }: NodeProps<ComponentFlowNode>) {
    const entry = CATALOGUE[data.componentType]

    return (
        <div
            className={selected ? 'component-node component-node-selected' : 'component-node'}
            style={{ borderLeftColor: entry.colour }}
        >
            <div className="component-node-label">{entry.label}</div>
            <div className="component-node-name" title={data.name}>
                {data.name}
            </div>
        </div>
    )
}

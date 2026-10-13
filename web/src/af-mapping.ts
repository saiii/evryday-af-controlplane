// The mapping between the plain document model and the canvas library's nodes.
// This is the only file that knows both shapes. The library is imported for
// its types only, so nothing here needs it at run time.

import type { Node } from '@xyflow/react'
import { SCHEMA_VERSION } from '../../src/shared/af-document'
import type { AfDocument, AfPosition } from '../../src/shared/af-document'
import type { ComponentType } from '../../src/shared/catalogue'

// componentType is the kebab id, never the label.
export type ComponentNodeData = { name: string; componentType: ComponentType }

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>

let nextId: number = 1

// The internal id of a component on the canvas. It is never shown and never
// written to a document; the name is a field, so a rename leaves the id alone.
export function newNodeId(): string {
    const id: string = `c${nextId}`
    nextId += 1
    return id
}

// The caller passes the id, so that ids are not created inside a state updater.
export function componentNode(
    id: string,
    componentType: ComponentType,
    name: string,
    position: AfPosition
): ComponentFlowNode {
    return {
        id,
        type: 'component',
        position: { x: position.x, y: position.y },
        data: { name, componentType }
    }
}

// Only the name, the type and the position are copied. Lines arrive in Phase 4.
export function documentFromNodes(nodes: readonly ComponentFlowNode[]): AfDocument {
    const doc: AfDocument = {
        schemaVersion: SCHEMA_VERSION,
        components: {},
        connections: [],
        layout: {}
    }
    for (const node of nodes) {
        doc.components[node.data.name] = { type: node.data.componentType }
        doc.layout[node.data.name] = {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y)
        }
    }
    return doc
}

export function nodesFromDocument(doc: AfDocument): ComponentFlowNode[] {
    return Object.keys(doc.components).map((name) => {
        const position: AfPosition = doc.layout[name] ?? { x: 0, y: 0 }
        return componentNode(newNodeId(), doc.components[name].type, name, position)
    })
}

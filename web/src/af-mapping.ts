// The mapping between the plain document model and the canvas library's nodes
// and lines. This is the only file that knows both shapes. The library is
// imported for its types only, so nothing here needs it at run time.

import type { Edge, Node } from '@xyflow/react'
import { SCHEMA_VERSION } from '../../src/shared/af-document'
import type { AfConnection, AfDocument, AfPosition } from '../../src/shared/af-document'
import type { ComponentType } from '../../src/shared/catalogue'

// componentType is the kebab id, never the label.
export type ComponentNodeData = { name: string; componentType: ComponentType }

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>

// A line on the canvas. It carries no data of its own.
export type LineFlowEdge = Edge<Record<string, never>, 'line'>

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

// One line per ordered pair, so the pair is the id. source and target are
// internal component ids, never names; the handles are the sides of the two
// components the line is attached to.
export function lineEdge(source: string, sourceHandle: string, target: string, targetHandle: string): LineFlowEdge {
    return { id: `${source}>${target}`, type: 'line', source, sourceHandle, target, targetHandle }
}

// The lines as the document holds them: by the current name of each end, in
// the order of the edges. An edge whose source or target is not among the
// components is left out. The sides are not part of a connection.
export function connectionsFromEdges(
    nodes: readonly ComponentFlowNode[],
    edges: readonly LineFlowEdge[]
): AfConnection[] {
    const names: Map<string, string> = new Map(nodes.map((n) => [n.id, n.data.name]))
    const connections: AfConnection[] = []
    for (const edge of edges) {
        const from: string | undefined = names.get(edge.source)
        const to: string | undefined = names.get(edge.target)
        if (from !== undefined && to !== undefined) {
            connections.push({ from, to })
        }
    }
    return connections
}

// The name, the type, the position and the lines are copied. No internal id
// and no handle side goes into the document.
export function documentFromNodes(
    nodes: readonly ComponentFlowNode[],
    edges: readonly LineFlowEdge[]
): AfDocument {
    const doc: AfDocument = {
        schemaVersion: SCHEMA_VERSION,
        components: {},
        connections: connectionsFromEdges(nodes, edges),
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

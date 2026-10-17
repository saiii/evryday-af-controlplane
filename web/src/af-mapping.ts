// The mapping between the plain document model and the canvas library's nodes
// and lines. This is the only file that knows both shapes. The library is
// imported for its types only, so nothing here needs it at run time.

import type { Edge, Node } from '@xyflow/react'
import { SCHEMA_VERSION } from '../../src/shared/af-document'
import type { AfComponent, AfConnection, AfDocument, AfPosition } from '../../src/shared/af-document'
import type { ComponentType } from '../../src/shared/catalogue'
import { facingSides } from '../../src/shared/line-path'

// The size of a component, matching .component-node in styles.css.
export const NODE_WIDTH = 180
export const NODE_HEIGHT = 60

// componentType is the kebab id, never the label. image and tag are the only
// structured settings of a component (D-05); a new component has neither, so
// no registry or default image is ever made up here (D-06).
export type ComponentNodeData = { name: string; componentType: ComponentType; image?: string; tag?: string }

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
// image and tag are copied only when they are non-empty text.
export function componentNode(
    id: string,
    componentType: ComponentType,
    name: string,
    position: AfPosition,
    settings?: { image?: string; tag?: string }
): ComponentFlowNode {
    const data: ComponentNodeData = { name, componentType }
    if (typeof settings?.image === 'string' && settings.image !== '') {
        data.image = settings.image
    }
    if (typeof settings?.tag === 'string' && settings.tag !== '') {
        data.tag = settings.tag
    }
    return {
        id,
        type: 'component',
        position: { x: position.x, y: position.y },
        data
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

// The name, the type, the image and tag when set, the position and the lines
// are copied. An empty image or tag is left out (D-19). No internal id and no
// handle side goes into the document.
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
        const component: AfComponent = { type: node.data.componentType }
        if (typeof node.data.image === 'string' && node.data.image !== '') {
            component.image = node.data.image
        }
        if (typeof node.data.tag === 'string' && node.data.tag !== '') {
            component.tag = node.data.tag
        }
        doc.components[node.data.name] = component
        doc.layout[node.data.name] = {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y)
        }
    }
    return doc
}

// Only given a document the server has checked with checkDocument, so every
// component has its own layout entry and no position is made up. Each name gets
// a fresh internal id; idByName lets the lines find their ends.
export function nodesFromDocument(doc: AfDocument): { nodes: ComponentFlowNode[]; idByName: Map<string, string> } {
    const idByName: Map<string, string> = new Map()
    const nodes: ComponentFlowNode[] = Object.keys(doc.components).map((name) => {
        const id: string = newNodeId()
        idByName.set(name, id)
        const component: AfComponent = doc.components[name]
        return componentNode(id, component.type, name, doc.layout[name], {
            image: component.image,
            tag: component.tag
        })
    })
    return { nodes, idByName }
}

// One line per connection, attached to the sides of its two components that
// face each other (D-08, D-09). The sides are picked once, here, at open;
// afterwards an opened line is like a drawn one and keeps its sides when
// components move (D-10). The file never stores sides. A connection whose end
// is not in idByName is left out.
export function edgesFromDocument(doc: AfDocument, idByName: ReadonlyMap<string, string>): LineFlowEdge[] {
    const edges: LineFlowEdge[] = []
    for (const connection of doc.connections) {
        const sourceId: string | undefined = idByName.get(connection.from)
        const targetId: string | undefined = idByName.get(connection.to)
        if (sourceId === undefined || targetId === undefined) {
            continue
        }
        const sides = facingSides(doc.layout[connection.from], doc.layout[connection.to], {
            width: NODE_WIDTH,
            height: NODE_HEIGHT
        })
        edges.push(lineEdge(sourceId, sides.source, targetId, sides.target))
    }
    return edges
}

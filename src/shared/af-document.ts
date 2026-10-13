// The plain model of a designed system, and the rules for names and positions.
// Shared by the server build and the page bundle, so the only import is the
// type table next to this file. Nothing here knows about the canvas library.

import { canSend } from './catalogue'
import type { ComponentType } from './catalogue'

export const SCHEMA_VERSION = 1

export const GRID_SIZE = 20

export const NAME_PATTERN: RegExp = /^[a-z][a-z0-9-]{0,62}$/

export interface AfPosition {
    x: number
    y: number
}

export interface AfComponent {
    type: ComponentType
}

export interface AfConnection {
    from: string
    to: string
}

// Components and layout are keyed by component name. The name is the identity.
export interface AfDocument {
    schemaVersion: 1
    components: Record<string, AfComponent>
    connections: AfConnection[]
    layout: Record<string, AfPosition>
}

export type NameProblem = 'invalid' | 'taken'

// The name is judged exactly as given: it is not changed in any way first.
// otherNames holds the names of the other components, so the caller leaves
// the component's own current name out of it.
export function nameProblem(name: string, otherNames: readonly string[]): NameProblem | null {
    if (!NAME_PATTERN.test(name)) {
        return 'invalid'
    }
    if (otherNames.includes(name)) {
        return 'taken'
    }
    return null
}

// <type>-<n> with the lowest n from 1 that is not in use now. It scans the
// names passed in and keeps no counter, so a number that was freed is used again.
export function nextDefaultName(type: ComponentType, namesInUse: readonly string[]): string {
    const used: Set<string> = new Set(namesInUse)
    let n: number = 1
    while (used.has(`${type}-${n}`)) {
        n += 1
    }
    return `${type}-${n}`
}

// Rounds each coordinate to the nearest grid step. Adding 0 turns -0 into 0.
export function snapPosition(position: AfPosition): AfPosition {
    return {
        x: Math.round(position.x / GRID_SIZE) * GRID_SIZE + 0,
        y: Math.round(position.y / GRID_SIZE) * GRID_SIZE + 0
    }
}

export interface LineEnd {
    name: string
    type: ComponentType
}

export type LineProblem = 'rule' | 'duplicate'

// Judges a line from one component to another against the rule table and the
// lines that already exist. The rule is checked first, so a line the rules
// forbid always gets the rule verdict, even when the same line is already there.
export function lineProblem(from: LineEnd, to: LineEnd, connections: readonly AfConnection[]): LineProblem | null {
    if (!canSend(from.type, to.type)) {
        return 'rule'
    }
    if (connections.some((c) => c.from === from.name && c.to === to.name)) {
        return 'duplicate'
    }
    return null
}

// Checks a value that came from a file or a request and turns it into a
// document the designer itself could have made. Shared by the server build and
// the page bundle, so the only imports are the files next to this one.
// Nothing here knows about YAML, HTTP or the canvas library.

import { byCodeUnit, NAME_PATTERN, SCHEMA_VERSION } from './af-document'
import type { AfComponent, AfConnection, AfDocument, AfPosition } from './af-document'
import { isComponentType } from './catalogue'
import type { ComponentType } from './catalogue'
import { imageProblem, tagProblem } from './component-settings'

// The rule for a file name, as it reads after "Cannot save <name>: ". It
// starts in lower case and has no full stop, so the caller adds one.
export const FILE_NAME_RULE: string =
    'a file name uses lowercase letters, digits and hyphens, starts with a letter, and has 63 characters at most'

const SHOWN_LENGTH: number = 40

const TOP_LEVEL_KEYS: readonly string[] = ['schemaVersion', 'components', 'connections', 'layout']

// The component keys each schemaVersion allows. The next version adds a row.
const COMPONENT_KEYS: ReadonlyMap<number, readonly string[]> = new Map<number, readonly string[]>([
    [1, ['type']],
    [2, ['type', 'image', 'tag']]
])

// The keys a later version added, named in the problem for an older file.
const V2_ONLY_KEYS: readonly string[] = ['image', 'tag']

// A name or key that has not passed NAME_PATTERN, as it is shown in a problem
// sentence: unchanged up to 40 characters, otherwise the first 40 and an ellipsis.
export function shownName(text: string): string {
    if (text.length <= SHOWN_LENGTH) {
        return text
    }
    return `${text.slice(0, SHOWN_LENGTH)}…`
}

// upgradedFrom is set when the input was an older version. The document is
// always the current version; opening never rewrites the file, only Save does.
export type CheckResult = { doc: AfDocument; upgradedFrom?: 1 } | { problem: string }

// A plain mapping: an object that is not a list and whose prototype is
// Object.prototype or null, so a byte array, a date or a Map is refused.
export function isMapping(v: unknown): v is Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false
    }
    const proto: unknown = Object.getPrototypeOf(v)
    return proto === Object.prototype || proto === null
}

function sortedKeys(v: Record<string, unknown>): string[] {
    return Object.keys(v).sort(byCodeUnit)
}

// True when the mapping has exactly the given own keys and no others.
function hasExactly(v: Record<string, unknown>, keys: readonly string[]): boolean {
    const own: string[] = sortedKeys(v)
    const wanted: string[] = [...keys].sort(byCodeUnit)
    return own.length === wanted.length && own.every((key, i) => key === wanted[i])
}

function isWholeNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isSafeInteger(n)
}

// Any value as text for a problem sentence. String() can fail on an object
// with no prototype, so that case falls back to a fixed word.
function asText(v: unknown): string {
    if (typeof v === 'string') {
        return v
    }
    try {
        return String(v)
    } catch {
        return 'object'
    }
}

// Checks the value against every rule a saved file must keep and returns a
// fresh document built only from checked fields, or the first problem found as
// one lower-case sentence. Keys are checked in code-unit order, so the problem
// reported does not depend on the order of keys in the file. The type rules
// for lines are not checked here. versions lists the schemaVersion values
// accepted: opening takes 1 or 2, a save takes only 2.
export function checkDocument(value: unknown, versions: readonly number[] = [1, 2]): CheckResult {
    if (value === null || value === undefined) {
        return { problem: 'it is empty' }
    }
    if (!isMapping(value)) {
        return { problem: 'it is not a mapping at the top level' }
    }
    for (const key of sortedKeys(value)) {
        if (!TOP_LEVEL_KEYS.includes(key)) {
            return { problem: `the key "${shownName(key)}" is not allowed at the top level` }
        }
    }
    const version: unknown = Object.hasOwn(value, 'schemaVersion') ? value.schemaVersion : undefined
    const allowedKeys: readonly string[] | undefined =
        typeof version === 'number' && versions.includes(version) ? COMPONENT_KEYS.get(version) : undefined
    if (allowedKeys === undefined) {
        const onlyCurrent: boolean = versions.length === 1 && versions[0] === SCHEMA_VERSION
        return { problem: onlyCurrent ? `schemaVersion must be ${SCHEMA_VERSION}` : 'schemaVersion must be 1 or 2' }
    }
    const components: unknown = Object.hasOwn(value, 'components') ? value.components : undefined
    if (!isMapping(components)) {
        return { problem: 'components must be a mapping from name to component' }
    }
    const connections: unknown = Object.hasOwn(value, 'connections') ? value.connections : undefined
    if (!Array.isArray(connections)) {
        return { problem: 'connections must be a list' }
    }
    const layout: unknown = Object.hasOwn(value, 'layout') ? value.layout : undefined
    if (!isMapping(layout)) {
        return { problem: 'layout must be a mapping from name to position' }
    }

    const names: string[] = sortedKeys(components)
    for (const name of names) {
        if (!NAME_PATTERN.test(name)) {
            return { problem: `the component name "${shownName(name)}" is not allowed` }
        }
        const entry: unknown = components[name]
        if (!isMapping(entry)) {
            return { problem: `component ${name} must be a mapping with a type` }
        }
        for (const key of sortedKeys(entry)) {
            if (!allowedKeys.includes(key)) {
                const needs: string = version === 1 && V2_ONLY_KEYS.includes(key) ? ' (it needs schemaVersion 2)' : ''
                return { problem: `component ${name} has the key "${shownName(key)}", which is not allowed${needs}` }
            }
        }
        if (!Object.hasOwn(entry, 'type')) {
            return { problem: `component ${name} has no type` }
        }
        if (!isComponentType(entry.type)) {
            return { problem: `component ${name} has the unknown type "${shownName(asText(entry.type))}"` }
        }
        // Only a version 2 entry can get this far with an image or a tag.
        if (Object.hasOwn(entry, 'image')) {
            const p: string | null = imageProblem(entry.image)
            if (p !== null) {
                return { problem: `the image of ${name} ${p}` }
            }
        }
        if (Object.hasOwn(entry, 'tag')) {
            const p: string | null = tagProblem(entry.tag)
            if (p !== null) {
                return { problem: `the tag of ${name} ${p}` }
            }
        }
    }
    for (const name of names) {
        if (!Object.hasOwn(layout, name)) {
            return { problem: `component ${name} has no position in layout` }
        }
    }
    for (const key of sortedKeys(layout)) {
        if (!Object.hasOwn(components, key)) {
            return { problem: `layout has a position for ${shownName(key)}, which is not a component` }
        }
    }
    for (const name of names) {
        const position: unknown = layout[name]
        if (!isMapping(position) || !hasExactly(position, ['x', 'y']) || !isWholeNumber(position.x) || !isWholeNumber(position.y)) {
            return { problem: `the position of ${name} is not two whole numbers x and y` }
        }
    }

    const lines: AfConnection[] = []
    const seen: Set<string> = new Set()
    for (let i = 0; i < connections.length; i += 1) {
        const line: unknown = connections[i]
        if (!isMapping(line) || !hasExactly(line, ['from', 'to']) || typeof line.from !== 'string' || typeof line.to !== 'string') {
            return { problem: `line ${i + 1} is not a pair of from and to names` }
        }
        const from: string = line.from
        const to: string = line.to
        const shown: string = `line ${shownName(from)} → ${shownName(to)}`
        if (!Object.hasOwn(components, from) || !Object.hasOwn(components, to)) {
            return { problem: `${shown} names a component that does not exist` }
        }
        if (from === to) {
            return { problem: `${shown} goes from a component to itself` }
        }
        const pairKey: string = `${from}\u0000${to}`
        if (seen.has(pairKey)) {
            return { problem: `${shown} appears twice` }
        }
        seen.add(pairKey)
        lines.push({ from, to })
    }

    // Every name has passed NAME_PATTERN, so none of them is __proto__ and
    // assigning into a fresh {} makes each one an own key. Every type has
    // already passed isComponentType in the first loop over the names, and every
    // image and tag present has passed its rule. The keys go in the order type,
    // image, tag, and a missing image or tag stays missing.
    const freshComponents: AfDocument['components'] = {}
    const freshLayout: Record<string, AfPosition> = {}
    for (const name of names) {
        const entry: Record<string, unknown> = components[name] as Record<string, unknown>
        const position: Record<string, unknown> = layout[name] as Record<string, unknown>
        const component: AfComponent = { type: entry.type as ComponentType }
        if (Object.hasOwn(entry, 'image')) {
            component.image = entry.image as string
        }
        if (Object.hasOwn(entry, 'tag')) {
            component.tag = entry.tag as string
        }
        freshComponents[name] = component
        // Adding 0 turns -0 into 0.
        freshLayout[name] = { x: (position.x as number) + 0, y: (position.y as number) + 0 }
    }
    const doc: AfDocument = {
        schemaVersion: SCHEMA_VERSION,
        components: freshComponents,
        connections: lines,
        layout: freshLayout
    }
    return version === 1 ? { doc, upgradedFrom: 1 } : { doc }
}

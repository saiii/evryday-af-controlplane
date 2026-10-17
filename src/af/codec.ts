// Turns a checked document into the standard .af text, and .af text into a
// plain value for the validator. This is the only file that imports yaml; the
// server owns YAML and the page bundle never imports this file.

import { Document, isMap, isPair, isScalar, parseDocument } from 'yaml'
import type { YAMLError } from 'yaml'
import { byCodeUnit, SCHEMA_VERSION } from '../shared/af-document'
import type { AfDocument } from '../shared/af-document'

// The standard form: keys in the order schemaVersion, components, connections,
// layout; names sorted in code-unit order; lines sorted by from, then to; each
// position inline; each component's keys in the order type, image, tag, with a
// missing image or tag left out, and the tag always double-quoted. Only called with a document that passed checkDocument.
// Every option is stated so the bytes do not move with a library default.
export function toYaml(doc: AfDocument): string {
    const names: string[] = Object.keys(doc.components).sort(byCodeUnit)
    const components: Record<string, { type: string; image?: string; tag?: string }> = {}
    const layout: Record<string, { x: number; y: number }> = {}
    for (const name of names) {
        const c: AfDocument['components'][string] = doc.components[name]
        const entry: { type: string; image?: string; tag?: string } = { type: c.type }
        if (c.image !== undefined) {
            entry.image = c.image
        }
        if (c.tag !== undefined) {
            entry.tag = c.tag
        }
        components[name] = entry
        // Adding 0 turns -0 into 0.
        layout[name] = { x: doc.layout[name].x + 0, y: doc.layout[name].y + 0 }
    }
    const connections: { from: string; to: string }[] = doc.connections
        .map((c) => ({ from: c.from, to: c.to }))
        .sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to))
    const yamlDoc: Document = new Document(
        { schemaVersion: SCHEMA_VERSION, components, connections, layout },
        { version: '1.2', aliasDuplicateObjects: false }
    )
    const layoutNode: unknown = yamlDoc.get('layout', true)
    if (isMap(layoutNode)) {
        for (const pair of layoutNode.items) {
            if (isPair(pair) && isMap(pair.value)) {
                // agent-1: { x: 400, y: 120 }
                pair.value.flow = true
            }
        }
    }
    const componentsNode: unknown = yamlDoc.get('components', true)
    if (isMap(componentsNode)) {
        for (const pair of componentsNode.items) {
            if (isPair(pair) && isMap(pair.value)) {
                // A tag such as 1.0 or yes must stay text for every YAML
                // reader, including YAML 1.1 tools (research Pitfall 3).
                const tag: unknown = pair.value.get('tag', true)
                if (isScalar(tag)) {
                    tag.type = 'QUOTE_DOUBLE'
                }
            }
        }
    }
    return yamlDoc.toString({ lineWidth: 0, indent: 2, indentSeq: true, flowCollectionPadding: true })
}

export type Parsed = { ok: true; value: unknown } | { ok: false; problem: string }

// Reads .af text into a plain value and never throws. Errors and warnings
// both refuse the text, so an unknown tag is refused rather than read as a
// string. The problem gives the one-based line and column when known.
export function parseYaml(text: string): Parsed {
    const doc: Document.Parsed = parseDocument(text, {
        version: '1.2',
        schema: 'core',
        uniqueKeys: true,
        prettyErrors: true,
        // Not 'silent': with 'silent' yaml drops its MULTIPLE_DOCS error, so a
        // file with several documents would open as its first one. Nothing
        // here logs at 'error'; only YAML.parse writes warnings to the console.
        logLevel: 'error'
    })
    const first: YAMLError | undefined = doc.errors[0] ?? doc.warnings[0]
    if (first !== undefined) {
        const at: { line: number; col: number } | undefined = first.linePos?.[0]
        if (at === undefined) {
            return { ok: false, problem: 'it is not valid YAML' }
        }
        return { ok: false, problem: `it is not valid YAML (line ${at.line}, column ${at.col})` }
    }
    // yaml throws from toJS when aliases expand past MAX_ALIAS_COUNT (a guard
    // against resource exhaustion). Every throw becomes a refusal so this
    // function keeps its promise and the open answers with a plain sentence.
    // Only the alias-limit error is called too many aliases, and only an alias
    // with no anchor before it is called that. Anything else is logged,
    // because it points at a bug rather than at the file.
    let value: unknown
    try {
        value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
    } catch (error) {
        if (isYamlReferenceError(error, /^Excessive alias count/)) {
            return { ok: false, problem: 'it uses too many YAML aliases' }
        }
        if (isYamlReferenceError(error, /^Unresolved alias/)) {
            return { ok: false, problem: 'it uses a YAML alias whose anchor is not set before it' }
        }
        console.error('Cannot turn the parsed YAML into a value:', error)
        return { ok: false, problem: 'it cannot be read as YAML' }
    }
    return { ok: true, value }
}

// How far aliases may expand, counted as yaml counts them. 500 lets 499
// aliases of one shared anchor open (100 let only 99), and still refuses a
// four-level alias bomb: ten aliases of ten aliases of ten aliases of a
// ten-item list. The file size limit caps everything else.
const MAX_ALIAS_COUNT: number = 500

// True for a ReferenceError from yaml whose message matches. yaml 2.x throws
// ReferenceError "Excessive alias count indicates a resource exhaustion
// attack" past maxAliasCount, and "Unresolved alias (...)" for an alias whose
// anchor comes later or not at all.
function isYamlReferenceError(error: unknown, message: RegExp): boolean {
    return error instanceof ReferenceError && message.test(error.message)
}

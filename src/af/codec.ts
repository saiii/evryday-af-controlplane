// Turns a checked document into the standard .af text, and .af text into a
// plain value for the validator. This is the only file that imports yaml; the
// server owns YAML and the page bundle never imports this file.

import { Document, isMap, isPair, parseDocument } from 'yaml'
import type { YAMLError } from 'yaml'
import { byCodeUnit } from '../shared/af-document'
import type { AfDocument } from '../shared/af-document'

// The standard form: keys in the order schemaVersion, components, connections,
// layout; names sorted in code-unit order; lines sorted by from, then to; each
// position inline. Only called with a document that passed checkDocument.
// Every option is stated so the bytes do not move with a library default.
export function toYaml(doc: AfDocument): string {
    const names: string[] = Object.keys(doc.components).sort(byCodeUnit)
    const components: Record<string, { type: string }> = {}
    const layout: Record<string, { x: number; y: number }> = {}
    for (const name of names) {
        components[name] = { type: doc.components[name].type }
        // Adding 0 turns -0 into 0.
        layout[name] = { x: doc.layout[name].x + 0, y: doc.layout[name].y + 0 }
    }
    const connections: { from: string; to: string }[] = doc.connections
        .map((c) => ({ from: c.from, to: c.to }))
        .sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to))
    const yamlDoc: Document = new Document(
        { schemaVersion: 1, components, connections, layout },
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
    // yaml throws from toJS when aliases expand past maxAliasCount (a guard
    // against resource exhaustion). The throw becomes a refusal so this
    // function keeps its promise and the open answers with a plain sentence.
    let value: unknown
    try {
        value = doc.toJS({ maxAliasCount: 100 })
    } catch {
        return { ok: false, problem: 'it uses too many YAML aliases' }
    }
    return { ok: true, value }
}

// Reads the Agent Skills frontmatter of a component's SKILL.md on the server:
// the description is the brief, and the checks give the save its red and amber
// notes. The page never imports this file and never parses YAML; YAML goes
// through parseYaml in codec.ts, which stays the only importer of yaml. The
// controlplane reads nothing else from the body, such as secret names (D-16).

import { isMapping, shownName } from '../shared/af-validate'
import { MAX_FILE_BYTES, MAX_FILE_SIZE_TEXT, SKILL_FILE } from '../shared/component-settings'
import { parseYaml } from './codec'
import type { Parsed } from './codec'

// The Agent Skills spec limit for description.
const MAX_DESCRIPTION_LENGTH: number = 1024

const BOM: string = '﻿'

// Frontmatter exists only when the first line is exactly --- (a trailing \r is
// allowed); it ends at the next line that is exactly ---. A leading BOM is
// dropped for parsing only.
export function splitFrontmatter(text: string): { yaml: string; body: string } | 'none' | 'unclosed' {
    const t: string = text.startsWith(BOM) ? text.slice(1) : text
    const lines: string[] = t.split('\n')
    if (lines[0].replace(/\r$/, '') !== '---') {
        return 'none'
    }
    for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].replace(/\r$/, '') === '---') {
            // CRLF line ends become LF in the YAML block only: yaml refuses a
            // lone \r at the end of the block. The body keeps its bytes.
            const yaml: string = lines.slice(1, i).map((line: string) => line.replace(/\r$/, '')).join('\n')
            return { yaml, body: lines.slice(i + 1).join('\n') }
        }
    }
    return 'unclosed'
}

// description is the brief, or null when there is none to show. warnings are
// amber notes that never block a save; problem refuses the save.
export type SkillCheck = { description: string | null; warnings: string[]; problem: string | null }

// Any frontmatter value as it is shown in a warning.
function shownValue(v: unknown): string {
    if (typeof v === 'string') {
        return JSON.stringify(shownName(v))
    }
    try {
        return shownName(String(v))
    } catch {
        return 'object'
    }
}

// Checks a SKILL.md text for the component of that name. Never throws.
export function checkSkill(text: string, component: string): SkillCheck {
    const file: string = `${component}/${SKILL_FILE}`
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
        return { description: null, warnings: [], problem: `${file} is larger than ${MAX_FILE_SIZE_TEXT}` }
    }
    const warnings: string[] = []
    if (component.includes('--') || component.endsWith('-')) {
        warnings.push(`the name ${component} does not fit the Agent Skills name rule (no -- and no - at the end)`)
    }
    const split: ReturnType<typeof splitFrontmatter> = splitFrontmatter(text)
    if (split === 'unclosed') {
        return { description: null, warnings: [], problem: `the frontmatter of ${file} has no closing ---` }
    }
    if (split === 'none') {
        warnings.unshift(`${file} has no frontmatter with a name and a description`)
        return { description: null, warnings, problem: null }
    }
    const parsed: Parsed = parseYaml(split.yaml)
    if (!parsed.ok) {
        // Line numbers count from the opening --- line, as the user sees the file.
        const rest: string = parsed.problem
            .replace(/^it /, '')
            .replace(/\(line (\d+)/, (_match: string, line: string) => `(line ${Number(line) + 1}`)
        return { description: null, warnings: [], problem: `the frontmatter of ${file} ${rest}` }
    }
    const value: unknown = parsed.value === null ? {} : parsed.value
    if (!isMapping(value)) {
        return { description: null, warnings: [], problem: `the frontmatter of ${file} is not a mapping` }
    }

    const front: string[] = []
    let description: string | null = null
    if (!Object.hasOwn(value, 'description') || typeof value.description !== 'string' || value.description === '') {
        front.push(`${file} has no description`)
        if (Object.hasOwn(value, 'description') && typeof value.description === 'string') {
            description = value.description
        }
    } else {
        description = value.description
        if (value.description.length > MAX_DESCRIPTION_LENGTH) {
            front.push(`the description in ${file} is longer than ${MAX_DESCRIPTION_LENGTH} characters`)
        }
    }
    if (!Object.hasOwn(value, 'name')) {
        front.push(`${file} has no name`)
    } else if (value.name !== component) {
        front.push(`the name in ${file} is ${shownValue(value.name)}, not ${component}`)
    }
    return { description, warnings: [...front, ...warnings], problem: null }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// After a rename, changes the frontmatter line name: <from> (optionally in
// matching quotes) to name: <to>. Only that one line changes; every other byte
// stays, so the user's YAML is never rewritten. Any other form is left as is.
export function syncNameLine(text: string, from: string, to: string): { text: string; changed: boolean } {
    const lines: string[] = text.split('\n')
    const first: string = lines[0].startsWith(BOM) ? lines[0].slice(1) : lines[0]
    if (first.replace(/\r$/, '') !== '---') {
        return { text, changed: false }
    }
    const f: string = escapeRegExp(from)
    const pattern: RegExp = new RegExp(`^name: *(?:${f}|"${f}"|'${f}') *(\\r?)$`)
    for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].replace(/\r$/, '') === '---') {
            break
        }
        const match: RegExpExecArray | null = pattern.exec(lines[i])
        if (match !== null) {
            lines[i] = `name: ${to}${match[1]}`
            return { text: lines.join('\n'), changed: true }
        }
    }
    return { text, changed: false }
}

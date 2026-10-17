// The component folders <design>.components/<component>/ next to each .af
// (D-11): guarded reads, the check of a save request and the save
// transaction. The .af holds no path to them; the place is fixed. It knows
// nothing about HTTP, and it runs no git and no other process (D-17).
//
// Only the <design>.components folder itself may be a link or a mount. It is
// resolved once and never renamed or removed. Below it no link is followed:
// a listing skips links, and a component folder that is a link, or a write
// through a link, is refused.

import type { Dirent, Stats } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { byCodeUnit, NAME_PATTERN } from '../shared/af-document'
import {
    filePathProblem,
    MAX_FILE_BYTES,
    MAX_FOLDER_BYTES,
    MAX_FOLDER_FILES,
    MAX_PATH_PARTS,
    SKILL_FILE
} from '../shared/component-settings'
import { checkSkill } from './skill'
import { FileTooLargeError, readBytes } from './store'

// A refusal that depends on what is on disk. problem is a lower-case fragment
// with no full stop; the route says `Cannot save ${name}.af: ${problem}.`
export class SaveRefusedError extends Error {
    problem: string
    constructor(problem: string) {
        super(problem)
        this.name = 'SaveRefusedError'
        this.problem = problem
    }
}

// A save that failed after it began to change files. sentence is a whole
// sentence for the 500 answer and names no full server path.
export class SaveFailedError extends Error {
    sentence: string
    constructor(sentence: string) {
        super(sentence)
        this.name = 'SaveFailedError'
        this.sentence = sentence
    }
}

// The folder a save leaves its undo journal in: .af-save-<uuid>. The leading
// dot means it never passes NAME_PATTERN, so it is never taken for a component.
export const UNDO_PATTERN: RegExp = /^\.af-save-[0-9a-f-]{36}$/

const COMPONENTS_SUFFIX: string = '.components'

// The full path of <design>.components in the data directory. Throws for a
// design that is not a plain name (guard 1), and for a path that would land
// outside the directory (guard 2), as fileFor does for the .af.
export function componentsDir(dataDir: string, design: string): string {
    if (!NAME_PATTERN.test(design)) {
        throw new Error(`not a plain design name: ${JSON.stringify(design)}`)
    }
    const full: string = path.resolve(dataDir, `${design}${COMPONENTS_SUFFIX}`)
    if (path.dirname(full) !== path.resolve(dataDir)) {
        throw new Error(`${full} is outside ${path.resolve(dataDir)}`)
    }
    return full
}

function errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException).code
}

// A file listed in a component folder: path is relative with / between parts,
// full is the server path and never leaves this module.
type ListedFile = { path: string; size: number; full: string }

// Lists a component folder. A name starting with '.' (such as .git or
// .DS_Store), a link, a folder too deep to hold an allowed path, and a file
// whose path breaks the path rule are skipped and counted, never followed.
async function walkFolder(dir: string): Promise<{ files: ListedFile[]; skipped: number }> {
    const files: ListedFile[] = []
    let skipped: number = 0
    async function visit(abs: string, parts: string[]): Promise<void> {
        const entries: Dirent[] = await readdir(abs, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
                skipped += 1
                continue
            }
            const here: string[] = [...parts, entry.name]
            const full: string = path.join(abs, entry.name)
            if (entry.isDirectory()) {
                if (here.length >= MAX_PATH_PARTS) {
                    skipped += 1
                    continue
                }
                await visit(full, here)
                continue
            }
            const rel: string = here.join('/')
            if (!entry.isFile() || filePathProblem(rel) !== null) {
                skipped += 1
                continue
            }
            const info: Stats = await lstat(full)
            if (!info.isFile()) {
                skipped += 1
                continue
            }
            files.push({ path: rel, size: info.size, full })
        }
    }
    await visit(dir, [])
    files.sort((a: ListedFile, b: ListedFile) => byCodeUnit(a.path, b.path))
    return { files, skipped }
}

// The folder of a component in an already resolved .components folder, or
// null when there is none. A link or something that is not a folder is refused.
async function resolveComponent(rootReal: string, component: string): Promise<string | null> {
    const dir: string = path.join(rootReal, component)
    let info: Stats
    try {
        info = await lstat(dir)
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            return null
        }
        throw error
    }
    if (info.isSymbolicLink()) {
        throw new SaveRefusedError(
            `the folder of ${component} is a link; only the .components folder itself may be a link or a mount`
        )
    }
    if (!info.isDirectory()) {
        throw new SaveRefusedError(`${component} in the .components folder is not a folder`)
    }
    return dir
}

// The server path of rel inside componentDir, checked part by part: no part
// that exists may be a link, and the result must stay inside the folder.
// shown names the component in a refusal.
async function guardedFile(componentDir: string, rel: string, shown: string): Promise<string> {
    if (filePathProblem(rel) !== null) {
        throw new SaveRefusedError(`the path ${JSON.stringify(rel)} of ${shown} is not allowed`)
    }
    let current: string = componentDir
    for (const part of rel.split('/')) {
        current = path.join(current, part)
        let info: Stats
        try {
            info = await lstat(current)
        } catch (error) {
            if (errorCode(error) === 'ENOENT') {
                break
            }
            throw error
        }
        if (info.isSymbolicLink()) {
            throw new SaveRefusedError(`${shown}/${rel} goes through a link`)
        }
    }
    const full: string = path.resolve(componentDir, rel)
    if (!full.startsWith(componentDir + path.sep)) {
        throw new SaveRefusedError(`${shown}/${rel} is outside the folder of ${shown}`)
    }
    return full
}

// True when the bytes are UTF-8 text with no NUL. A BOM is kept in the text.
function asText(bytes: Buffer): string | null {
    if (bytes.includes(0)) {
        return null
    }
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
        return null
    }
}

// text is null for a file that is not UTF-8 text.
export type FolderFile = { path: string; size: number; text: string | null }

export type FolderRead = {
    exists: boolean
    skill: { text: string; description: string | null; warnings: string[]; problem: string | null } | null
    files: FolderFile[]
    skipped: number
}

const NO_FOLDER: FolderRead = { exists: false, skill: null, files: [], skipped: 0 }

// Reads the folder of one component, read-only (opening never writes a
// starter). Files past the per-file, per-folder size and file-count limits
// are skipped and counted. Throws SaveRefusedError for a component folder
// that is a link. Never returns a full server path.
export async function readFolder(dataDir: string, design: string, component: string): Promise<FolderRead> {
    if (!NAME_PATTERN.test(component)) {
        throw new Error(`not a plain component name: ${JSON.stringify(component)}`)
    }
    const root: string = componentsDir(dataDir, design)
    let rootReal: string
    try {
        rootReal = await realpath(root)
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            return { ...NO_FOLDER, files: [] }
        }
        throw error
    }
    if (!(await stat(rootReal)).isDirectory()) {
        return { ...NO_FOLDER, files: [] }
    }
    const dir: string | null = await resolveComponent(rootReal, component)
    if (dir === null) {
        return { ...NO_FOLDER, files: [] }
    }
    const listed: { files: ListedFile[]; skipped: number } = await walkFolder(dir)
    let skipped: number = listed.skipped
    let total: number = 0
    let count: number = 0
    let skill: FolderRead['skill'] = null
    const files: FolderFile[] = []
    for (const file of listed.files) {
        if (count + 1 > MAX_FOLDER_FILES || total + file.size > MAX_FOLDER_BYTES) {
            skipped += 1
            continue
        }
        let bytes: Buffer | null
        try {
            bytes = await readBytes(file.full, MAX_FILE_BYTES)
        } catch (error) {
            if (error instanceof FileTooLargeError) {
                skipped += 1
                continue
            }
            throw error
        }
        if (bytes === null || total + bytes.length > MAX_FOLDER_BYTES) {
            skipped += 1
            continue
        }
        total += bytes.length
        count += 1
        const text: string | null = asText(bytes)
        if (file.path === SKILL_FILE) {
            skill =
                text === null
                    ? { text: '', description: null, warnings: [], problem: `${component}/${SKILL_FILE} is not UTF-8 text` }
                    : { text, ...checkSkill(text, component) }
            continue
        }
        files.push({ path: file.path, size: bytes.length, text })
    }
    return { exists: true, skill, files, skipped }
}

// The undo folders a save left behind when it was cut off, such as by a
// crash. They may hold the only copy of a removed component folder, so this
// only finds them; it deletes nothing.
export async function findLeftoverSaves(dataDir: string): Promise<string[]> {
    const found: string[] = []
    const entries: Dirent[] = await readdir(dataDir, { withFileTypes: true })
    const names: string[] = entries.map((entry: Dirent) => entry.name).sort(byCodeUnit)
    for (const name of names) {
        if (!name.endsWith(COMPONENTS_SUFFIX) || !NAME_PATTERN.test(name.slice(0, -COMPONENTS_SUFFIX.length))) {
            continue
        }
        const dir: string = path.join(path.resolve(dataDir), name)
        try {
            // stat follows a link, so a linked .components folder counts.
            if (!(await stat(dir)).isDirectory()) {
                continue
            }
            const inner: Dirent[] = await readdir(dir, { withFileTypes: true })
            for (const entry of inner) {
                if (UNDO_PATTERN.test(entry.name)) {
                    found.push(path.join(dir, entry.name))
                }
            }
        } catch (error) {
            console.warn(`Cannot look for left-over saves in ${dir}:`, error)
        }
    }
    return found.sort(byCodeUnit)
}

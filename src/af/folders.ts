// The component folders <design>.components/<component>/ next to each .af
// (D-11): guarded reads, the check of a save request and the save
// transaction. The .af holds no path to them; the place is fixed. It knows
// nothing about HTTP, and it runs no git and no other process (D-17).
//
// Only the <design>.components folder itself may be a link or a mount. It is
// resolved once and never renamed or removed. Below it no link is followed:
// a listing skips links, and a component folder that is a link, or a write
// through a link, is refused.

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { byCodeUnit, NAME_PATTERN } from '../shared/af-document'
import type { AfDocument } from '../shared/af-document'
import { checkDocument, isMapping, shownName } from '../shared/af-validate'
import type { CheckResult } from '../shared/af-validate'
import {
    filePathProblem,
    MAX_FILE_BYTES,
    MAX_FILE_SIZE_TEXT,
    MAX_FOLDER_BYTES,
    MAX_FOLDER_FILES,
    MAX_FOLDER_SIZE_TEXT,
    MAX_PATH_PARTS,
    pathsProblem,
    SKILL_FILE,
    starterSkill
} from '../shared/component-settings'
import { checkSkill, syncNameLine } from './skill'
import type { SkillCheck } from './skill'
import { FileTooLargeError, readBytes, syncFolder, writeAtomic, writeAtomicAt } from './store'

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

// What one component of a save request asks for. from is the folder the
// component's files come from (in the source design), or null for a new
// component. files maps a path to its new bytes, or to null to remove it.
export type SaveComponent = { from: string | null; files: Map<string, Buffer | null> }

// A checked save request. Every component of the document has an entry.
// Maps, never plain objects, hold anything keyed by request text.
export type SaveRequest = {
    name: string
    source: string
    doc: AfDocument
    components: Map<string, SaveComponent>
    warnings: string[]
}

export type SaveResult = { warnings: string[]; removed: string[]; renamed: { from: string; to: string }[] }

const ENVELOPE_KEYS: readonly string[] = ['document', 'source', 'components']
const COMPONENT_ENTRY_KEYS: readonly string[] = ['from', 'files']

// A key or path from the request as it is shown in a problem.
function shown(text: string): string {
    return `"${shownName(text)}"`
}

function ownKeys(v: Record<string, unknown>): string[] {
    return Object.keys(v).sort(byCodeUnit)
}

// Checks the whole save request without touching the disk, and builds the
// request the transaction runs. The first problem found wins; each is a
// lower-case fragment with no full stop (`Cannot save ${name}.af: …`).
export function checkSaveEnvelope(body: unknown, name: string): { request: SaveRequest } | { problem: string } {
    if (!isMapping(body)) {
        return { problem: 'the request is not a mapping with a document' }
    }
    for (const key of ownKeys(body)) {
        if (!ENVELOPE_KEYS.includes(key)) {
            return { problem: `the request has the key ${shown(key)}, which is not allowed` }
        }
    }
    if (!Object.hasOwn(body, 'document')) {
        return { problem: 'the request has no document' }
    }
    // A save takes only the current schemaVersion (SET-07).
    const checked: CheckResult = checkDocument(body.document, [2])
    if ('problem' in checked) {
        return { problem: checked.problem }
    }
    const doc: AfDocument = checked.doc

    let source: string = name
    if (Object.hasOwn(body, 'source')) {
        if (typeof body.source !== 'string' || !NAME_PATTERN.test(body.source)) {
            return { problem: 'the source design must be a plain name' }
        }
        source = body.source
    }

    const warnings: string[] = []
    const components: Map<string, SaveComponent> = new Map()
    const sent: unknown = Object.hasOwn(body, 'components') ? body.components : {}
    if (!isMapping(sent)) {
        return { problem: 'components must be a mapping from component name to its files' }
    }
    for (const c of ownKeys(sent)) {
        if (!NAME_PATTERN.test(c) || !Object.hasOwn(doc.components, c)) {
            return { problem: `components names ${shown(c)}, which is not in the document` }
        }
        const entry: unknown = sent[c]
        if (!isMapping(entry)) {
            return { problem: `the entry of ${c} in components must be a mapping with from and files` }
        }
        for (const key of ownKeys(entry)) {
            if (!COMPONENT_ENTRY_KEYS.includes(key)) {
                return { problem: `the entry of ${c} has the key ${shown(key)}, which is not allowed` }
            }
        }
        let from: string | null = c
        if (Object.hasOwn(entry, 'from')) {
            if (entry.from === null) {
                from = null
            } else if (typeof entry.from === 'string' && NAME_PATTERN.test(entry.from)) {
                from = entry.from
            } else {
                return { problem: `the from of ${c} must be a plain name or null` }
            }
        }
        const files: Map<string, Buffer | null> = new Map()
        const sentFiles: unknown = Object.hasOwn(entry, 'files') ? entry.files : {}
        if (!isMapping(sentFiles)) {
            return { problem: `the files of ${c} must be a mapping from path to content` }
        }
        for (const p of ownKeys(sentFiles)) {
            const pathProblem: string | null = filePathProblem(p)
            if (pathProblem !== null) {
                return { problem: `the path ${shown(p)} of ${c} ${pathProblem}` }
            }
            const file: string = `${c}/${p}`
            const content: unknown = sentFiles[p]
            if (content === null) {
                if (p === SKILL_FILE) {
                    return { problem: `${file} cannot be removed` }
                }
                files.set(p, null)
                continue
            }
            if (!isMapping(content) || ownKeys(content).length !== 1) {
                return { problem: `${file} must be given as text or as base64` }
            }
            let bytes: Buffer
            if (Object.hasOwn(content, 'text') && typeof content.text === 'string') {
                bytes = Buffer.from(content.text, 'utf8')
            } else if (Object.hasOwn(content, 'base64') && typeof content.base64 === 'string') {
                if (p === SKILL_FILE) {
                    return { problem: `${file} must be sent as text` }
                }
                bytes = Buffer.from(content.base64, 'base64')
                // Strict: Node skips characters it cannot read, so only a
                // string that encodes back to itself is taken.
                if (bytes.toString('base64') !== content.base64) {
                    return { problem: `${file} is not valid base64` }
                }
            } else {
                return { problem: `${file} must be given as text or as base64` }
            }
            if (bytes.length > MAX_FILE_BYTES) {
                return { problem: `${file} is larger than ${MAX_FILE_SIZE_TEXT}` }
            }
            if (p === SKILL_FILE) {
                const skill: SkillCheck = checkSkill(content.text as string, c)
                if (skill.problem !== null) {
                    return { problem: skill.problem }
                }
                warnings.push(...skill.warnings)
            }
            files.set(p, bytes)
        }
        // Removals count too: on a case-insensitive disk, removing readme.md
        // would remove README.md.
        const pathsIssue: string | null = pathsProblem([...files.keys()])
        if (pathsIssue !== null) {
            return { problem: `in the folder of ${c}, ${pathsIssue}` }
        }
        components.set(c, { from, files })
    }
    // A component the request does not name keeps the folder of its own name.
    for (const c of ownKeys(doc.components)) {
        if (!components.has(c)) {
            components.set(c, { from: c, files: new Map() })
        }
    }
    const byFrom: Map<string, string> = new Map()
    for (const c of [...components.keys()].sort(byCodeUnit)) {
        const from: string | null = (components.get(c) as SaveComponent).from
        if (from === null) {
            continue
        }
        const first: string | undefined = byFrom.get(from)
        if (first !== undefined) {
            return { problem: `${first} and ${c} both come from the folder of ${from}` }
        }
        byFrom.set(from, c)
    }
    return { request: { name, source, doc, components, warnings } }
}

// One save at a time per server: a promise chain. Saves are short, and this
// also covers a Save-as reading another design's folders.
let saveChain: Promise<unknown> = Promise.resolve()

function withSaveLock<T>(work: () => Promise<T>): Promise<T> {
    const run: Promise<T> = saveChain.then(work, work)
    saveChain = run.catch(() => undefined)
    return run
}

// Resolves when no save is running or queued, so shutdown can wait for a save
// that is between its first change and the .af write. A save queued while
// waiting is waited for too.
export async function drainSaves(): Promise<void> {
    let seen: Promise<unknown>
    do {
        seen = saveChain
        await seen
    } while (seen !== saveChain)
}

// A step of the undo journal: a rename to undo, or a path to remove.
type JournalStep = { kind: 'moved'; from: string; to: string } | { kind: 'created'; path: string }

// The plan for one component, made before anything changes. listed is what
// checkFinalFolder counted in the origin; a Save-as copies exactly that.
type ComponentPlan = { name: string; from: string | null; origin: string | null; listed: ListedFile[] }

// Saves the design: the component folders follow the document, the sent
// files are written, and the .af is written last. Throws SaveRefusedError
// when what is on disk refuses the save (nothing is changed) and
// SaveFailedError when a step failed (everything is rolled back).
export function saveDesign(dataDir: string, request: SaveRequest, afText: string): Promise<SaveResult> {
    return withSaveLock(() => runSave(dataDir, request, afText))
}

async function runSave(dataDir: string, request: SaveRequest, afText: string): Promise<SaveResult> {
    const name: string = request.name
    const nothingChanged: string = `Cannot save ${name}.af: the folder ${name}${COMPONENTS_SUFFIX} cannot be read. Nothing was changed.`
    const warnings: string[] = [...request.warnings]
    const renamed: { from: string; to: string }[] = []

    // Step 1: the root. It may be a link or a mount; it is resolved once and
    // never renamed or removed. A missing root is made in step 3.
    const root: string = componentsDir(dataDir, name)
    let rootReal: string | null = null
    let sourceReal: string | null = null
    const existing: Set<string> = new Set()
    const plans: ComponentPlan[] = []
    const moveAside: string[] = []
    let sameDesign: boolean = request.source === name
    try {
        try {
            rootReal = await realpath(root)
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') {
                throw error
            }
        }
        if (rootReal !== null && !(await stat(rootReal)).isDirectory()) {
            throw new SaveRefusedError(`${name}${COMPONENTS_SUFFIX} is not a folder`)
        }
        if (!sameDesign) {
            try {
                const real: string = await realpath(componentsDir(dataDir, request.source))
                if ((await stat(real)).isDirectory()) {
                    sourceReal = real
                }
            } catch (error) {
                if (errorCode(error) !== 'ENOENT') {
                    throw error
                }
            }
            if (sourceReal !== null && sourceReal === rootReal) {
                sameDesign = true
            }
        }

        // Step 2: plan, touching nothing. Entries that are not plain names
        // (such as .git or a left-over undo folder) are never touched.
        if (rootReal !== null) {
            const entries: Dirent[] = await readdir(rootReal, { withFileTypes: true })
            for (const entry of entries) {
                if (NAME_PATTERN.test(entry.name)) {
                    await resolveComponent(rootReal, entry.name)
                    existing.add(entry.name)
                }
            }
        }
        for (const c of [...request.components.keys()].sort(byCodeUnit)) {
            const component: SaveComponent = request.components.get(c) as SaveComponent
            const from: string | null = component.from
            let origin: string | null = null
            if (from !== null) {
                if (sameDesign) {
                    // A rename whose source folder is gone, onto a name that
                    // has a folder, is a repeat of a save that already did the
                    // rename (a second click, or a retry after a lost answer).
                    // Taking it as a new component would remove that folder.
                    if (from !== c && !existing.has(from) && existing.has(c)) {
                        throw new SaveRefusedError(
                            `the folder of ${from} is not there any more, so ${c} cannot be renamed from it; open ${name}.af again`
                        )
                    }
                    origin = rootReal !== null && existing.has(from) ? path.join(rootReal, from) : null
                } else if (sourceReal !== null) {
                    origin = await resolveComponent(sourceReal, from)
                }
            }
            const listed: ListedFile[] = await checkFinalFolder(c, origin, component.files)
            plans.push({ name: c, from: origin === null ? null : from, origin, listed })
        }
        for (const x of [...existing].sort(byCodeUnit)) {
            const kept: boolean = sameDesign && plans.some((p: ComponentPlan) => p.name === x && p.from === x)
            if (!kept) {
                moveAside.push(x)
            }
        }
    } catch (error) {
        if (error instanceof SaveRefusedError) {
            throw error
        }
        console.error(`Cannot save ${name}.af: the folder ${root} cannot be read:`, error)
        throw new SaveFailedError(nothingChanged)
    }

    // Step 3: the undo folder and the journal.
    const journal: JournalStep[] = []
    let part: string = `the folder ${name}${COMPONENTS_SUFFIX}`
    let rootMade: string | null = null
    let undo: string | null = null
    const undoName: string = `.af-save-${randomUUID()}`
    let fileCount: number = 0
    try {
        if (rootReal === null) {
            await mkdir(root)
            rootMade = root
            rootReal = await realpath(root)
        }
        const base: string = rootReal
        await mkdir(path.join(base, undoName))
        undo = path.join(base, undoName)
        await mkdir(path.join(undo, 'old'))
        await mkdir(path.join(undo, 'files'))
        const undoDir: string = undo
        // Every file moved aside gets its own undo path, so a later move can
        // never replace an earlier original.
        const moveFileAside = async (full: string): Promise<void> => {
            fileCount += 1
            const to: string = path.join(undoDir, 'files', String(fileCount))
            await rename(full, to)
            journal.push({ kind: 'moved', from: full, to })
        }

        // Step 4: move aside every leaving folder, so swaps and chains work.
        for (const x of moveAside) {
            part = `the folder of ${x}`
            const to: string = path.join(undoDir, 'old', x)
            await rename(path.join(base, x), to)
            journal.push({ kind: 'moved', from: path.join(base, x), to })
        }

        // Step 5: place each component's folder.
        for (const plan of plans) {
            part = `the folder of ${plan.name}`
            const target: string = path.join(base, plan.name)
            const from: string | null = plan.from
            if (sameDesign) {
                if (from !== null && from === plan.name && !moveAside.includes(from)) {
                    continue
                }
                if (from !== null && moveAside.includes(from)) {
                    const aside: string = path.join(undoDir, 'old', from)
                    await rename(aside, target)
                    journal.push({ kind: 'moved', from: aside, to: target })
                    if (from !== plan.name) {
                        renamed.push({ from, to: plan.name })
                    }
                    continue
                }
                await mkdir(target)
                journal.push({ kind: 'created', path: target })
                continue
            }
            if (from !== null && plan.origin !== null) {
                // Only the files the checks counted are copied: no names
                // starting with '.', no links, no folders too deep, no paths
                // that break the path rule. The folder is journalled, so a
                // copy that fails half way is removed with it.
                await mkdir(target)
                journal.push({ kind: 'created', path: target })
                for (const file of plan.listed) {
                    part = `the file ${plan.name}/${file.path}`
                    const parts: string[] = file.path.split('/')
                    if (parts.length > 1) {
                        await mkdir(path.join(target, ...parts.slice(0, -1)), { recursive: true })
                    }
                    // Checked again just before, so a file swapped for a link
                    // since the plan is not followed.
                    if (!(await lstat(file.full)).isFile()) {
                        throw new SaveRefusedError(`${request.source}${COMPONENTS_SUFFIX}/${from}/${file.path} changed while saving`)
                    }
                    await copyFile(file.full, path.join(target, ...parts), constants.COPYFILE_EXCL)
                }
                part = `the folder of ${plan.name}`
                if (from !== plan.name) {
                    renamed.push({ from, to: plan.name })
                }
                continue
            }
            await mkdir(target)
            journal.push({ kind: 'created', path: target })
        }

        // Step 6: edit the sent files.
        for (const plan of plans) {
            const dir: string = path.join(base, plan.name)
            const files: Map<string, Buffer | null> = (request.components.get(plan.name) as SaveComponent).files
            for (const p of [...files.keys()].sort(byCodeUnit)) {
                part = `the file ${plan.name}/${p}`
                const full: string = await guardedFile(dir, p, plan.name)
                if (await exists(full)) {
                    await moveFileAside(full)
                }
                const bytes: Buffer | null = files.get(p) as Buffer | null
                if (bytes === null) {
                    continue
                }
                const parts: string[] = p.split('/')
                for (let i = 1; i < parts.length; i += 1) {
                    const sub: string = path.join(dir, ...parts.slice(0, i))
                    try {
                        await mkdir(sub)
                        journal.push({ kind: 'created', path: sub })
                    } catch (error) {
                        if (errorCode(error) !== 'EEXIST') {
                            throw error
                        }
                    }
                }
                await writeAtomicAt(full, bytes)
                journal.push({ kind: 'created', path: full })
            }
        }

        // Step 7: starters, then the name line of each renamed SKILL.md.
        for (const plan of plans) {
            part = `the file ${plan.name}/${SKILL_FILE}`
            const skill: string = path.join(base, plan.name, SKILL_FILE)
            if (!(await exists(skill))) {
                await writeAtomicAt(skill, starterSkill(plan.name))
                journal.push({ kind: 'created', path: skill })
            }
        }
        for (const pair of renamed) {
            part = `the file ${pair.to}/${SKILL_FILE}`
            const skill: string = path.join(base, pair.to, SKILL_FILE)
            let bytes: Buffer | null = null
            try {
                bytes = await readBytes(skill, MAX_FILE_BYTES)
            } catch (error) {
                if (!(error instanceof FileTooLargeError)) {
                    throw error
                }
            }
            const text: string | null = bytes === null ? null : asText(bytes)
            const synced: { text: string; changed: boolean } | null =
                text === null ? null : syncNameLine(text, pair.from, pair.to)
            if (synced !== null && synced.changed) {
                await moveFileAside(skill)
                await writeAtomicAt(skill, synced.text)
                journal.push({ kind: 'created', path: skill })
                continue
            }
            const check: SkillCheck | null = text === null ? null : checkSkill(text, pair.to)
            const file: string = `${pair.to}/${SKILL_FILE}`
            if (
                check === null ||
                check.warnings.some((w: string) => w.startsWith(`the name in ${file}`) || w === `${file} has no name`)
            ) {
                warnings.push(`the name in ${file} was not changed to ${pair.to}; change it by hand`)
            }
        }
        await syncFolder(base)

        // Step 8: the .af, last of all.
        part = 'the data folder'
        await writeAtomic(dataDir, name, afText)
    } catch (error) {
        console.error(`Cannot save ${name}.af: ${part} failed; rolling back:`, error)
        let rolledBack: boolean = true
        for (const step of [...journal].reverse()) {
            try {
                if (step.kind === 'moved') {
                    await rename(step.to, step.from)
                } else {
                    await rm(step.path, { recursive: true, force: true })
                }
            } catch (undoError) {
                rolledBack = false
                console.error(`Cannot undo a step of the save of ${name}.af:`, step, undoError)
            }
        }
        if (rolledBack) {
            if (undo !== null) {
                await rm(undo, { recursive: true, force: true }).catch((rmError: unknown) => {
                    console.warn(`Cannot remove the undo folder ${undo}:`, rmError)
                })
            }
            if (rootMade !== null) {
                // rmdir removes only an empty folder, and only one this save made.
                await rmdir(rootMade).catch((rmError: unknown) => {
                    console.warn(`Cannot remove the folder ${rootMade}:`, rmError)
                })
            }
            if (error instanceof SaveRefusedError) {
                throw error
            }
            throw new SaveFailedError(`Cannot save ${name}.af: ${part} cannot be written. Nothing was changed.`)
        }
        console.error(`The undo folder ${undo} is kept; it may hold the only copy of a component folder`)
        throw new SaveFailedError(
            `Cannot save ${name}.af: ${part} cannot be written, and some files may be left in ${name}${COMPONENTS_SUFFIX}/${undoName}.`
        )
    }

    // Step 9: done. What is still in undo/old was removed by this save.
    const removed: string[] = (await readdir(path.join(undo, 'old'))).sort(byCodeUnit)
    await rm(undo, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn(`Saved ${name}.af, but cannot remove the undo folder ${undo}:`, error)
    })
    return { warnings, removed, renamed }
}

// True when something is at the path (lstat, so a link counts as itself).
async function exists(full: string): Promise<boolean> {
    try {
        await lstat(full)
        return true
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            return false
        }
        throw error
    }
}

// Refuses, before anything changes, a component folder that the save would
// leave with colliding paths (also with files already on disk, such as
// readme.md sent where README.md is), too many files or too many bytes, and
// a sent path that goes through a link in the origin folder.
// Returns the files listed in the origin.
async function checkFinalFolder(c: string, origin: string | null, files: Map<string, Buffer | null>): Promise<ListedFile[]> {
    const sizes: Map<string, number> = new Map()
    let listed: ListedFile[] = []
    if (origin !== null) {
        listed = (await walkFolder(origin)).files
        for (const file of listed) {
            sizes.set(file.path, file.size)
        }
        for (const p of files.keys()) {
            await guardedFile(origin, p, c)
        }
    }
    if (!sizes.has(SKILL_FILE)) {
        sizes.set(SKILL_FILE, Buffer.byteLength(starterSkill(c), 'utf8'))
    }
    const removals: string[] = []
    for (const [p, bytes] of files) {
        if (bytes === null) {
            sizes.delete(p)
            removals.push(p)
        } else {
            sizes.set(p, bytes.length)
        }
    }
    const problem: string | null = pathsProblem([...sizes.keys(), ...removals])
    if (problem !== null) {
        throw new SaveRefusedError(`in the folder of ${c}, ${problem}`)
    }
    if (sizes.size > MAX_FOLDER_FILES) {
        throw new SaveRefusedError(`the folder of ${c} would have more than ${MAX_FOLDER_FILES} files`)
    }
    let total: number = 0
    for (const size of sizes.values()) {
        total += size
    }
    if (total > MAX_FOLDER_BYTES) {
        throw new SaveRefusedError(`the folder of ${c} would be larger than ${MAX_FOLDER_SIZE_TEXT}`)
    }
    return listed
}

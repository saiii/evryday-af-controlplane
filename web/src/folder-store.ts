// The staged edits of each component's folder (SKILL.md and extra files),
// keyed by the canvas node id. Nothing here writes to disk; only the header
// Save does, sending the canvas and these edits in one request (D-02, D-14).
// origin is the folder name a node had at the last open or save. Save sends it
// as from, which is how the server tells a rename from a delete plus an add
// (research Pitfall 9); a component dropped from the palette has origin null.
//
// Everything lives in refs and is changed only in event handlers or fetch
// callbacks, never inside a state updater (StrictMode runs updaters twice).
// version is bumped after each change so that readers re-render.

import { useCallback, useMemo, useRef, useState } from 'react'
import { SKILL_FILE } from '../../src/shared/component-settings'
import type { ComponentFlowNode } from './af-mapping'

export type StagedFile = { kind: 'text'; text: string } | { kind: 'base64'; base64: string; size: number } | { kind: 'remove' }

export type LoadedFolder = {
    exists: boolean
    skillText: string | null
    description: string | null
    warnings: string[]
    problem: string | null
    files: { path: string; size: number; text: string | null }[]
    skipped: number
}

export type FolderEntry = {
    origin: string | null
    load: 'idle' | 'loading' | 'loaded' | 'failed'
    loaded: LoadedFolder | null
    skill: { text: string; problem: string | null; description: string | null; warnings: string[] } | null
    files: Map<string, StagedFile>
}

export type EnvelopeFile = { text: string } | { base64: string } | null

export type Envelope = {
    source?: string
    components: Record<string, { from: string | null; files?: Record<string, EnvelopeFile> }>
}

export interface FolderStore {
    // Changes on every store change, for re-rendering.
    version: number
    // The design the origins live in.
    source: string | null
    entry(id: string): FolderEntry
    ensureLoaded(id: string): void
    retryLoad(id: string): void
    setSkill(id: string, text: string, check: { problem: string | null; description: string | null; warnings: string[] }): void
    stageFile(id: string, path: string, staged: StagedFile): void
    unstageFile(id: string, path: string): void
    resetForOpen(design: string, idByName: ReadonlyMap<string, string>): void
    buildEnvelope(nodes: readonly ComponentFlowNode[]): Envelope
    firstProblem(nodes: readonly ComponentFlowNode[]): string | null
    afterSave(design: string, nameById: ReadonlyMap<string, string>): void
}

const EMPTY_FOLDER: LoadedFolder = {
    exists: false,
    skillText: null,
    description: null,
    warnings: [],
    problem: null,
    files: [],
    skipped: 0
}

function freshEntry(origin: string | null): FolderEntry {
    return { origin, load: 'idle', loaded: null, skill: null, files: new Map() }
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isStringOrNull(value: unknown): value is string | null {
    return value === null || typeof value === 'string'
}

// The folder answer of GET /api/systems/:design/components/:component, or null
// when it does not have the expected shape.
function folderFrom(body: unknown): LoadedFolder | null {
    if (typeof body !== 'object' || body === null) {
        return null
    }
    const b = body as Record<string, unknown>
    if (typeof b.exists !== 'boolean' || !Array.isArray(b.files)) {
        return null
    }
    if (typeof b.skipped !== 'number' || !Number.isFinite(b.skipped)) {
        return null
    }
    const files: { path: string; size: number; text: string | null }[] = []
    for (const f of b.files as unknown[]) {
        if (typeof f !== 'object' || f === null) {
            return null
        }
        const file = f as Record<string, unknown>
        if (typeof file.path !== 'string' || typeof file.size !== 'number' || !isStringOrNull(file.text)) {
            return null
        }
        files.push({ path: file.path, size: file.size, text: file.text })
    }
    if (b.skill === null) {
        return { ...EMPTY_FOLDER, exists: b.exists, files, skipped: b.skipped }
    }
    if (typeof b.skill !== 'object') {
        return null
    }
    const s = b.skill as Record<string, unknown>
    if (
        typeof s.text !== 'string' ||
        !isStringOrNull(s.description) ||
        !isStringOrNull(s.problem) ||
        !isStringArray(s.warnings)
    ) {
        return null
    }
    return {
        exists: b.exists,
        skillText: s.text,
        description: s.description,
        warnings: s.warnings,
        problem: s.problem,
        files,
        skipped: b.skipped
    }
}

export function useFolderStore(): FolderStore {
    const entries = useRef<Map<string, FolderEntry>>(new Map())
    const source = useRef<string | null>(null)
    // Bumped by resetForOpen and afterSave: a folder answer asked for before
    // then is dropped (T-06-28).
    const generation = useRef<number>(0)
    // Each folder fetch of a node takes the next number; only the latest counts.
    const requests = useRef<Map<string, number>>(new Map())
    const [version, setVersion] = useState<number>(0)

    const touch = useCallback(() => {
        setVersion((v) => v + 1)
    }, [])

    // The entry of a node, created with origin null when there is none.
    const ensureEntry = useCallback((id: string): FolderEntry => {
        let found: FolderEntry | undefined = entries.current.get(id)
        if (found === undefined) {
            found = freshEntry(null)
            entries.current.set(id, found)
        }
        return found
    }, [])

    // Never stores, so it is safe during render.
    const entry = useCallback((id: string): FolderEntry => entries.current.get(id) ?? freshEntry(null), [])

    const ensureLoaded = useCallback(
        (id: string) => {
            const current: FolderEntry = ensureEntry(id)
            if (current.load !== 'idle') {
                return
            }
            const origin: string | null = current.origin
            const design: string | null = source.current
            if (origin === null || design === null) {
                current.loaded = { ...EMPTY_FOLDER, warnings: [], files: [] }
                current.load = 'loaded'
                touch()
                return
            }
            current.load = 'loading'
            const request: number = (requests.current.get(id) ?? 0) + 1
            requests.current.set(id, request)
            const asked: number = generation.current
            touch()
            // Still the latest request of the same generation, for an entry
            // that still exists.
            const stillWanted = (): FolderEntry | null => {
                if (requests.current.get(id) !== request || generation.current !== asked) {
                    return null
                }
                return entries.current.get(id) ?? null
            }
            const fail = () => {
                const target: FolderEntry | null = stillWanted()
                if (target === null) {
                    return
                }
                target.load = 'failed'
                target.loaded = null
                touch()
            }
            void (async () => {
                let response: Response
                try {
                    response = await fetch(
                        `/api/systems/${encodeURIComponent(design)}/components/${encodeURIComponent(origin)}`,
                        { cache: 'no-store' }
                    )
                } catch {
                    fail()
                    return
                }
                if (!response.ok) {
                    fail()
                    return
                }
                let body: unknown
                try {
                    body = (await response.json()) as unknown
                } catch {
                    fail()
                    return
                }
                const folder: LoadedFolder | null = folderFrom(body)
                if (folder === null) {
                    fail()
                    return
                }
                const target: FolderEntry | null = stillWanted()
                if (target === null) {
                    return
                }
                target.loaded = folder
                target.load = 'loaded'
                touch()
            })()
        },
        [ensureEntry, touch]
    )

    const retryLoad = useCallback(
        (id: string) => {
            const current: FolderEntry | undefined = entries.current.get(id)
            if (current === undefined || current.load !== 'failed') {
                return
            }
            current.load = 'idle'
            current.loaded = null
            touch()
        },
        [touch]
    )

    const setSkill = useCallback(
        (id: string, text: string, check: { problem: string | null; description: string | null; warnings: string[] }) => {
            const current: FolderEntry = ensureEntry(id)
            current.skill = {
                text,
                problem: check.problem,
                description: check.description,
                warnings: [...check.warnings]
            }
            touch()
        },
        [ensureEntry, touch]
    )

    const stageFile = useCallback(
        (id: string, path: string, staged: StagedFile) => {
            ensureEntry(id).files.set(path, staged)
            touch()
        },
        [ensureEntry, touch]
    )

    const unstageFile = useCallback(
        (id: string, path: string) => {
            ensureEntry(id).files.delete(path)
            touch()
        },
        [ensureEntry, touch]
    )

    const resetForOpen = useCallback(
        (design: string, idByName: ReadonlyMap<string, string>) => {
            source.current = design
            const next: Map<string, FolderEntry> = new Map()
            for (const [name, id] of idByName) {
                next.set(id, freshEntry(name))
            }
            entries.current = next
            generation.current += 1
            touch()
        },
        [touch]
    )

    const buildEnvelope = useCallback((nodes: readonly ComponentFlowNode[]): Envelope => {
        // Plain object keyed by canvas names; those already pass NAME_PATTERN
        // on the canvas, so __proto__ cannot occur. The server re-checks.
        const components: Envelope['components'] = {}
        for (const node of nodes) {
            const name: string = node.data.name
            const current: FolderEntry | undefined = entries.current.get(node.id)
            const files: Record<string, EnvelopeFile> = {}
            let count: number = 0
            if (current?.skill) {
                files[SKILL_FILE] = { text: current.skill.text }
                count += 1
            }
            if (current !== undefined) {
                for (const [path, staged] of current.files) {
                    if (staged.kind === 'text') {
                        files[path] = { text: staged.text }
                    } else if (staged.kind === 'base64') {
                        files[path] = { base64: staged.base64 }
                    } else {
                        files[path] = null
                    }
                    count += 1
                }
            }
            components[name] = count > 0 ? { from: current?.origin ?? null, files } : { from: current?.origin ?? null }
        }
        const envelope: Envelope = { components }
        if (source.current !== null) {
            envelope.source = source.current
        }
        return envelope
    }, [])

    const firstProblem = useCallback((nodes: readonly ComponentFlowNode[]): string | null => {
        for (const node of nodes) {
            const problem: string | null | undefined = entries.current.get(node.id)?.skill?.problem
            if (typeof problem === 'string') {
                return problem
            }
        }
        return null
    }, [])

    const afterSave = useCallback(
        (design: string, nameById: ReadonlyMap<string, string>) => {
            source.current = design
            const next: Map<string, FolderEntry> = new Map()
            for (const [id, name] of nameById) {
                next.set(id, freshEntry(name))
            }
            entries.current = next
            generation.current += 1
            touch()
        },
        [touch]
    )

    // source is read from the ref on each render; version makes the memo new
    // after every change so readers see it.
    return useMemo<FolderStore>(
        () => ({
            version,
            source: source.current,
            entry,
            ensureLoaded,
            retryLoad,
            setSkill,
            stageFile,
            unstageFile,
            resetForOpen,
            buildEnvelope,
            firstProblem,
            afterSave
        }),
        [
            version,
            entry,
            ensureLoaded,
            retryLoad,
            setSkill,
            stageFile,
            unstageFile,
            resetForOpen,
            buildEnvelope,
            firstProblem,
            afterSave
        ]
    )
}

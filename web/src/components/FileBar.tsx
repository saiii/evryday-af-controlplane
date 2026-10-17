// The name field, Save and the Open list in the header. The server checks
// every name and every document; the checks here only save a round trip (D-04).
// The page speaks JSON to /api/systems and never reads or writes YAML itself.

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { NAME_PATTERN } from '../../../src/shared/af-document'
import type { AfDocument } from '../../../src/shared/af-document'
import { checkDocument, FILE_NAME_RULE, shownName } from '../../../src/shared/af-validate'
import type { CheckResult } from '../../../src/shared/af-validate'
import { documentFromNodes, edgesFromDocument, nodesFromDocument } from '../af-mapping'
import type { ComponentFlowNode, LineFlowEdge } from '../af-mapping'
import type { ShowMessage } from '../message'
import { bodyFrom, errorFrom, UNREACHABLE } from '../api'
import type { FolderStore } from '../folder-store'
import { MAX_SAVE_BODY_BYTES, MAX_SAVE_BODY_TEXT, textByteLength } from '../../../src/shared/component-settings'

// The names in a list answer, or null when the answer is not { names: string[] }.
function namesFrom(body: unknown): string[] | null {
    if (typeof body !== 'object' || body === null || !('names' in body) || !Array.isArray(body.names)) {
        return null
    }
    const names: unknown[] = body.names
    return names.every((n) => typeof n === 'string') ? (names as string[]) : null
}

interface FileBarProps {
    showMessage: ShowMessage
    folders: FolderStore
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

// The renamed list of a save answer, or [] when it is not { from, to }[].
function renamedFrom(value: unknown): { from: string; to: string }[] {
    if (!Array.isArray(value)) {
        return []
    }
    const pairs: { from: string; to: string }[] = []
    for (const v of value as unknown[]) {
        if (typeof v !== 'object' || v === null) {
            return []
        }
        const pair = v as Record<string, unknown>
        if (typeof pair.from !== 'string' || typeof pair.to !== 'string') {
            return []
        }
        pairs.push({ from: pair.from, to: pair.to })
    }
    return pairs
}

// The message after a save: the Phase 5 wording when nothing else is to be
// said, else the folders that moved or went (D-18), the components still
// without image or tag (D-07) and the first server warning.
function savedMessage(
    saved: string,
    renamed: readonly { from: string; to: string }[],
    removed: readonly string[],
    missing: number,
    warnings: readonly string[]
): string {
    const parts: string[] = []
    if (renamed.length > 0) {
        parts.push(`Renamed the folder of ${renamed.map((r) => `${r.from} to ${r.to}`).join(', ')}.`)
    }
    if (removed.length === 1) {
        parts.push(`Removed the folder of ${removed[0]}. Only your own git or backups can bring it back.`)
    } else if (removed.length > 1) {
        parts.push(`Removed the folders of ${removed.join(', ')}. Only your own git or backups can bring them back.`)
    }
    if (missing === 1) {
        parts.push('1 component has no image or tag yet.')
    } else if (missing > 1) {
        parts.push(`${missing} components have no image or tag yet.`)
    }
    if (warnings.length > 0) {
        const more: number = warnings.length - 1
        const first: string = warnings[0].replace(/\.$/, '')
        parts.push(`Note: ${first}${more > 0 ? ` (and ${more} more)` : ''}.`)
    }
    return parts.length === 0 ? `Saved ${saved}.af` : `Saved ${saved}.af. ${parts.join(' ')}`
}

export default function FileBar({ showMessage, folders }: FileBarProps) {
    const { getNodes, getEdges, setNodes, setEdges, fitView } = useReactFlow<ComponentFlowNode, LineFlowEdge>()
    // Starts empty (D-02); judged exactly as typed, never trimmed or lower-cased.
    const [name, setName] = useState<string>('')
    const [listOpen, setListOpen] = useState<boolean>(false)
    // null while the list is being fetched.
    const [names, setNames] = useState<string[] | null>(null)
    const barRef = useRef<HTMLDivElement>(null)
    // Each list fetch and each open takes the next number. An answer whose
    // number is no longer current is ignored, so a late answer never replaces
    // a newer one, and a list closed meanwhile shows nothing.
    const listRequest = useRef<number>(0)
    const openRequest = useRef<number>(0)
    // True while a save request is on its way. A second Save (a double-click,
    // or Enter then Save) would send the same from names again after the first
    // has already moved the folders, and an Open would reset the staging the
    // save answer then overwrites, so both wait for the answer. The ref is
    // read in handlers; the state only disables the button.
    const savingRef = useRef<boolean>(false)
    const [saving, setSaving] = useState<boolean>(false)

    // Closes the list and drops any list answer still on its way.
    const closeList = () => {
        listRequest.current += 1
        setListOpen(false)
    }

    // Writes the canvas as <name>.af, over a file of the same name with no
    // question (D-03). A missing or bad name is refused here and nothing is sent.
    const save = async () => {
        if (savingRef.current) {
            return
        }
        closeList()
        if (name === '') {
            showMessage(`Cannot save without a name: ${FILE_NAME_RULE}.`, 'error')
            return
        }
        if (!NAME_PATTERN.test(name)) {
            showMessage(`Cannot save ${shownName(name)}: ${FILE_NAME_RULE}.`, 'error')
            return
        }
        const saved: string = name
        const nodes: ComponentFlowNode[] = getNodes()
        // A SKILL.md the panel has found not valid stops the save here with the
        // sentence the server would give; the server refuses it anyway (D-03).
        const problem: string | null = folders.firstProblem(nodes)
        if (problem !== null) {
            showMessage(`Cannot save ${saved}.af: ${problem}.`, 'error')
            return
        }
        const doc: AfDocument = documentFromNodes(nodes, getEdges())
        // Built before the request: the names that become the origins on success.
        const nameById: Map<string, string> = new Map(nodes.map((n) => [n.id, n.data.name]))
        // One request carries the canvas and every staged folder edit (D-02, D-14).
        const body: string = JSON.stringify({ document: doc, ...folders.buildEnvelope(nodes) })
        if (textByteLength(body) > MAX_SAVE_BODY_BYTES) {
            showMessage(`Cannot save ${saved}.af: the canvas and its files are larger than ${MAX_SAVE_BODY_TEXT}.`, 'error')
            return
        }
        savingRef.current = true
        setSaving(true)
        try {
            await sendSave(saved, nodes, nameById, body)
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }

    // Sends the save and shows its answer. Only save() calls it, with the
    // in-flight guard set.
    const sendSave = async (
        saved: string,
        nodes: ComponentFlowNode[],
        nameById: ReadonlyMap<string, string>,
        body: string
    ) => {
        let response: Response
        try {
            response = await fetch(`/api/systems/${encodeURIComponent(saved)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body,
                cache: 'no-store'
            })
        } catch {
            showMessage(UNREACHABLE, 'error')
            return
        }
        if (response.ok) {
            const answer: unknown = await bodyFrom(response)
            const a: Record<string, unknown> =
                typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {}
            const warnings: string[] = isStringArray(a.warnings) ? a.warnings : []
            const removed: string[] = isStringArray(a.removed) ? a.removed : []
            const renamed: { from: string; to: string }[] = renamedFrom(a.renamed)
            // The saved names are now the origins and the saved design the
            // source; staged edits are written, so they are cleared.
            folders.afterSave(saved, nameById)
            const missing: number = nodes.filter(
                (n) => typeof n.data.image !== 'string' || n.data.image === '' || typeof n.data.tag !== 'string' || n.data.tag === ''
            ).length
            showMessage(savedMessage(saved, renamed, removed, missing, warnings), 'info')
            return
        }
        // A refused or failed save leaves the staging as it was.
        showMessage(
            await errorFrom(response, `Cannot save ${saved}.af: the server answered ${response.status}.`),
            'error'
        )
    }

    // The list is read afresh every time it opens (D-06), in the server's order.
    const toggleList = async () => {
        if (listOpen) {
            closeList()
            return
        }
        listRequest.current += 1
        const request: number = listRequest.current
        setNames(null)
        setListOpen(true)
        let response: Response
        try {
            response = await fetch('/api/systems', { cache: 'no-store' })
        } catch {
            if (request !== listRequest.current) {
                return
            }
            closeList()
            showMessage(UNREACHABLE, 'error')
            return
        }
        if (!response.ok) {
            const error: string = await errorFrom(response, 'Cannot list the saved files.')
            if (request !== listRequest.current) {
                return
            }
            closeList()
            showMessage(error, 'error')
            return
        }
        const listed: string[] | null = namesFrom(await bodyFrom(response))
        if (request !== listRequest.current) {
            return
        }
        if (listed === null) {
            closeList()
            showMessage('Cannot list the saved files: the server answer cannot be read.', 'error')
            return
        }
        setNames(listed)
    }

    // Replaces the canvas with the file, with no question (D-07). A refused file
    // leaves the canvas and the name field as they were (D-18).
    const open = async (picked: string) => {
        closeList()
        if (savingRef.current) {
            showMessage(`Cannot open ${picked}.af while a save is still running; try again when it is done.`, 'error')
            return
        }
        openRequest.current += 1
        const request: number = openRequest.current
        let response: Response
        try {
            response = await fetch(`/api/systems/${encodeURIComponent(picked)}`, { cache: 'no-store' })
        } catch {
            if (request === openRequest.current) {
                showMessage(UNREACHABLE, 'error')
            }
            return
        }
        if (!response.ok) {
            const error: string = await errorFrom(
                response,
                `Cannot open ${picked}.af: the server answered ${response.status}.`
            )
            if (request === openRequest.current) {
                showMessage(error, 'error')
            }
            return
        }
        // The answer is checked like a file on disk, so a malformed answer
        // leaves the canvas and the name field as they were.
        const body: unknown = await bodyFrom(response)
        if (request !== openRequest.current) {
            return
        }
        const checked: CheckResult | null =
            typeof body === 'object' && body !== null && 'document' in body ? checkDocument(body.document) : null
        if (checked === null || 'problem' in checked) {
            showMessage(`Cannot open ${picked}.af: the server answer cannot be read.`, 'error')
            return
        }
        // Built here, not in an updater: StrictMode runs updaters twice in dev.
        const { nodes, idByName } = nodesFromDocument(checked.doc)
        const edges: LineFlowEdge[] = edgesFromDocument(checked.doc, idByName)
        setNodes(nodes)
        setEdges(edges)
        // Every component's origin is now its name in the opened design.
        folders.resetForOpen(picked, idByName)
        setName(picked)
        // A version 1 file is upgraded in memory only; the next save writes v2 (D-20).
        const upgraded: boolean =
            typeof body === 'object' && body !== null && Object.hasOwn(body, 'upgradedFrom') &&
            (body as { upgradedFrom?: unknown }).upgradedFrom === 1
        showMessage(upgraded ? `Opened ${picked}.af (version 1; it is saved as version 2)` : `Opened ${picked}.af`, 'info')
        // Zoom and pan are not in the file; the view is fitted instead (A6). The
        // library waits until the new components are measured before it fits.
        void fitView({ maxZoom: 1, padding: 0.2 })
    }

    // A pointer-down outside the file bar closes the list. The listener exists
    // only while the list is open.
    useEffect(() => {
        if (!listOpen) {
            return
        }
        const onPointerDown = (event: PointerEvent) => {
            const bar = barRef.current
            if (bar !== null && event.target instanceof Node && bar.contains(event.target)) {
                return
            }
            closeList()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
        }
    }, [listOpen])

    // No key pressed in the bar or the list reaches the canvas, so Backspace
    // and Delete here delete no component. Escape closes the list.
    const onBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
            closeList()
        }
    }

    const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        // No key typed in the field reaches the canvas's own key handling.
        event.stopPropagation()
        if (event.key === 'Enter') {
            void save()
        } else if (event.key === 'Escape') {
            closeList()
        }
    }

    let list: ReactNode = null
    if (listOpen) {
        let items: ReactNode
        if (names === null) {
            items = <div className="file-bar-empty">Loading…</div>
        } else if (names.length === 0) {
            items = <div className="file-bar-empty">No saved files</div>
        } else {
            items = names.map((n) => (
                <button key={n} type="button" onClick={() => void open(n)}>
                    {n}
                </button>
            ))
        }
        // A plain group of buttons, not a menu: a menu role promises arrow-key
        // movement that this list does not have. Tab moves through the names.
        list = (
            <div className="file-bar-list" role="group" aria-label="Saved files">
                {items}
            </div>
        )
    }

    return (
        <div className="file-bar" ref={barRef} onKeyDown={onBarKeyDown}>
            <input
                type="text"
                className="file-bar-name"
                placeholder="file name"
                aria-label="File name"
                value={name}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={onNameKeyDown}
            />
            <button type="button" disabled={saving} onClick={() => void save()}>
                Save
            </button>
            <button type="button" aria-expanded={listOpen} onClick={() => void toggleList()}>
                Open ▾
            </button>
            {list}
        </div>
    )
}

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

const UNREACHABLE: string = 'Cannot reach the server.'

// The sentence in the body of a refusal, or the fallback when the body has none.
async function errorFrom(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
            return body.error
        }
    } catch {
        // Not JSON: the fallback is used.
    }
    return fallback
}

// The body of a successful answer, or undefined when it is not JSON.
async function bodyFrom(response: Response): Promise<unknown> {
    try {
        return (await response.json()) as unknown
    } catch {
        return undefined
    }
}

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
}

export default function FileBar({ showMessage }: FileBarProps) {
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

    // Closes the list and drops any list answer still on its way.
    const closeList = () => {
        listRequest.current += 1
        setListOpen(false)
    }

    // Writes the canvas as <name>.af, over a file of the same name with no
    // question (D-03). A missing or bad name is refused here and nothing is sent.
    const save = async () => {
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
        const doc: AfDocument = documentFromNodes(getNodes(), getEdges())
        let response: Response
        try {
            response = await fetch(`/api/systems/${encodeURIComponent(saved)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(doc),
                cache: 'no-store'
            })
        } catch {
            showMessage(UNREACHABLE, 'error')
            return
        }
        if (response.ok) {
            showMessage(`Saved ${saved}.af`, 'info')
            return
        }
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
        setName(picked)
        showMessage(`Opened ${picked}.af`, 'info')
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
                <button key={n} type="button" role="menuitem" onClick={() => void open(n)}>
                    {n}
                </button>
            ))
        }
        list = (
            <div className="file-bar-list" role="menu">
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
            <button type="button" onClick={() => void save()}>
                Save
            </button>
            <button type="button" aria-haspopup="menu" aria-expanded={listOpen} onClick={() => void toggleList()}>
                Open ▾
            </button>
            {list}
        </div>
    )
}

// The name field, Save and the Open list in the header. The server checks
// every name and every document; the checks here only save a round trip (D-04).
// The page speaks JSON to /api/systems and never reads or writes YAML itself.

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { NAME_PATTERN } from '../../../src/shared/af-document'
import type { AfDocument } from '../../../src/shared/af-document'
import { FILE_NAME_RULE, shownName } from '../../../src/shared/af-validate'
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

    // Writes the canvas as <name>.af, over a file of the same name with no
    // question (D-03). A missing or bad name is refused here and nothing is sent.
    const save = async () => {
        setListOpen(false)
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
            setListOpen(false)
            return
        }
        setNames(null)
        setListOpen(true)
        let response: Response
        try {
            response = await fetch('/api/systems', { cache: 'no-store' })
        } catch {
            setListOpen(false)
            showMessage(UNREACHABLE, 'error')
            return
        }
        if (!response.ok) {
            setListOpen(false)
            showMessage(await errorFrom(response, 'Cannot list the saved files.'), 'error')
            return
        }
        const body: { names: string[] } = await response.json()
        setNames(body.names)
    }

    // Replaces the canvas with the file, with no question (D-07). A refused file
    // leaves the canvas and the name field as they were (D-18).
    const open = async (picked: string) => {
        setListOpen(false)
        let response: Response
        try {
            response = await fetch(`/api/systems/${encodeURIComponent(picked)}`, { cache: 'no-store' })
        } catch {
            showMessage(UNREACHABLE, 'error')
            return
        }
        if (!response.ok) {
            showMessage(
                await errorFrom(response, `Cannot open ${picked}.af: the server answered ${response.status}.`),
                'error'
            )
            return
        }
        const body: { name: string; document: AfDocument } = await response.json()
        // Built here, not in an updater: StrictMode runs updaters twice in dev.
        const { nodes, idByName } = nodesFromDocument(body.document)
        const edges: LineFlowEdge[] = edgesFromDocument(body.document, idByName)
        setNodes(nodes)
        setEdges(edges)
        setName(body.name)
        showMessage(`Opened ${body.name}.af`, 'info')
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
            setListOpen(false)
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
            setListOpen(false)
        }
    }

    const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        // No key typed in the field reaches the canvas's own key handling.
        event.stopPropagation()
        if (event.key === 'Enter') {
            void save()
        } else if (event.key === 'Escape') {
            setListOpen(false)
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

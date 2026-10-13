import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Handle, Position, useReactFlow, useStore } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { lineProblem, nameProblem } from '../../../src/shared/af-document'
import { CATALOGUE } from '../../../src/shared/catalogue'
import { connectionsFromEdges } from '../af-mapping'
import type { ComponentFlowNode, LineFlowEdge } from '../af-mapping'

const RULE_MESSAGE = 'Use lowercase letters, digits and hyphens, starting with a letter, 63 characters at most'

export default function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
    const entry = CATALOGUE[data.componentType]
    const { getNodes, getEdges, updateNodeData } = useReactFlow<ComponentFlowNode, LineFlowEdge>()

    // True while a line is being dragged that may not end on this component.
    // It is read from the library's store at render time and never stored.
    const dimmed: boolean = useStore((s) => {
        const from = s.connection.fromNode
        if (!s.connection.inProgress || from === null) {
            return false
        }
        // Source not dimmed: decided by the user at planning time (D-08), to be confirmed at the Phase 4 browser check.
        if (from.id === id) {
            return false
        }
        const source = from.data as ComponentFlowNode['data']
        return (
            lineProblem(
                { name: source.name, type: source.componentType },
                { name: data.name, type: data.componentType },
                connectionsFromEdges(getNodes(), getEdges())
            ) !== null
        )
    })

    // draft is null when the name is not being edited. It holds the text exactly as typed.
    const [draft, setDraft] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    // Set when the current edit has ended, so a later event for the same edit is ignored.
    const finished = useRef<boolean>(true)
    const inputRef = useRef<HTMLInputElement>(null)

    const startEdit = () => {
        finished.current = false
        setMessage(null)
        setDraft(data.name)
    }

    const endEdit = () => {
        finished.current = true
        setMessage(null)
        setDraft(null)
    }

    // The names of the other components, read at the moment of the check.
    const otherNames = (): string[] =>
        getNodes()
            .filter((node) => node.id !== id)
            .map((node) => node.data.name)

    // Enter: a good name is stored; a bad one keeps the field open with the reason.
    const confirm = () => {
        if (finished.current || draft === null) {
            return
        }
        const problem = nameProblem(draft, otherNames())
        if (problem === null) {
            updateNodeData(id, { name: draft })
            endEdit()
            return
        }
        setMessage(problem === 'taken' ? `"${draft}" is already used` : RULE_MESSAGE)
    }

    // Clicking away: a good name is stored; a bad one is dropped and the old name stays.
    const finishAway = () => {
        if (finished.current || draft === null) {
            return
        }
        if (nameProblem(draft, otherNames()) === null) {
            updateNodeData(id, { name: draft })
        }
        endEdit()
    }

    // The canvas handles pointer events on its own pane, so a click on empty
    // canvas may not blur the field. This listener covers that case. It is
    // registered again when the draft changes, so it always sees the current text.
    useEffect(() => {
        if (draft === null) {
            return
        }
        const onPointerDown = (event: PointerEvent) => {
            const input = inputRef.current
            if (input !== null && event.target instanceof Node && input.contains(event.target)) {
                return
            }
            finishAway()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
        }
    }, [draft])

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        // No key typed in the field reaches the canvas's own key handling.
        event.stopPropagation()
        if (event.key === 'Enter') {
            confirm()
        } else if (event.key === 'Escape') {
            endEdit()
        }
    }

    // Selected and dimmed are independent, so the class is built from both.
    let className: string = 'component-node'
    if (selected) {
        className += ' component-node-selected'
    }
    if (dimmed) {
        className += ' component-node-dimmed'
    }

    return (
        <div className={className} style={{ borderLeftColor: entry.colour }}>
            <Handle type="source" id="top" position={Position.Top} />
            <Handle type="source" id="right" position={Position.Right} />
            <Handle type="source" id="bottom" position={Position.Bottom} />
            <Handle type="source" id="left" position={Position.Left} />
            <div className="component-node-label">{entry.label}</div>
            {draft === null ? (
                <div className="component-node-name" title={data.name} onDoubleClick={startEdit}>
                    {data.name}
                </div>
            ) : (
                <input
                    ref={inputRef}
                    type="text"
                    className={
                        message === null
                            ? 'component-node-input nodrag nopan'
                            : 'component-node-input component-node-input-bad nodrag nopan'
                    }
                    value={draft}
                    autoFocus
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                        setDraft(event.target.value)
                        setMessage(null)
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => {
                        // The window lost focus, not the field: keep the edit open.
                        if (!document.hasFocus()) {
                            return
                        }
                        finishAway()
                    }}
                />
            )}
            {message !== null && <div className="component-node-error">{message}</div>}
        </div>
    )
}

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { nameProblem } from '../../../src/shared/af-document'
import { CATALOGUE } from '../../../src/shared/catalogue'
import type { ComponentFlowNode } from '../af-mapping'

const RULE_MESSAGE = 'Use lowercase letters, digits and hyphens, starting with a letter, 63 characters at most'

export default function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
    const entry = CATALOGUE[data.componentType]
    const { getNodes, updateNodeData } = useReactFlow<ComponentFlowNode>()

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

    return (
        <div
            className={selected ? 'component-node component-node-selected' : 'component-node'}
            style={{ borderLeftColor: entry.colour }}
        >
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
                    onBlur={finishAway}
                />
            )}
            {message !== null && <div className="component-node-error">{message}</div>}
        </div>
    )
}

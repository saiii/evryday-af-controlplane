import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
    Background,
    BackgroundVariant,
    ConnectionLineType,
    ConnectionMode,
    Controls,
    MarkerType,
    ReactFlow,
    useEdgesState,
    useNodesState,
    useReactFlow
} from '@xyflow/react'
import type {
    EdgeTypes,
    IsValidConnection,
    NodeTypes,
    OnBeforeDelete,
    OnConnectEnd,
    OnConnectStart
} from '@xyflow/react'
import { GRID_SIZE, lineProblem, nextDefaultName, snapPosition } from '../../../src/shared/af-document'
import type { LineEnd } from '../../../src/shared/af-document'
import { isComponentType, ruleRefusal } from '../../../src/shared/catalogue'
import { nearestSide } from '../../../src/shared/line-path'
import { componentNode, connectionsFromEdges, lineEdge, newNodeId } from '../af-mapping'
import type { ComponentFlowNode, LineFlowEdge } from '../af-mapping'
import ComponentNode from './ComponentNode'
import LineEdge from './LineEdge'
import { PALETTE_DRAG_TYPE } from './Palette'

// Declared once, outside the component: the library remounts every node if
// this object changes between renders.
const nodeTypes: NodeTypes = { component: ComponentNode }
// The same holds for lines. The key equals the type set in lineEdge.
const edgeTypes: EdgeTypes = { line: LineEdge }

// The size of a component, matching .component-node in styles.css.
const NODE_WIDTH = 180
const NODE_HEIGHT = 60

// How long a refusal message stays before it goes away by itself.
const MESSAGE_MS = 5000

// The arrowhead colours. They match --xy-edge-stroke and
// --xy-edge-stroke-selected in styles.css.
const LINE_GREY = '#9ca3af'
const LINE_SELECTED = '#374151'

// The question asked before a component is deleted together with lines.
// answer settles the delete that is waiting: true deletes, false keeps everything.
interface Question {
    text: string
    answer: (confirmed: boolean) => void
}

export default function Canvas() {
    const [nodes, setNodes, onNodesChange] = useNodesState<ComponentFlowNode>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<LineFlowEdge>([])
    const { screenToFlowPosition, getNode, getNodes, getEdges, getInternalNode } = useReactFlow<
        ComponentFlowNode,
        LineFlowEdge
    >()

    // refusal is null when no message is showing. It holds the sentence as plain text.
    const [refusal, setRefusal] = useState<string | null>(null)

    // The message goes away by itself. A second refusal replaces the first and
    // starts its own timer; a drag start clears the message first, so the same
    // sentence shown again also gets a fresh 5 seconds.
    useEffect(() => {
        if (refusal === null) {
            return
        }
        const timer = window.setTimeout(() => setRefusal(null), MESSAGE_MS)
        return () => {
            window.clearTimeout(timer)
        }
    }, [refusal])

    // question is null when nothing is being asked.
    const [question, setQuestion] = useState<Question | null>(null)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const deleteRef = useRef<HTMLButtonElement>(null)

    // The dialog opens when a question arrives. The test for "already open"
    // keeps a repeated run of this effect from throwing. Focus is put on the
    // Delete button by hand, so that Enter deletes: the browser would
    // otherwise focus the first button, which is Cancel.
    useEffect(() => {
        const dialog = dialogRef.current
        if (question === null || dialog === null || dialog.open) {
            return
        }
        dialog.showModal()
        deleteRef.current?.focus()
    }, [question])

    const onDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
    }

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        // Anything can be dropped here. Only one of the six type ids creates a component.
        const type: string = event.dataTransfer.getData(PALETTE_DRAG_TYPE)
        if (!isComponentType(type)) {
            return
        }
        const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false })
        // Centred on the pointer, then moved onto the grid.
        const position = snapPosition({
            x: pointer.x - NODE_WIDTH / 2,
            y: pointer.y - NODE_HEIGHT / 2
        })
        // The id is made here, not in the updater: StrictMode runs updaters twice in dev.
        const id: string = newNodeId()
        setNodes((current) => [
            ...current,
            componentNode(id, type, nextDefaultName(type, current.map((n) => n.data.name)), position)
        ])
    }

    // One end of a line as the rules see it, or null when no component has that id.
    const endOf = (id: string): LineEnd | null => {
        const node = getNode(id)
        if (node === undefined) {
            return null
        }
        return { name: node.data.name, type: node.data.componentType }
    }

    // The two ends and the verdict on a line between them, read at the moment
    // of the check. Null when either component is missing.
    const problemBetween = (sourceId: string, targetId: string) => {
        const from = endOf(sourceId)
        const to = endOf(targetId)
        if (from === null || to === null) {
            return null
        }
        return { from, to, problem: lineProblem(from, to, connectionsFromEdges(getNodes(), getEdges())) }
    }

    // The library asks this only when the pointer is exactly on a dot. It keeps
    // the library's own state truthful and makes nothing.
    const isValidConnection: IsValidConnection<LineFlowEdge> = (connection) => {
        const judged = problemBetween(connection.source, connection.target)
        return judged !== null && judged.problem === null
    }

    // Starting another drag clears the message.
    const onConnectStart: OnConnectStart = () => {
        setRefusal(null)
    }

    // The one place a line is made. It runs on every release after a drag from a dot.
    const onConnectEnd: OnConnectEnd = (event, state) => {
        if (state.fromNode === null || state.fromHandle === null) {
            return
        }
        // A touch release has no clientX of its own.
        const pointer = 'changedTouches' in event ? event.changedTouches[0] : event
        // The component under the pointer is found in the page. The library's own
        // idea of the target is empty unless the release is exactly on a dot.
        const under = document.elementFromPoint(pointer.clientX, pointer.clientY)
        const targetId: string | null = under?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
        // Empty canvas: no line and no message. This is how a drag is cancelled.
        if (targetId === null) {
            return
        }
        const sourceId: string = state.fromNode.id
        // Silent cancel on the source: decided by the user at planning time (D-08), to be confirmed at the Phase 4 browser check.
        if (targetId === sourceId) {
            return
        }
        const judged = problemBetween(sourceId, targetId)
        if (judged === null) {
            return
        }
        if (judged.problem === 'rule') {
            setRefusal(ruleRefusal(judged.from.type, judged.to.type))
            return
        }
        if (judged.problem === 'duplicate') {
            setRefusal(`${judged.from.name} already sends to ${judged.to.name}.`)
            return
        }
        const target = getInternalNode(targetId)
        if (target === undefined) {
            return
        }
        // The target end goes on the side nearest to the release point, in canvas coordinates.
        const point = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }, { snapToGrid: false })
        const side = nearestSide(point, {
            x: target.internals.positionAbsolute.x,
            y: target.internals.positionAbsolute.y,
            width: target.measured.width ?? NODE_WIDTH,
            height: target.measured.height ?? NODE_HEIGHT
        })
        // The line is built here, not in the updater, which only adds it once:
        // StrictMode runs updaters twice in dev.
        const edge = lineEdge(sourceId, state.fromHandle.id ?? 'right', targetId, side)
        setEdges((current) => (current.some((e) => e.id === edge.id) ? current : [...current, edge]))
    }

    // The library asks this before every delete, with the selected components
    // and with the selected lines plus every line attached to one of those
    // components, each line once. A question is put only when a component
    // takes lines with it.
    const onBeforeDelete: OnBeforeDelete<ComponentFlowNode, LineFlowEdge> = async ({
        nodes: goingNodes,
        edges: goingEdges
    }) => {
        // A second delete while the question is showing does nothing.
        if (dialogRef.current?.open) {
            return false
        }
        const ids: Set<string> = new Set(goingNodes.map((n) => n.id))
        // Lines only, or components with no lines: deleted at once.
        if (!goingEdges.some((e) => ids.has(e.source) || ids.has(e.target))) {
            return true
        }
        const lines: string = goingEdges.length === 1 ? '1 line' : `${goingEdges.length} lines`
        let text: string
        if (goingNodes.length > 1) {
            text = `Delete ${goingNodes.length} components and ${lines}?`
        } else {
            const only = goingNodes[0]
            // "its" is true only when every line that goes is attached to the
            // one component. A line selected alongside it that belongs to two
            // other components is asked about by count.
            if (goingEdges.every((e) => e.source === only.id || e.target === only.id)) {
                text = `Delete ${only.data.name} and its ${lines}?`
            } else {
                text = `Delete 1 component and ${lines}?`
            }
        }
        return new Promise<boolean>((resolve) => {
            setQuestion({ text, answer: resolve })
        })
    }

    // Closes the dialog and settles the waiting delete. On true the library
    // removes the components and their lines through onNodesChange and onEdgesChange.
    const answer = (confirmed: boolean) => {
        dialogRef.current?.close()
        question?.answer(confirmed)
        setQuestion(null)
    }

    // An arrowhead's colour is fixed in the marker and does not follow the
    // line, so a selected line gets its own, darker one.
    const shownEdges = useMemo(
        () =>
            edges.map((edge) => ({
                ...edge,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: edge.selected ? LINE_SELECTED : LINE_GREY,
                    width: 16,
                    height: 16
                }
            })),
        [edges]
    )

    return (
        <div className="canvas">
            {refusal !== null && (
                <div className="canvas-message" role="alert">
                    <span className="canvas-message-mark" aria-hidden="true">
                        ✕
                    </span>
                    {refusal}
                </div>
            )}
            <ReactFlow
                nodes={nodes}
                edges={shownEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onDrop={onDrop}
                onDragOver={onDragOver}
                snapToGrid
                snapGrid={[GRID_SIZE, GRID_SIZE]}
                connectionMode={ConnectionMode.Loose}
                connectOnClick={false}
                connectionRadius={0}
                connectionLineType={ConnectionLineType.SmoothStep}
                isValidConnection={isValidConnection}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                deleteKeyCode={['Backspace', 'Delete']}
                multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                onBeforeDelete={onBeforeDelete}
                zoomOnDoubleClick={false}
                minZoom={0.2}
                maxZoom={2}
            >
                <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} color="#d1d5db" />
                <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1, padding: 0.2 }} />
            </ReactFlow>
            <dialog
                ref={dialogRef}
                className="confirm-dialog"
                onCancel={(event) => {
                    // Esc: the dialog is closed by answer, with the delete refused.
                    event.preventDefault()
                    answer(false)
                }}
                onKeyDown={(event) => {
                    // No key pressed in the dialog reaches the canvas's own key handling.
                    event.stopPropagation()
                }}
            >
                {question !== null && (
                    <>
                        <p>{question.text}</p>
                        <div className="confirm-dialog-buttons">
                            <button type="button" onClick={() => answer(false)}>
                                Cancel
                            </button>
                            <button type="button" ref={deleteRef} onClick={() => answer(true)}>
                                Delete
                            </button>
                        </div>
                    </>
                )}
            </dialog>
        </div>
    )
}

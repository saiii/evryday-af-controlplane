import type { DragEvent } from 'react'
import { Background, BackgroundVariant, Controls, ReactFlow, useNodesState, useReactFlow } from '@xyflow/react'
import type { NodeTypes } from '@xyflow/react'
import { GRID_SIZE, nextDefaultName, snapPosition } from '../../../src/shared/af-document'
import { isComponentType } from '../../../src/shared/catalogue'
import { componentNode, newNodeId } from '../af-mapping'
import type { ComponentFlowNode } from '../af-mapping'
import ComponentNode from './ComponentNode'
import { PALETTE_DRAG_TYPE } from './Palette'

// Declared once, outside the component: the library remounts every node if
// this object changes between renders.
const nodeTypes: NodeTypes = { component: ComponentNode }

// The size of a component, matching .component-node in styles.css.
const NODE_WIDTH = 180
const NODE_HEIGHT = 60

export default function Canvas() {
    const [nodes, setNodes, onNodesChange] = useNodesState<ComponentFlowNode>([])
    const { screenToFlowPosition } = useReactFlow()

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

    return (
        <div className="canvas">
            <ReactFlow
                nodes={nodes}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                onDrop={onDrop}
                onDragOver={onDragOver}
                snapToGrid
                snapGrid={[GRID_SIZE, GRID_SIZE]}
                deleteKeyCode={null}
                zoomOnDoubleClick={false}
                nodesConnectable={false}
                minZoom={0.2}
                maxZoom={2}
            >
                <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} color="#d1d5db" />
                <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1, padding: 0.2 }} />
            </ReactFlow>
        </div>
    )
}

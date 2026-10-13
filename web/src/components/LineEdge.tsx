import { BaseEdge, getSmoothStepPath, useStore } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { cornerPoints, roundedPath, shiftedRight } from '../../../src/shared/line-path'
import type { LineFlowEdge } from '../af-mapping'

// Half the gap between the two lines of a two-way pair.
const LANE = 5
const CORNER_RADIUS = 8

// The one kind of line on the canvas. It does not read `selected`: a selected
// line gets its look from the library's own class and the variables in styles.css.
export default function LineEdge({
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd
}: EdgeProps<LineFlowEdge>) {
    // True when a line runs the other way between the same two components.
    const twoWay: boolean = useStore((s) => s.edges.some((e) => e.source === target && e.target === source))
    // The library's own step route, with square corners so its points can be read.
    const [route] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 0
    })
    const points = cornerPoints(route)
    // A line with no partner stays centred on its dots. Each line of a pair
    // moves to the right of its own direction of travel, so the two are apart.
    // A route that doubles back on itself is not separated by this.
    const path: string = roundedPath(twoWay ? shiftedRight(points, LANE) : points, CORNER_RADIUS)
    return <BaseEdge path={path} markerEnd={markerEnd} />
}

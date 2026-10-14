// Pure geometry for a line drawn as right-angle steps. Shared by the server
// build and the page bundle, so this file imports nothing.

export interface Point {
    x: number
    y: number
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Box {
    x: number
    y: number
    width: number
    height: number
}

// The side of the box nearest to the point, by distance in pixels. On a tie
// the earlier of top, right, bottom, left wins, so the exact middle gives top.
export function nearestSide(point: Point, box: Box): Side {
    const distances: [Side, number][] = [
        ['top', Math.abs(point.y - box.y)],
        ['right', Math.abs(box.x + box.width - point.x)],
        ['bottom', Math.abs(box.y + box.height - point.y)],
        ['left', Math.abs(point.x - box.x)]
    ]
    let best: [Side, number] = distances[0]
    for (const entry of distances) {
        if (entry[1] < best[1]) {
            best = entry
        }
    }
    return best[0]
}

// The two sides that face each other for a line between two boxes of the same
// size, given their top-left positions. It compares the gaps between the boxes,
// not the centre distances, so two boxes that overlap on one axis do not get a
// line that doubles back. Ties go horizontal; the same position gives bottom to top.
export function facingSides(from: Point, to: Point, size: { width: number; height: number }): { source: Side; target: Side } {
    const dx: number = to.x - from.x
    const dy: number = to.y - from.y
    const gapX: number = Math.abs(dx) - size.width
    const gapY: number = Math.abs(dy) - size.height
    if (gapX >= gapY) {
        return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' }
    }
    return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' }
}

// The corner points of a path made of M, L and Q commands, as the canvas
// library gives for a step path with corner radius 0. Repeated points and
// points in the middle of a straight run are dropped; the two ends are kept.
export function cornerPoints(path: string): Point[] {
    const numbers: number[] = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    const all: Point[] = []
    for (let i = 0; i + 1 < numbers.length; i += 2) {
        const point: Point = { x: numbers[i], y: numbers[i + 1] }
        const last: Point | undefined = all[all.length - 1]
        if (last === undefined || last.x !== point.x || last.y !== point.y) {
            all.push(point)
        }
    }
    return all.filter((point, i) => {
        if (i === 0 || i === all.length - 1) {
            return true
        }
        const before: Point = all[i - 1]
        const after: Point = all[i + 1]
        return !(
            Math.sign(point.x - before.x) === Math.sign(after.x - point.x) &&
            Math.sign(point.y - before.y) === Math.sign(after.y - point.y)
        )
    })
}

// Moves a right-angle line sideways by `distance`, to the right of its
// direction of travel. A line and its reverse move to opposite sides, so the
// two lines of a two-way pair end up 2 x distance apart.
export function shiftedRight(points: readonly Point[], distance: number): Point[] {
    const normals: Point[] = []
    for (let i = 0; i + 1 < points.length; i += 1) {
        const dx: number = Math.sign(points[i + 1].x - points[i].x)
        const dy: number = Math.sign(points[i + 1].y - points[i].y)
        normals.push({ x: -dy, y: dx })
    }
    if (normals.length === 0) {
        return points.map((point) => ({ x: point.x, y: point.y }))
    }
    return points.map((point, i) => {
        const a: Point = normals[Math.max(0, i - 1)]
        const b: Point = normals[Math.min(normals.length - 1, i)]
        const same: boolean = a.x === b.x && a.y === b.y
        return {
            x: point.x + distance * (same ? a.x : a.x + b.x),
            y: point.y + distance * (same ? a.y : a.y + b.y)
        }
    })
}

// An SVG path through the points with each corner rounded. The radius is cut
// to half of the shorter neighbouring segment, so two corners never overlap.
export function roundedPath(points: readonly Point[], radius: number): string {
    if (points.length === 0) {
        return ''
    }
    let path: string = `M ${points[0].x},${points[0].y}`
    for (let i = 1; i + 1 < points.length; i += 1) {
        const before: Point = points[i - 1]
        const corner: Point = points[i]
        const after: Point = points[i + 1]
        const inLength: number = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y)
        const outLength: number = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y)
        const r: number = Math.min(radius, inLength / 2, outLength / 2)
        const start: Point = {
            x: corner.x - Math.sign(corner.x - before.x) * r,
            y: corner.y - Math.sign(corner.y - before.y) * r
        }
        const end: Point = {
            x: corner.x + Math.sign(after.x - corner.x) * r,
            y: corner.y + Math.sign(after.y - corner.y) * r
        }
        path += ` L ${start.x},${start.y} Q ${corner.x},${corner.y} ${end.x},${end.y}`
    }
    const last: Point = points[points.length - 1]
    if (points.length > 1) {
        path += ` L ${last.x},${last.y}`
    }
    return path
}

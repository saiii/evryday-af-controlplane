// The six component types. Shared by the server build and the page bundle,
// so this file imports nothing.
//
// The kebab id is the identifier everywhere. The label is for display only.
// The order is alphabetical by label, which is the order the palette shows.

export const COMPONENT_TYPES = [
    'agent',
    'flow-router',
    'incoming-gateway',
    'memory-mcp',
    'outgoing-gateway',
    'scheduler'
] as const

export type ComponentType = (typeof COMPONENT_TYPES)[number]

export interface CatalogueEntry {
    label: string
    colour: string
}

export const CATALOGUE: Record<ComponentType, CatalogueEntry> = {
    'agent': { label: 'Agent', colour: '#2563eb' },
    'flow-router': { label: 'Flow router', colour: '#7c3aed' },
    'incoming-gateway': { label: 'Incoming gateway', colour: '#16a34a' },
    'memory-mcp': { label: 'Memory MCP', colour: '#d97706' },
    'outgoing-gateway': { label: 'Outgoing gateway', colour: '#0891b2' },
    'scheduler': { label: 'Scheduler', colour: '#db2777' }
}

export function isComponentType(value: unknown): value is ComponentType {
    return typeof value === 'string' && (COMPONENT_TYPES as readonly string[]).includes(value)
}

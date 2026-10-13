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
    // The type as it reads inside a sentence, with its article.
    phrase: string
    // The types this type is allowed to send messages to.
    canSendTo: readonly ComponentType[]
}

export const CATALOGUE: Record<ComponentType, CatalogueEntry> = {
    'agent': { label: 'Agent', colour: '#2563eb', phrase: 'an agent', canSendTo: ['flow-router', 'memory-mcp'] },
    'flow-router': { label: 'Flow router', colour: '#7c3aed', phrase: 'a flow router', canSendTo: ['agent', 'outgoing-gateway'] },
    'incoming-gateway': { label: 'Incoming gateway', colour: '#16a34a', phrase: 'an incoming gateway', canSendTo: ['flow-router'] },
    'memory-mcp': { label: 'Memory MCP', colour: '#d97706', phrase: 'a Memory MCP', canSendTo: [] },
    'outgoing-gateway': { label: 'Outgoing gateway', colour: '#0891b2', phrase: 'an outgoing gateway', canSendTo: [] },
    'scheduler': { label: 'Scheduler', colour: '#db2777', phrase: 'a scheduler', canSendTo: ['flow-router'] }
}

export function isComponentType(value: unknown): value is ComponentType {
    return typeof value === 'string' && (COMPONENT_TYPES as readonly string[]).includes(value)
}

// True when the rule table allows a line from the first type to the second.
export function canSend(from: ComponentType, to: ComponentType): boolean {
    return CATALOGUE[from].canSendTo.includes(to)
}

// Upper-cases the first character only, so the rest of a phrase such as
// 'a Memory MCP' is kept as written.
function capitalised(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

// The sentence shown when the rule table refuses a line from one type to
// another. It is built from the table alone, so no component name is in it.
export function ruleRefusal(from: ComponentType, to: ComponentType): string {
    const source: CatalogueEntry = CATALOGUE[from]
    const subject: string = capitalised(source.phrase)
    if (source.canSendTo.length === 0) {
        return `${subject} cannot send to anything.`
    }
    const allowed: string = source.canSendTo.map((type) => CATALOGUE[type].label).join(', ')
    return `${subject} cannot send to ${CATALOGUE[to].phrase}. ${subject} may connect to: ${allowed}.`
}

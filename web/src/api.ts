// Small helpers for reading the server's answers, shared by the file bar and
// the settings panel.

export const UNREACHABLE: string = 'Cannot reach the server.'

// The sentence in the body of a refusal, or the fallback when the body has none.
export async function errorFrom(response: Response, fallback: string): Promise<string> {
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
export async function bodyFrom(response: Response): Promise<unknown> {
    try {
        return (await response.json()) as unknown
    } catch {
        return undefined
    }
}

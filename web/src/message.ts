// The one message bar at the top of the canvas, shared by line refusals and
// file messages (D-19). It holds plain text only; the bar renders it as a
// React child, so a name echoed by the server stays inert.

import { useCallback, useEffect, useRef, useState } from 'react'

// error is red with a mark and role=alert; info is neutral grey with role=status.
export type MessageKind = 'error' | 'info'

// key is new for every message shown, so the same text shown twice is a new
// message and gets its own 5 seconds.
export interface BarMessage {
    text: string
    kind: MessageKind
    key: number
}

export type ShowMessage = (text: string, kind: MessageKind) => void

// How long a message stays before it goes away by itself.
export const MESSAGE_MS = 5000

// The message state for the bar. showMessage replaces whatever is showing and
// starts a fresh timer; clearMessage removes it at once. Both are stable.
export function useMessageBar(): { message: BarMessage | null; showMessage: ShowMessage; clearMessage: () => void } {
    const [message, setMessage] = useState<BarMessage | null>(null)
    // Only grows. Read outside the updater, so StrictMode's second run of an
    // updater cannot skip a number.
    const nextKey = useRef<number>(1)

    const showMessage: ShowMessage = useCallback((text: string, kind: MessageKind) => {
        const key: number = nextKey.current
        nextKey.current += 1
        setMessage({ text, kind, key })
    }, [])

    const clearMessage = useCallback(() => {
        setMessage(null)
    }, [])

    // Keyed on the message object: every new message, even with the same text,
    // starts its own timer, and the old timer is cleared.
    useEffect(() => {
        if (message === null) {
            return
        }
        const timer = window.setTimeout(() => setMessage(null), MESSAGE_MS)
        return () => {
            window.clearTimeout(timer)
        }
    }, [message])

    return { message, showMessage, clearMessage }
}

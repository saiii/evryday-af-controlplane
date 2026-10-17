// The component's SKILL.md (Agent Skills format) and its brief (D-12, D-13).
// The page never parses YAML: the server checks the text (POST
// /api/skill-check) and answers with the description, the warnings and the
// problem. Everything is shown as text only, never rendered as Markdown or HTML.
// Nothing here asks for or lists secrets (D-16): they are only prose in the file.

import { useEffect, useRef, useState } from 'react'
import { starterSkill } from '../../../src/shared/component-settings'
import type { FolderEntry, FolderStore } from '../folder-store'

function sentence(fragment: string): string {
    return `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}.`
}

type Check = { problem: string | null; description: string | null; warnings: string[] }

// The answer of POST /api/skill-check, or null when it does not have the
// expected shape.
function checkFrom(body: unknown): Check | null {
    if (typeof body !== 'object' || body === null) {
        return null
    }
    const b = body as Record<string, unknown>
    const description: unknown = b.description
    const problem: unknown = b.problem
    const warnings: unknown = b.warnings
    if (description !== null && typeof description !== 'string') {
        return null
    }
    if (problem !== null && typeof problem !== 'string') {
        return null
    }
    if (!Array.isArray(warnings) || !warnings.every((w) => typeof w === 'string')) {
        return null
    }
    return { problem, description, warnings: warnings as string[] }
}

// The folder has not been read yet: nothing staged, and the load is still
// going (or has not started).
function pending(entry: FolderEntry): boolean {
    return entry.skill === null && (entry.load === 'idle' || entry.load === 'loading')
}

// The check the panel stands on: the staged one, else the loaded one.
function shownCheck(entry: FolderEntry): Check {
    if (entry.skill !== null) {
        return { problem: entry.skill.problem, description: entry.skill.description, warnings: entry.skill.warnings }
    }
    const loaded = entry.loaded
    if (loaded !== null && loaded.exists && loaded.skillText !== null) {
        return { problem: loaded.problem, description: loaded.description, warnings: loaded.warnings }
    }
    return { problem: null, description: null, warnings: [] }
}

type SectionProps = { nodeId: string; folders: FolderStore }

// The description from the frontmatter, shown at the top of the panel (D-13).
export function SkillBrief({ nodeId, folders }: SectionProps) {
    useEffect(() => {
        folders.ensureLoaded(nodeId)
    }, [nodeId, folders.version, folders])

    const entry: FolderEntry = folders.entry(nodeId)
    const description: string | null = shownCheck(entry).description

    let body
    if (pending(entry)) {
        body = <div className="settings-note-muted">Loading…</div>
    } else if (description !== null && description !== '') {
        body = <div className="settings-brief-text">{description}</div>
    } else {
        body = <div className="settings-note-muted">No description yet. Add one as description: in the frontmatter.</div>
    }
    return (
        <div className="settings-brief">
            <div className="settings-label">Brief</div>
            {body}
        </div>
    )
}

export function SkillSection({ nodeId, name, folders }: SectionProps & { name: string }) {
    useEffect(() => {
        folders.ensureLoaded(nodeId)
    }, [nodeId, folders.version, folders])

    const entry: FolderEntry = folders.entry(nodeId)
    const staged = entry.skill
    const loaded = entry.loaded
    const failed: boolean = staged === null && entry.load === 'failed'
    const loading: boolean = pending(entry)
    const noFolder: boolean = staged === null && entry.load === 'loaded' && loaded !== null && !loaded.exists

    // The text the section stands on until the user types.
    let source: string
    if (staged !== null) {
        source = staged.text
    } else if (loaded !== null && loaded.exists && loaded.skillText !== null) {
        source = loaded.skillText
    } else {
        source = starterSkill(name)
    }

    const [draft, setDraft] = useState<string>('')
    // Set only by onChange (research Pitfall 8): the file is never marked dirty
    // by comparing texts, so a CRLF file is not rewritten on an unchanged save.
    const touched = useRef<boolean>(false)
    const request = useRef<number>(0)
    const [checkFailed, setCheckFailed] = useState<boolean>(false)

    // A Save or an Open cleared the staging: follow the source again.
    useEffect(() => {
        if (folders.entry(nodeId).skill === null) {
            touched.current = false
        }
    }, [folders.version, folders, nodeId])

    const check: Check = shownCheck(entry)
    const readOnly: boolean = loading || failed
    // Never show a draft that is no longer staged.
    const value: string = touched.current && staged !== null ? draft : source

    const onChange = (text: string) => {
        setDraft(text)
        touched.current = true
        setCheckFailed(false)
        // Staged at once, so a Save straight after typing sends this text. A
        // stale problem never blocks a fixed text; Save checks it again.
        const now: Check = shownCheck(folders.entry(nodeId))
        folders.setSkill(nodeId, text, { problem: null, description: now.description, warnings: now.warnings })
    }

    const onBlur = () => {
        // The window lost focus, not the textarea: nothing ends.
        if (!document.hasFocus() || !touched.current) {
            return
        }
        request.current += 1
        const mine: number = request.current
        const sent: string = draft
        void (async () => {
            let answer: Check | null = null
            try {
                const response: Response = await fetch('/api/skill-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ component: name, text: sent })
                })
                if (response.ok) {
                    answer = checkFrom((await response.json()) as unknown)
                }
            } catch {
                answer = null
            }
            // A later edit, check, Save or Open wins: the answer is dropped.
            if (request.current !== mine || folders.entry(nodeId).skill?.text !== sent) {
                return
            }
            if (answer === null) {
                setCheckFailed(true)
                return
            }
            setCheckFailed(false)
            folders.setSkill(nodeId, sent, answer)
        })()
    }

    return (
        <div className="settings-field">
            <label className="settings-label" htmlFor={`skill-${nodeId}`}>
                SKILL.md
            </label>
            {loading && <div className="settings-note-muted">Loading…</div>}
            {failed && (
                <div className="settings-note-row">
                    <span className="settings-note-error">{`Cannot read the folder of ${name}.`}</span>
                    <button type="button" className="settings-button" onClick={() => folders.retryLoad(nodeId)}>
                        Try again
                    </button>
                </div>
            )}
            {noFolder && (
                <div className="settings-note-muted">No SKILL.md yet: this starter is written when you save.</div>
            )}
            <textarea
                id={`skill-${nodeId}`}
                className="settings-skill"
                spellCheck={false}
                rows={16}
                readOnly={readOnly}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onBlur}
            />
            {checkFailed && (
                <div className="settings-note-muted">The SKILL.md could not be checked; the server checks it again when you save.</div>
            )}
            {check.problem !== null && <div className="settings-note-error">{sentence(check.problem)}</div>}
            {check.warnings.map((w, i) => (
                <div key={i} className="settings-note-warning">
                    {sentence(w)}
                </div>
            ))}
        </div>
    )
}

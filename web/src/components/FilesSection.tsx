// The extra files in the component folder (scripts, config): added, edited,
// uploaded and removed here, and written only by the header Save (D-02, D-12).
// The checks here use the server's rules and words as a courtesy; the server
// checks everything again on save (D-15). File content is shown as text only:
// never as a link, an image or HTML.

import { useEffect, useRef, useState } from 'react'
import {
    filePathProblem,
    MAX_FILE_BYTES,
    MAX_FILE_SIZE_TEXT,
    MAX_FOLDER_BYTES,
    MAX_FOLDER_FILES,
    MAX_FOLDER_SIZE_TEXT,
    pathsProblem,
    SKILL_FILE,
    textByteLength
} from '../../../src/shared/component-settings'
import type { FolderEntry, FolderStore, StagedFile } from '../folder-store'

function sentence(fragment: string): string {
    return `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}.`
}

function sizeText(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

type Row = {
    path: string
    size: number
    // The text to edit, or null for a binary file.
    text: string | null
    state: 'new' | 'changed' | 'removed' | null
    // The file is on disk (it was in the loaded listing).
    onDisk: boolean
}

function rowsOf(entry: FolderEntry): Row[] {
    const rows: Map<string, Row> = new Map()
    for (const f of entry.loaded?.files ?? []) {
        if (f.path === SKILL_FILE) {
            continue
        }
        rows.set(f.path, { path: f.path, size: f.size, text: f.text, state: null, onDisk: true })
    }
    for (const [path, staged] of entry.files) {
        const before: Row | undefined = rows.get(path)
        const onDisk: boolean = before !== undefined
        if (staged.kind === 'remove') {
            if (before !== undefined) {
                rows.set(path, { ...before, state: 'removed' })
            }
            continue
        }
        const state: Row['state'] = onDisk ? 'changed' : 'new'
        if (staged.kind === 'text') {
            rows.set(path, { path, size: textByteLength(staged.text), text: staged.text, state, onDisk })
        } else {
            rows.set(path, { path, size: staged.size, text: null, state, onDisk })
        }
    }
    return [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// The bytes of SKILL.md as it would be saved, or 0 when there is none yet.
function skillBytes(entry: FolderEntry): number {
    if (entry.skill !== null) {
        return textByteLength(entry.skill.text)
    }
    const text: string | null | undefined = entry.loaded?.skillText
    return typeof text === 'string' ? textByteLength(text) : 0
}

// Built in chunks, so a large file does not overflow the argument list.
function toBase64(bytes: Uint8Array): string {
    let binary: string = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
}

// Text when the bytes are UTF-8 with no NUL byte, otherwise base64. A BOM is
// kept in the text, as on the server, so the stored bytes match the upload.
function stagedFromBytes(bytes: Uint8Array): StagedFile {
    if (!bytes.includes(0)) {
        try {
            const text: string = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
            return { kind: 'text', text }
        } catch {
            // Not UTF-8: sent as base64.
        }
    }
    return { kind: 'base64', base64: toBase64(bytes), size: bytes.length }
}

function readBytes(file: File): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
                resolve(new Uint8Array(reader.result))
            } else {
                reject(new Error('not read'))
            }
        }
        reader.onerror = () => reject(new Error('not read'))
        reader.readAsArrayBuffer(file)
    })
}

type Props = { nodeId: string; name: string; folders: FolderStore }

type EditorProps = Props & { path: string; base: string; staged: boolean; onClose: () => void }

function FileEditor({ nodeId, folders, path, base, staged, onClose }: EditorProps) {
    const [draft, setDraft] = useState<string>('')
    const touched = useRef<boolean>(false)

    // A Save or an Open cleared the staging: follow the file again.
    useEffect(() => {
        if (!staged) {
            touched.current = false
        }
    }, [staged, folders.version])

    const value: string = touched.current && staged ? draft : base
    const tooLarge: boolean = textByteLength(value) > MAX_FILE_BYTES

    return (
        <div className="settings-field">
            <div className="settings-note-row">
                <label className="settings-label settings-path" htmlFor={`file-${nodeId}`}>
                    {path}
                </label>
                <button type="button" className="settings-button" onClick={onClose}>
                    Close
                </button>
            </div>
            <textarea
                id={`file-${nodeId}`}
                className="settings-skill"
                spellCheck={false}
                rows={12}
                value={value}
                onChange={(event) => {
                    const text: string = event.target.value
                    setDraft(text)
                    touched.current = true
                    // Staged at once, so the text survives a Save straight after
                    // typing and the panel remounting on another selection.
                    folders.stageFile(nodeId, path, { kind: 'text', text })
                }}
            />
            {tooLarge && <div className="settings-note-error">{`${path} is larger than ${MAX_FILE_SIZE_TEXT}.`}</div>}
        </div>
    )
}

export default function FilesSection({ nodeId, name, folders }: Props) {
    const [path, setPath] = useState<string>('')
    const [problem, setProblem] = useState<string | null>(null)
    const [editing, setEditing] = useState<string | null>(null)
    const fileInput = useRef<HTMLInputElement>(null)

    const entry: FolderEntry = folders.entry(nodeId)
    const rows: Row[] = rowsOf(entry)
    const ready: boolean = entry.load === 'loaded'
    const editRow: Row | undefined = editing === null ? undefined : rows.find((r) => r.path === editing)

    // The problem with adding a file at this path, or null.
    const pathProblemOf = (p: string): string | null => {
        if (p === SKILL_FILE) {
            return 'Edit SKILL.md in the box above.'
        }
        const own: string | null = filePathProblem(p)
        if (own !== null) {
            return `The path ${own}.`
        }
        if (rows.some((r) => r.path === p)) {
            return `${p} is already in the folder.`
        }
        const kept: string[] = rows.filter((r) => r.state !== 'removed').map((r) => r.path)
        const clash: string | null = pathsProblem([...kept, SKILL_FILE, p])
        return clash === null ? null : sentence(clash)
    }

    // The problem with adding a file of this size to the folder, or null.
    const totalsProblemOf = (size: number): string | null => {
        const kept: Row[] = rows.filter((r) => r.state !== 'removed')
        if (kept.length + 2 > MAX_FOLDER_FILES) {
            return `The folder of ${name} can hold at most ${MAX_FOLDER_FILES} files.`
        }
        const total: number = kept.reduce((sum, r) => sum + r.size, 0) + skillBytes(entry) + size
        if (total > MAX_FOLDER_BYTES) {
            return `The folder of ${name} can hold at most ${MAX_FOLDER_SIZE_TEXT}.`
        }
        return null
    }

    const addText = () => {
        const found: string | null = pathProblemOf(path) ?? totalsProblemOf(0)
        setProblem(found)
        if (found !== null) {
            return
        }
        folders.stageFile(nodeId, path, { kind: 'text', text: '' })
        setEditing(path)
        setPath('')
    }

    const upload = (file: File) => {
        const target: string = path !== '' ? path : file.name
        let found: string | null = pathProblemOf(target)
        if (found === null && file.size > MAX_FILE_BYTES) {
            found = `${file.name} is larger than ${MAX_FILE_SIZE_TEXT}.`
        }
        if (found === null) {
            found = totalsProblemOf(file.size)
        }
        setProblem(found)
        if (found !== null) {
            return
        }
        void readBytes(file).then(
            (bytes) => {
                folders.stageFile(nodeId, target, stagedFromBytes(bytes))
                setPath('')
            },
            () => setProblem(`Cannot read ${file.name}.`)
        )
    }

    const remove = (row: Row) => {
        if (row.onDisk) {
            folders.stageFile(nodeId, row.path, { kind: 'remove' })
        } else {
            folders.unstageFile(nodeId, row.path)
        }
        if (editing === row.path) {
            setEditing(null)
        }
    }

    const skipped: number = entry.loaded?.skipped ?? 0

    return (
        <div className="settings-field">
            <div className="settings-label">Files</div>
            {rows.length === 0 && <div className="settings-note-muted">No other files in the folder.</div>}
            {rows.length > 0 && (
                <ul className="settings-files">
                    {rows.map((row) => (
                        <li key={row.path} className="settings-file">
                            <span className="settings-file-path" title={row.path}>
                                {row.path}
                            </span>
                            <span className="settings-note-muted">{sizeText(row.size)}</span>
                            {row.state !== null && (
                                <span className="settings-note-muted">
                                    {row.state === 'removed' ? 'removed when you save' : row.state}
                                </span>
                            )}
                            {row.state === 'removed' ? (
                                <button
                                    type="button"
                                    className="settings-button"
                                    onClick={() => folders.unstageFile(nodeId, row.path)}
                                >
                                    Keep
                                </button>
                            ) : (
                                <>
                                    {row.text !== null && (
                                        <button type="button" className="settings-button" onClick={() => setEditing(row.path)}>
                                            Edit
                                        </button>
                                    )}
                                    <button type="button" className="settings-button" onClick={() => remove(row)}>
                                        Remove
                                    </button>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {skipped > 0 && (
                <div className="settings-note-muted">
                    {`${skipped} file(s) are not shown: names starting with ., links, or files over the limits.`}
                </div>
            )}
            <div className="settings-add">
                <input
                    type="text"
                    className="settings-input"
                    placeholder="scripts/run.sh"
                    value={path}
                    disabled={!ready}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(event) => {
                        setPath(event.target.value)
                        setProblem(null)
                    }}
                />
                <div className="settings-note-row">
                    <button type="button" className="settings-button" disabled={!ready} onClick={addText}>
                        New text file
                    </button>
                    <button
                        type="button"
                        className="settings-button"
                        disabled={!ready}
                        onClick={() => fileInput.current?.click()}
                    >
                        Upload…
                    </button>
                    <input
                        ref={fileInput}
                        type="file"
                        hidden
                        onChange={(event) => {
                            const file: File | undefined = event.target.files?.[0]
                            if (file !== undefined) {
                                upload(file)
                            }
                            event.target.value = ''
                        }}
                    />
                </div>
            </div>
            {problem !== null && <div className="settings-note-error">{problem}</div>}
            {editRow !== undefined && editRow.text !== null && editRow.state !== 'removed' && (
                <FileEditor
                    key={editRow.path}
                    nodeId={nodeId}
                    name={name}
                    folders={folders}
                    path={editRow.path}
                    base={editRow.text}
                    staged={entry.files.get(editRow.path)?.kind === 'text'}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    )
}

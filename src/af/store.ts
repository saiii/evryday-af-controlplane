// The low-level code that touches the data directory: list the saved files,
// the guarded read of one file and the atomic write of one file. folders.ts
// builds the component folder logic on these. It knows nothing about HTTP;
// the caller turns a null or a thrown error into an answer.

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, rm } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { byCodeUnit, NAME_PATTERN } from '../shared/af-document'
import { MAX_FILE_BYTES, MAX_FILE_SIZE_TEXT } from '../shared/component-settings'

// A file larger than MAX_FILE_BYTES is refused on open before it is read, and
// a save that would write a larger file is refused, so every saved file opens
// again. The limits live in the shared rules; they are re-exported here so the
// routes keep importing them from the store.
export { MAX_FILE_BYTES, MAX_FILE_SIZE_TEXT }

export class FileTooLargeError extends Error {
    constructor(file: string) {
        super(`${file} is larger than ${MAX_FILE_BYTES} bytes`)
        this.name = 'FileTooLargeError'
    }
}

// The full path of <name>.af in the data directory. Throws for a name that is
// not a plain name (guard 1), and for a path that would land outside the
// directory (guard 2, belt and braces: guard 1 already rules it out).
export function fileFor(dir: string, name: string): string {
    if (!NAME_PATTERN.test(name)) {
        throw new Error(`not a plain file name: ${JSON.stringify(name)}`)
    }
    const full: string = path.resolve(dir, `${name}.af`)
    if (path.dirname(full) !== path.resolve(dir)) {
        throw new Error(`${full} is outside ${path.resolve(dir)}`)
    }
    return full
}

// The names of the saved files, without .af, read from the directory on every
// call so a file copied in by hand shows up without a restart (D-06). Only
// regular files count: a symlink or a directory is not isFile(). Temp files
// begin with '.', so they never pass NAME_PATTERN.
export async function listNames(dir: string): Promise<string[]> {
    const entries: Dirent[] = await readdir(dir, { withFileTypes: true })
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.af'))
        .map((entry) => entry.name.slice(0, -'.af'.length))
        .filter((name) => NAME_PATTERN.test(name))
        .sort(byCodeUnit)
}

// The bytes of a file, or null when there is no such regular file (missing,
// a symlink or a directory). The file is opened once with O_NOFOLLOW, and the
// check and the read go through that one handle, so a file swapped for a link
// after the check can never be read. Throws FileTooLargeError above limit,
// also when the file grows after the size check.
export async function readBytes(file: string, limit: number): Promise<Buffer | null> {
    let handle: FileHandle
    try {
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch (error) {
        const code: string | undefined = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ELOOP' || code === 'EISDIR') {
            return null
        }
        throw error
    }
    try {
        const info: Stats = await handle.stat()
        if (!info.isFile()) {
            return null
        }
        if (info.size > limit) {
            throw new FileTooLargeError(file)
        }
        // Reads at most one byte more than the limit, so a file that grew
        // after the stat is still refused.
        const buffer: Buffer = Buffer.alloc(limit + 1)
        let length: number = 0
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
            if (bytesRead === 0) {
                break
            }
            length += bytesRead
        }
        if (length > limit) {
            throw new FileTooLargeError(file)
        }
        return buffer.subarray(0, length)
    } finally {
        await handle.close()
    }
}

// The text of <name>.af, or null when there is no such regular file. Throws
// FileTooLargeError above MAX_FILE_BYTES (see readBytes).
export async function readText(dir: string, name: string): Promise<string | null> {
    const bytes: Buffer | null = await readBytes(fileFor(dir, name), MAX_FILE_BYTES)
    return bytes === null ? null : bytes.toString('utf8')
}

// Writes a file through a temp file in the same folder, then renames it over
// the target. rename replaces a symlink itself, never its target, and a
// failure never leaves a half-written file (D-17). The temp file begins with
// '.', so it is never listed, and it is removed when anything fails.
export async function writeAtomicAt(file: string, data: string | Buffer): Promise<void> {
    const dir: string = path.dirname(file)
    const temp: string = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
    try {
        const handle: FileHandle = await open(temp, 'wx', 0o644)
        try {
            await handle.writeFile(data)
            await handle.sync()
        } finally {
            await handle.close()
        }
        await rename(temp, file)
    } catch (error) {
        await rm(temp, { force: true })
        throw error
    }
    await syncFolder(dir)
}

// Writes <name>.af atomically. The temp name .<name>.af.<pid>.<uuid>.tmp is
// the one TEMP_PATTERN matches.
export async function writeAtomic(dir: string, name: string, text: string): Promise<void> {
    await writeAtomicAt(fileFor(dir, name), text)
}

// Syncs the directory, so the rename survives a power loss. The file is
// already in place by then, so a failed sync is logged and the save still
// counts as done.
export async function syncFolder(dir: string): Promise<void> {
    let handle: FileHandle | undefined
    try {
        handle = await open(path.resolve(dir), constants.O_RDONLY)
        await handle.sync()
    } catch (error) {
        console.warn(`Cannot sync the folder ${path.resolve(dir)}:`, error)
    } finally {
        await handle?.close()
    }
}

// A temp file left by writeAtomic: .<name>.af.<pid>.<uuid>.tmp
const TEMP_PATTERN: RegExp = /^\.[a-z][a-z0-9-]{0,62}\.af\.\d+\.[0-9a-f-]{36}\.tmp$/

// A temp file older than this is taken to be left over from a crash. A save
// in progress takes far less, and another server may share the directory.
const STALE_TEMP_MS: number = 60 * 60 * 1000

// Removes the temp files a crashed save left behind, and returns how many
// were removed. Only regular files that match TEMP_PATTERN and are older than
// an hour are removed, so a save still in progress in another server that
// shares the directory is left alone.
export async function removeStaleTemps(dir: string): Promise<number> {
    const entries: Dirent[] = await readdir(dir, { withFileTypes: true })
    const now: number = Date.now()
    let removed: number = 0
    for (const entry of entries) {
        if (!entry.isFile() || !TEMP_PATTERN.test(entry.name)) {
            continue
        }
        const temp: string = path.join(path.resolve(dir), entry.name)
        try {
            const info: Stats = await lstat(temp)
            if (info.isFile() && now - info.mtimeMs > STALE_TEMP_MS) {
                await rm(temp, { force: true })
                removed += 1
            }
        } catch (error) {
            console.warn(`Cannot remove the temp file ${temp}:`, error)
        }
    }
    return removed
}

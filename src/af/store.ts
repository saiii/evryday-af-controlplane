// The only code that touches the data directory: list the saved files, read
// one, and write one atomically. It knows nothing about HTTP; the caller turns
// a null or a thrown error into an answer.

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir, rename, rm } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { byCodeUnit, NAME_PATTERN } from '../shared/af-document'

// A file larger than this is refused on open before it is read.
export const MAX_FILE_BYTES: number = 1024 * 1024

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

// The text of <name>.af, or null when there is no such regular file (missing,
// a symlink or a directory). The file is opened once with O_NOFOLLOW, and the
// check and the read go through that one handle, so a file swapped for a link
// after the check can never be read. Throws FileTooLargeError above
// MAX_FILE_BYTES, also when the file grows after the size check.
export async function readText(dir: string, name: string): Promise<string | null> {
    const file: string = fileFor(dir, name)
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
        if (info.size > MAX_FILE_BYTES) {
            throw new FileTooLargeError(file)
        }
        // Reads at most one byte more than the limit, so a file that grew
        // after the stat is still refused.
        const buffer: Buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
        let length: number = 0
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
            if (bytesRead === 0) {
                break
            }
            length += bytesRead
        }
        if (length > MAX_FILE_BYTES) {
            throw new FileTooLargeError(file)
        }
        return buffer.toString('utf8', 0, length)
    } finally {
        await handle.close()
    }
}

// Writes <name>.af through a temp file in the same directory, then renames it
// over the target. rename replaces a symlink itself, never its target, and a
// failure never leaves a half-written file (D-17). The temp file begins with
// '.', so it is never listed, and it is removed when anything fails.
export async function writeAtomic(dir: string, name: string, text: string): Promise<void> {
    const file: string = fileFor(dir, name)
    const temp: string = path.join(path.resolve(dir), `.${name}.af.${process.pid}.${randomUUID()}.tmp`)
    try {
        const handle: FileHandle = await open(temp, 'wx', 0o644)
        try {
            await handle.writeFile(text, 'utf8')
            await handle.sync()
        } finally {
            await handle.close()
        }
        await rename(temp, file)
    } catch (error) {
        await rm(temp, { force: true })
        throw error
    }
}

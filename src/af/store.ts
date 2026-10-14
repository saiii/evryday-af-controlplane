// The only code that touches the data directory: list the saved files, read
// one, and write one atomically. It knows nothing about HTTP; the caller turns
// a null or a thrown error into an answer.

import { randomUUID } from 'node:crypto'
import { lstat, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { NAME_PATTERN } from '../shared/af-document'

// A file larger than this is refused on open before it is read.
export const MAX_FILE_BYTES: number = 1024 * 1024

export class FileTooLargeError extends Error {
    constructor(file: string) {
        super(`${file} is larger than ${MAX_FILE_BYTES} bytes`)
        this.name = 'FileTooLargeError'
    }
}

// Code-unit order. Never localeCompare: collation can differ between machines.
function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
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
// a symlink or a directory). lstat does not follow a symlink, so a link can
// never be opened. Throws FileTooLargeError above MAX_FILE_BYTES.
export async function readText(dir: string, name: string): Promise<string | null> {
    const file: string = fileFor(dir, name)
    let info: Stats
    try {
        info = await lstat(file)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
        }
        throw error
    }
    if (!info.isFile()) {
        return null
    }
    if (info.size > MAX_FILE_BYTES) {
        throw new FileTooLargeError(file)
    }
    return readFile(file, 'utf8')
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

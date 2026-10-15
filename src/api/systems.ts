// The JSON API for saved files: list, open and save under /api/systems.
// Every name is checked here; the check on the page is only a courtesy (D-04).
// Every refusal is { error: <one sentence> }; details go to the server log only.

import express, { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { checkDocument, FILE_NAME_RULE, shownName } from '../shared/af-validate'
import type { CheckResult } from '../shared/af-validate'
import { NAME_PATTERN } from '../shared/af-document'
import { parseYaml, toYaml } from '../af/codec'
import type { Parsed } from '../af/codec'
import { FileTooLargeError, listNames, MAX_FILE_BYTES, MAX_FILE_SIZE_TEXT, readText, writeAtomic } from '../af/store'

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

function isLocalHostname(hostname: string | undefined): boolean {
    return hostname !== undefined && LOCAL_HOSTNAMES.includes(hostname)
}

function refuse(res: Response, status: number, error: string): void {
    res.status(status).json({ error })
}

// Refuses any request whose Host is not localhost, 127.0.0.1 or [::1] (any
// port), and any request whose Origin header names another host. This keeps a
// visited web page that rebinds its own hostname to 127.0.0.1 away from the
// files (DNS rebinding). It is not authentication. req.hostname drops the port
// and keeps IPv6 brackets; 'trust proxy' is off, so X-Forwarded-Host is ignored.
export function localOnly(req: Request, res: Response, next: NextFunction): void {
    if (!isLocalHostname(req.hostname)) {
        refuse(res, 403, 'Only requests to localhost are allowed.')
        return
    }
    const origin: string | string[] | undefined = req.headers.origin
    if (typeof origin === 'string') {
        let originHost: string | undefined
        try {
            originHost = new URL(origin).hostname
        } catch {
            originHost = undefined
        }
        if (!isLocalHostname(originHost)) {
            refuse(res, 403, 'Only requests to localhost are allowed.')
            return
        }
    }
    next()
}

// The three routes, reading and writing <dataDir>/<name>.af. main.ts owns the
// environment variable and passes the directory in.
export function systemsRouter(dataDir: string): Router {
    const router: Router = Router()

    router.get('/systems', async (req: Request, res: Response) => {
        let names: string[]
        try {
            names = await listNames(dataDir)
        } catch (error) {
            console.error(`Cannot list ${dataDir}:`, error)
            refuse(res, 500, 'Cannot list the saved files: the data folder cannot be read.')
            return
        }
        res.set('Cache-Control', 'no-store')
        res.json({ names })
    })

    router.get('/systems/:name', async (req: Request, res: Response) => {
        const name: string = String(req.params.name)
        if (!NAME_PATTERN.test(name)) {
            refuse(res, 400, `Cannot open ${shownName(name)}: ${FILE_NAME_RULE}.`)
            return
        }
        let text: string | null
        try {
            text = await readText(dataDir, name)
        } catch (error) {
            if (error instanceof FileTooLargeError) {
                refuse(res, 422, `Cannot open ${name}.af: the file is larger than ${MAX_FILE_SIZE_TEXT}.`)
                return
            }
            console.error(error)
            refuse(res, 500, `Cannot open ${name}.af: the file cannot be read.`)
            return
        }
        if (text === null) {
            refuse(res, 404, `Cannot open ${name}.af: there is no such file.`)
            return
        }
        const parsed: Parsed = parseYaml(text)
        if (!parsed.ok) {
            refuse(res, 422, `Cannot open ${name}.af: ${parsed.problem}.`)
            return
        }
        const checked: CheckResult = checkDocument(parsed.value)
        if ('problem' in checked) {
            refuse(res, 422, `Cannot open ${name}.af: ${checked.problem}.`)
            return
        }
        res.set('Cache-Control', 'no-store')
        res.json({ name, document: checked.doc })
    })

    // The request may be as large as a file that can be opened, so a large
    // hand-made file that opens can also be saved back.
    router.put('/systems/:name', express.json({ limit: MAX_FILE_BYTES }), async (req: Request, res: Response) => {
        const name: string = String(req.params.name)
        if (!NAME_PATTERN.test(name)) {
            refuse(res, 400, `Cannot save ${shownName(name)}: ${FILE_NAME_RULE}.`)
            return
        }
        if (!req.is('application/json') || req.body === undefined) {
            refuse(res, 415, `Cannot save ${name}.af: the request must be JSON.`)
            return
        }
        // Checked before anything is written, so a refused save leaves an
        // existing file as it was (D-17).
        const checked: CheckResult = checkDocument(req.body)
        if ('problem' in checked) {
            refuse(res, 422, `Cannot save ${name}.af: ${checked.problem}.`)
            return
        }
        // A file larger than the open limit would be saved but could never be
        // opened again, so it is refused before anything is written.
        const text: string = toYaml(checked.doc)
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
            refuse(res, 422, `Cannot save ${name}.af: the file would be larger than ${MAX_FILE_SIZE_TEXT}.`)
            return
        }
        try {
            await writeAtomic(dataDir, name, text)
        } catch (error) {
            console.error(`Cannot write ${name}.af in ${dataDir}:`, error)
            refuse(res, 500, `Cannot save ${name}.af: the data folder cannot be written.`)
            return
        }
        res.json({ name })
    })

    return router
}

// Any /api path the router did not answer.
export function apiNotFound(req: Request, res: Response): void {
    refuse(res, 404, 'There is no such API path.')
}

// Errors raised while reading a request (too large, not JSON) and anything
// unexpected. Four parameters, so Express treats it as an error handler. No
// stack or path goes to the client.
export function apiErrors(err: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err)
        return
    }
    const info: { type?: unknown; status?: unknown } =
        typeof err === 'object' && err !== null ? (err as { type?: unknown; status?: unknown }) : {}
    if (info.type === 'entity.too.large') {
        refuse(res, 413, `The canvas is too large to save: the request is larger than ${MAX_FILE_SIZE_TEXT}.`)
        return
    }
    if (info.type === 'entity.parse.failed') {
        refuse(res, 400, 'The request is not valid JSON.')
        return
    }
    if (typeof info.status === 'number' && info.status >= 400 && info.status <= 499) {
        refuse(res, info.status, 'The request could not be read.')
        return
    }
    console.error(err)
    refuse(res, 500, 'Something went wrong on the server.')
}

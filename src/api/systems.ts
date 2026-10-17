// The JSON API for saved files: list, open and save under /api/systems.
// Every name is checked here; the check on the page is only a courtesy (D-04).
// Every refusal is { error: <one sentence> }; details go to the server log only.

import express, { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { checkDocument, FILE_NAME_RULE, isMapping, shownName } from '../shared/af-validate'
import type { CheckResult } from '../shared/af-validate'
import { NAME_PATTERN } from '../shared/af-document'
import { parseYaml, toYaml } from '../af/codec'
import type { Parsed } from '../af/codec'
import { FileTooLargeError, listNames, MAX_FILE_BYTES, MAX_FILE_SIZE_TEXT, readText } from '../af/store'
import { MAX_SAVE_BODY_BYTES, MAX_SAVE_BODY_TEXT } from '../shared/component-settings'
import { checkSaveEnvelope, readFolder, saveDesign, SaveFailedError, SaveRefusedError } from '../af/folders'
import type { FolderRead, SaveRequest, SaveResult } from '../af/folders'
import { checkSkill } from '../af/skill'

// The skill-check body may be larger than the 1 MB SKILL.md limit, as JSON
// escaping can make the text longer; checkSkill still applies the 1 MB limit.
const MAX_SKILL_CHECK_BODY_BYTES: number = 2 * 1024 * 1024

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

// The routes, reading and writing <dataDir>/<name>.af and its component
// folders <dataDir>/<name>.components/<component>/. main.ts owns the
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
        // Opening never writes: a version 1 file is upgraded in memory only and
        // the answer says so with upgradedFrom (D-20).
        res.set('Cache-Control', 'no-store')
        res.json({
            name,
            document: checked.doc,
            ...(checked.upgradedFrom !== undefined && { upgradedFrom: checked.upgradedFrom }),
        })
    })

    // One component folder, read-only. File content goes out only inside this
    // JSON answer. A file is never served raw (no per-file URL, no raw file answer, no
    // static route over the data folder), because an uploaded HTML or SVG file
    // would then run as the designer page (research Pitfall 9). No file path
    // is ever taken from the URL; only the two names, both checked.
    router.get('/systems/:design/components/:component', async (req: Request, res: Response) => {
        const design: string = String(req.params.design)
        const component: string = String(req.params.component)
        for (const x of [design, component]) {
            if (!NAME_PATTERN.test(x)) {
                refuse(res, 400, `Cannot open ${shownName(x)}: ${FILE_NAME_RULE}.`)
                return
            }
        }
        let folder: FolderRead
        try {
            folder = await readFolder(dataDir, design, component)
        } catch (error) {
            if (error instanceof SaveRefusedError) {
                refuse(res, 422, `Cannot read the folder of ${component}: ${error.problem}.`)
                return
            }
            console.error(`Cannot read the folder of ${component} in ${design}:`, error)
            refuse(res, 500, `Cannot read the folder of ${component}: it cannot be read.`)
            return
        }
        res.set('Cache-Control', 'no-store')
        res.json({ design, component, ...folder })
    })

    // Checks a SKILL.md text for the live brief in the settings panel. It
    // touches no disk (D-13).
    router.post('/skill-check', express.json({ limit: MAX_SKILL_CHECK_BODY_BYTES }), (req: Request, res: Response) => {
        if (!req.is('application/json') || req.body === undefined) {
            refuse(res, 415, 'Cannot check the SKILL.md: the request must be JSON.')
            return
        }
        const body: unknown = req.body
        if (!isMapping(body)) {
            refuse(res, 422, 'Cannot check the SKILL.md: the request needs component and text.')
            return
        }
        const component: unknown = Object.hasOwn(body, 'component') ? body.component : undefined
        const text: unknown = Object.hasOwn(body, 'text') ? body.text : undefined
        if (typeof component !== 'string' || typeof text !== 'string') {
            refuse(res, 422, 'Cannot check the SKILL.md: the request needs component and text.')
            return
        }
        if (!NAME_PATTERN.test(component)) {
            refuse(res, 400, `Cannot check the SKILL.md: ${FILE_NAME_RULE}.`)
            return
        }
        res.set('Cache-Control', 'no-store')
        res.json(checkSkill(text, component))
    })

    // The request carries the canvas and the staged folder edits:
    // { document, source?, components? }. Nothing is written until everything
    // is checked; the request is checked here, not only on the page, so the
    // same rules hold for any client (D-03, D-14, D-15).
    router.put('/systems/:name', express.json({ limit: MAX_SAVE_BODY_BYTES }), async (req: Request, res: Response) => {
        const name: string = String(req.params.name)
        if (!NAME_PATTERN.test(name)) {
            refuse(res, 400, `Cannot save ${shownName(name)}: ${FILE_NAME_RULE}.`)
            return
        }
        if (!req.is('application/json') || req.body === undefined) {
            refuse(res, 415, `Cannot save ${name}.af: the request must be JSON.`)
            return
        }
        const checked: { request: SaveRequest } | { problem: string } = checkSaveEnvelope(req.body, name)
        if ('problem' in checked) {
            refuse(res, 422, `Cannot save ${name}.af: ${checked.problem}.`)
            return
        }
        const request: SaveRequest = checked.request
        // A file larger than the open limit would be saved but could never be
        // opened again, so it is refused before anything is written.
        const text: string = toYaml(request.doc)
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
            refuse(res, 422, `Cannot save ${name}.af: the file would be larger than ${MAX_FILE_SIZE_TEXT}.`)
            return
        }
        let result: SaveResult
        try {
            result = await saveDesign(dataDir, request, text)
        } catch (error) {
            if (error instanceof SaveRefusedError) {
                refuse(res, 422, `Cannot save ${name}.af: ${error.problem}.`)
                return
            }
            if (error instanceof SaveFailedError) {
                console.error(`Save of ${name}.af in ${dataDir} failed:`, error)
                refuse(res, 500, error.sentence)
                return
            }
            console.error(`Cannot write ${name}.af in ${dataDir}:`, error)
            refuse(res, 500, `Cannot save ${name}.af: the data folder cannot be written.`)
            return
        }
        res.json({ name, warnings: result.warnings, removed: result.removed, renamed: result.renamed })
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
        // The sentence fits the route the body was sent to (research Pitfall 11).
        if (req.method === 'PUT' && req.path.startsWith('/systems/')) {
            refuse(res, 413, `Cannot save: the canvas and its files are larger than ${MAX_SAVE_BODY_TEXT}.`)
        } else if (req.path === '/skill-check') {
            refuse(res, 413, 'Cannot check the SKILL.md: it is too large.')
        } else {
            refuse(res, 413, 'The request is too large.')
        }
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

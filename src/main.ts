import express, { Application, Request, Response } from 'express'
import { existsSync, mkdirSync } from 'fs'
import { Server } from 'http'
import path from 'path'
import { apiErrors, apiNotFound, localOnly, systemsRouter } from './api/systems'
import { drainSaves, findLeftoverSaves } from './af/folders'
import { removeStaleTemps } from './af/store'

const service: string = "evryday-af-controlplane"
const publicDir: string = path.resolve(__dirname, '../public')
const pageBuilt: boolean = existsSync(path.join(publicDir, 'index.html'))

const port: string = process.env.PORT || "3000"
const dataDir: string = path.resolve(process.env.AF_DATA_DIR || "data")

try {
    mkdirSync(dataDir, { recursive: true })
    console.log(`Saving files in ${dataDir}`)
} catch (error) {
    // The error says why, such as EACCES or ENOTDIR.
    console.warn(`Cannot create the folder ${dataDir}; saving will fail until it exists:`, error)
}

// Temp files from a save that crashed are removed once, at start.
removeStaleTemps(dataDir).then(
    (removed: number) => {
        if (removed > 0) {
            console.log(`Removed ${removed} left-over temp ${removed === 1 ? 'file' : 'files'} from ${dataDir}`)
        }
    },
    (error: unknown) => {
        console.warn(`Cannot look for left-over temp files in ${dataDir}:`, error)
    }
)

// The undo folder of a save that was cut off may hold the only copy of a
// removed component folder, so it is only logged at start, never deleted.
findLeftoverSaves(dataDir).then(
    (paths: string[]) => {
        for (const p of paths) {
            console.warn(`A save was interrupted: ${p} may hold the only copy of a removed component folder, so it is kept`)
        }
    },
    (error: unknown) => {
        console.warn(`Cannot look for left-over saves in ${dataDir}:`, error)
    }
)

const app: Application = express()

app.get('/hello', (req: Request, res: Response) => {
    res.json({ message: "hello", service: service })
})

app.use('/api', localOnly, systemsRouter(dataDir), apiNotFound, apiErrors)

if (pageBuilt) {
    console.log(`Serving the designer page from ${publicDir}`)
    app.use(express.static(publicDir))
} else {
    console.log(`Designer page is not built (no index.html in ${publicDir}); in dev it is served on http://localhost:5173`)
    app.get('/', (req: Request, res: Response) => {
        res.type('text/plain').send("The designer page is not built. In dev, open http://localhost:5173\n")
    })
}

const server: Server = app.listen(parseInt(port), () => {
    console.log(`Server ${service} is running on http://localhost:${port}`)
})

// Node is PID 1 in the container, so the kernel does not apply the default
// action for SIGINT and SIGTERM; the process must handle them itself.
let shuttingDown: boolean = false

const shutdown = (signal: string): void => {
    if (shuttingDown) {
        return
    }
    shuttingDown = true
    console.log(`Received ${signal}; shutting down`)
    // No new connections; idle keep-alive ones are closed at once.
    server.close()
    server.closeIdleConnections()
    // A save that has begun to move folders must finish (or roll back) before
    // the process ends, else component folders stay in the undo folder while
    // the old .af still names them. Its answer is still sent when it can be.
    void drainSaves().finally(() => {
        // A moment for the last answer to leave before the sockets close.
        setTimeout(() => {
            server.closeAllConnections()
            process.exit(0)
        }, 100)
    })
    // A stuck save cannot hold the exit forever; this stays under the
    // 10-second grace period of podman and docker stop.
    setTimeout(() => {
        console.error('A save did not finish within 8 seconds; exiting anyway')
        process.exit(1)
    }, 8000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

import express, { Application, Request, Response } from 'express'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { apiErrors, apiNotFound, localOnly, systemsRouter } from './api/systems'
import { removeStaleTemps } from './af/store'

const service: string = "evryday-af-controlplane"
const publicDir: string = path.resolve(__dirname, '../public')
const pageBuilt: boolean = existsSync(path.join(publicDir, 'index.html'))

const port: string = process.env.PORT || "3000"
const dataDir: string = path.resolve(process.env.AF_DATA_DIR || "data")

try {
    mkdirSync(dataDir, { recursive: true })
    console.log(`Saving files in ${dataDir}`)
} catch {
    console.warn(`Cannot create the folder ${dataDir}; saving will fail until it exists`)
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

app.listen(parseInt(port), () => {
    console.log(`Server ${service} is running on http://localhost:${port}`)
})

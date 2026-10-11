import express, { Application, Request, Response } from 'express'
import { existsSync } from 'fs'
import path from 'path'

const service: string = "evryday-af-controlplane"
const publicDir: string = path.resolve(__dirname, '../public')
const pageBuilt: boolean = existsSync(path.join(publicDir, 'index.html'))

const port: string = process.env.PORT || "3000"
const app: Application = express()

app.get('/hello', (req: Request, res: Response) => {
    res.json({ message: "hello", service: service })
})

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

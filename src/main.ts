import express, { Application, Request, Response } from 'express'

const service: string = "evryday-af-controlplane"

const port: string = process.env.PORT || "3000"
const app: Application = express()

app.get('/hello', (req: Request, res: Response) => {
    res.json({ message: "hello", service: service })
})

app.listen(parseInt(port), () => {
    console.log(`Server ${service} is running on http://localhost:${port}`)
})

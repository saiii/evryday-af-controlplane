import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: '../dist/public',
        emptyOutDir: true
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            '/hello': 'http://localhost:3000',
            '/api': 'http://localhost:3000'
        }
    }
})

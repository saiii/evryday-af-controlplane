import { ReactFlowProvider } from '@xyflow/react'
import Canvas from './components/Canvas'
import Palette from './components/Palette'

export default function App() {
    return (
        <ReactFlowProvider>
            <div className="shell">
                <header className="shell-header">Agent Flow Designer</header>
                <aside className="shell-palette">
                    <Palette />
                </aside>
                <main className="shell-canvas">
                    <Canvas />
                </main>
            </div>
        </ReactFlowProvider>
    )
}

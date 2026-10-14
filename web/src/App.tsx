import { ReactFlowProvider } from '@xyflow/react'
import Canvas from './components/Canvas'
import Palette from './components/Palette'
import { useMessageBar } from './message'

export default function App() {
    // One bar for every message: line refusals from the canvas and file messages.
    const { message, showMessage, clearMessage } = useMessageBar()
    return (
        <ReactFlowProvider>
            <div className="shell">
                <header className="shell-header">Agent Flow Designer</header>
                <aside className="shell-palette">
                    <Palette />
                </aside>
                <main className="shell-canvas">
                    <Canvas message={message} showMessage={showMessage} clearMessage={clearMessage} />
                </main>
            </div>
        </ReactFlowProvider>
    )
}

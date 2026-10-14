import { ReactFlowProvider } from '@xyflow/react'
import Canvas from './components/Canvas'
import FileBar from './components/FileBar'
import Palette from './components/Palette'
import { useMessageBar } from './message'

export default function App() {
    // One bar for every message: line refusals from the canvas and file messages.
    const { message, showMessage, clearMessage } = useMessageBar()
    return (
        <ReactFlowProvider>
            <div className="shell">
                <header className="shell-header">
                    <span className="shell-title">Agent Flow Designer</span>
                    <FileBar showMessage={showMessage} />
                </header>
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

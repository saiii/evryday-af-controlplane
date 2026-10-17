import { ReactFlowProvider, useStore } from '@xyflow/react'
import Canvas from './components/Canvas'
import FileBar from './components/FileBar'
import Palette from './components/Palette'
import SettingsPanel from './components/SettingsPanel'
import { useMessageBar } from './message'
import { useFolderStore } from './folder-store'
import type { FolderStore } from './folder-store'

type MessageBar = ReturnType<typeof useMessageBar>

export default function App() {
    // One bar for every message: line refusals from the canvas and file messages.
    const bar: MessageBar = useMessageBar()
    // The staged component folder edits; only the header Save writes them.
    const folders: FolderStore = useFolderStore()
    return (
        <ReactFlowProvider>
            <Shell bar={bar} folders={folders} />
        </ReactFlowProvider>
    )
}

// Inside the provider, because the selection is read from the canvas store.
function Shell({ bar, folders }: { bar: MessageBar; folders: FolderStore }) {
    const { message, showMessage, clearMessage } = bar
    // The id of the one selected component, or null when none or several are
    // selected (D-01). A primitive, so moving a component does not re-render.
    const selectedId: string | null = useStore((s) => {
        let found: string | null = null
        let count: number = 0
        for (const n of s.nodes) {
            if (n.selected) {
                count += 1
                found = n.id
            }
        }
        return count === 1 ? found : null
    })
    return (
        <div className={selectedId === null ? 'shell' : 'shell shell-with-panel'}>
            <header className="shell-header">
                <span className="shell-title">Agent Flow Designer</span>
                <FileBar showMessage={showMessage} folders={folders} />
            </header>
            <aside className="shell-palette">
                <Palette />
            </aside>
            <main className="shell-canvas">
                <Canvas message={message} showMessage={showMessage} clearMessage={clearMessage} />
            </main>
            {selectedId !== null && (
                <aside className="shell-panel">
                    {/* key: a new selection starts with fresh drafts. */}
                    <SettingsPanel key={selectedId} nodeId={selectedId} folders={folders} />
                </aside>
            )}
        </div>
    )
}

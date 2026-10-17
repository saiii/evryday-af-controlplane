// The settings of the one selected component (D-01), shown as a column to the
// right of the canvas. Image and tag are the only structured settings (D-05);
// the brief, the SKILL.md and the extra files are staged in the folder store
// and written only by the header Save (D-02, D-12).
// The checks here are a courtesy for the person typing: the server checks the
// same rules again on save (D-03, research Pitfall 28), with the same words,
// because both use src/shared/component-settings.ts.

import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { imageProblem, imageWarning, tagProblem, tagWarning } from '../../../src/shared/component-settings'
import { CATALOGUE } from '../../../src/shared/catalogue'
import type { ComponentFlowNode, ComponentNodeData, LineFlowEdge } from '../af-mapping'
import type { FolderStore } from '../folder-store'
import { SkillBrief, SkillSection } from './SkillSection'
import FilesSection from './FilesSection'

function sentence(fragment: string): string {
    return `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}.`
}

type SettingFieldProps = {
    label: string
    // The words the red note starts with, such as "The image".
    subject: string
    // The last good value, as held in the node data.
    value: string | undefined
    problemOf: (v: string) => string | null
    warningOf: (v: string | undefined) => string | null
    apply: (v: string | undefined) => void
    hint?: string
}

function SettingField({ label, subject, value, problemOf, warningOf, apply, hint }: SettingFieldProps) {
    // The text exactly as typed: never trimmed or lower-cased.
    const [draft, setDraft] = useState<string>(value ?? '')
    const [problem, setProblem] = useState<string | null>(null)

    // A bad value is not applied: the field keeps the typed text and the
    // component keeps its last good value (D-02, D-03). An empty field clears it.
    const confirm = () => {
        if (draft === '') {
            apply(undefined)
            setProblem(null)
            return
        }
        const p: string | null = problemOf(draft)
        if (p === null) {
            apply(draft)
            setProblem(null)
        } else {
            setProblem(p)
        }
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            confirm()
        } else if (event.key === 'Escape') {
            setDraft(value ?? '')
            setProblem(null)
        }
    }

    const warning: string | null = problem === null ? warningOf(value) : null

    return (
        <div className="settings-field">
            <label className="settings-label">
                {label}
                <input
                    type="text"
                    className={problem === null ? 'settings-input' : 'settings-input settings-input-bad'}
                    value={draft}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={() => {
                        // The window lost focus, not the field: nothing ends.
                        if (!document.hasFocus()) {
                            return
                        }
                        confirm()
                    }}
                />
            </label>
            {problem !== null && <div className="settings-note-error">{`${subject} ${problem}.`}</div>}
            {warning !== null && <div className="settings-note-warning">{sentence(warning)}</div>}
            {hint !== undefined && <div className="settings-hint">{hint}</div>}
        </div>
    )
}

export default function SettingsPanel({ nodeId, folders }: { nodeId: string; folders: FolderStore }) {
    const { updateNodeData } = useReactFlow<ComponentFlowNode, LineFlowEdge>()
    // Only this node's data, so a drag of another component does not re-render.
    const data = useStore((s) => s.nodeLookup.get(nodeId)?.data) as ComponentNodeData | undefined

    if (data === undefined) {
        return null
    }

    return (
        // Keys typed here must not reach the canvas, whose Backspace and Delete
        // would delete the selected component (research Pitfall 7).
        <div className="settings-panel" onKeyDown={(event) => event.stopPropagation()}>
            <div className="settings-heading">
                <div className="settings-name">{data.name}</div>
                <div className="settings-type">{CATALOGUE[data.componentType].label}</div>
            </div>
            <SkillBrief nodeId={nodeId} folders={folders} />
            <SettingField
                label="Image"
                subject="The image"
                value={data.image}
                problemOf={imageProblem}
                warningOf={imageWarning}
                apply={(v) => updateNodeData(nodeId, { image: v })}
            />
            <SettingField
                label="Tag"
                subject="The tag"
                value={data.tag}
                problemOf={tagProblem}
                warningOf={tagWarning}
                apply={(v) => updateNodeData(nodeId, { tag: v })}
                hint="A version such as 1.0, or a digest such as sha256:…"
            />
            <SkillSection nodeId={nodeId} name={data.name} folders={folders} />
            <FilesSection nodeId={nodeId} name={data.name} folders={folders} />
            <div className="settings-note-muted">
                Deleting this component removes its folder when you save. Only your own git or backups can bring it
                back.
            </div>
        </div>
    )
}

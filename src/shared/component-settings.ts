// The rules for a component's deploy settings: the image, the tag and the
// paths of the extra files in its folder, with the size limits and the starter
// SKILL.md. Shared by the server build and the page bundle, so it imports
// nothing and uses only what both Node and the browser have (web/tsconfig.json
// has types [], so no Node-only API compiles here).
//
// Each problem function returns a lower-case fragment with no full stop that
// reads after "the image ", "the tag " or "the path <shown> ", so the server
// and the panel give the same words; or null when the value is fine.

// A file larger than this is refused (the Phase 5 value for a .af file).
export const MAX_FILE_BYTES: number = 1024 * 1024
export const MAX_FILE_SIZE_TEXT: string = `${MAX_FILE_BYTES / (1024 * 1024)} MB`

// All files of one component folder together.
export const MAX_FOLDER_BYTES: number = 5 * 1024 * 1024
export const MAX_FOLDER_SIZE_TEXT: string = `${MAX_FOLDER_BYTES / (1024 * 1024)} MB`
export const MAX_FOLDER_FILES: number = 100

// The whole save request body; base64 makes file bytes about 4/3 larger.
export const MAX_SAVE_BODY_BYTES: number = 8 * 1024 * 1024
export const MAX_SAVE_BODY_TEXT: string = `${MAX_SAVE_BODY_BYTES / (1024 * 1024)} MB`

export const MAX_PATH_LENGTH: number = 200
export const MAX_PATH_PARTS: number = 4
export const IMAGE_MAX: number = 255

// The one reserved top-level file in a component folder.
export const SKILL_FILE: string = 'SKILL.md'

// The number of UTF-8 bytes of a text. TextEncoder works in Node and the page.
export function textByteLength(text: string): number {
    return new TextEncoder().encode(text).length
}

// From distribution/reference regexp.go and the OCI distribution spec.
const ALNUM: string = '[a-z0-9]+'
const SEP: string = '(?:[._]|__|-+)'
const PATH_COMPONENT: string = `${ALNUM}(?:${SEP}${ALNUM})*`
const DOMAIN_COMPONENT: string = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])'
const DOMAIN: string = `(?:${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*|\\[[a-fA-F0-9:]+\\])(?::[0-9]+)?`
export const IMAGE_PATTERN: RegExp = new RegExp(`^(?:${DOMAIN}/)?${PATH_COMPONENT}(?:/${PATH_COMPONENT})*$`)
// OCI: at most 128 characters; \w spelled out.
export const TAG_PATTERN: RegExp = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/
// OCI image-spec registered algorithms, lower-case hex only.
export const DIGEST_PATTERN: RegExp = /^(?:sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/
// One part of an extra-file path: no leading dot, so no dotfiles, . or ..
export const PATH_PART_PATTERN: RegExp = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/

export function imageProblem(value: unknown): string | null {
    if (typeof value !== 'string') {
        return 'must be text'
    }
    if (value === '') {
        return 'must not be empty'
    }
    if (value.length > IMAGE_MAX) {
        return `must be at most ${IMAGE_MAX} characters`
    }
    // localhost:5000 alone is read by Docker as image localhost with tag 5000.
    const lastPart: string = value.slice(value.lastIndexOf('/') + 1)
    if (value.includes('@') || lastPart.includes(':')) {
        return 'must not hold a tag or digest; put it in the tag field'
    }
    if (!IMAGE_PATTERN.test(value)) {
        return 'must be lower-case letters, digits and . _ - in parts joined by /, with an optional registry host such as registry.example.com:5000 first'
    }
    return null
}

export function tagProblem(value: unknown): string | null {
    if (typeof value !== 'string') {
        return 'must be text, such as "1.0" in quotes'
    }
    if (value === '') {
        return 'must not be empty'
    }
    // A tag never holds a colon, so a value with one is a digest attempt.
    if (value.includes(':') && !DIGEST_PATTERN.test(value)) {
        return 'is not a valid digest: a digest is sha256: followed by 64 lower-case hex digits'
    }
    if (!TAG_PATTERN.test(value) && !DIGEST_PATTERN.test(value)) {
        return 'must be up to 128 letters, digits, _ . and -, not starting with . or -, or a digest such as sha256:…'
    }
    return null
}

// An amber note: it never blocks a save (D-07).
export function imageWarning(image: string | undefined): string | null {
    if (image === undefined || image === '') {
        return 'no image is set yet; it is needed before this component can be deployed'
    }
    return null
}

// An amber note: it never blocks a save (D-08).
export function tagWarning(tag: string | undefined): string | null {
    if (tag === undefined || tag === '') {
        return "no tag is set, so the registry's latest image would be used; set a version or a digest"
    }
    if (tag === 'latest') {
        return 'latest changes over time; set a version or a digest'
    }
    return null
}

// A relative POSIX path inside a component folder. SKILL.md itself passes; it
// is reserved only through pathsProblem and the SKILL.md editor.
export function filePathProblem(value: unknown): string | null {
    if (typeof value !== 'string' || value === '') {
        return 'must be a file path'
    }
    if (value.length > MAX_PATH_LENGTH) {
        return `must be at most ${MAX_PATH_LENGTH} characters`
    }
    if (value.includes('\\') || value.includes('\u0000') || value.startsWith('/')) {
        return 'must be relative, with parts joined by /'
    }
    const parts: string[] = value.split('/')
    if (parts.length > MAX_PATH_PARTS) {
        return `may have at most ${MAX_PATH_PARTS} parts`
    }
    for (const part of parts) {
        if (part === '' || part === '.' || part === '..' || !PATH_PART_PATTERN.test(part)) {
            return 'must have parts of letters, digits, _ . and - that do not start with . (such as scripts/run.sh)'
        }
    }
    return null
}

// The Phase 5 shownName rule, repeated here because af-validate imports this
// file, so importing it back would be a cycle.
function shownPath(text: string): string {
    return JSON.stringify(text.length <= 40 ? text : `${text.slice(0, 40)}…`)
}

// Refuses paths that would land on the same file on a case-insensitive disk
// (macOS, and a podman mount of it), a skill.md that is not SKILL.md, and a
// path that is a file and also a folder of another path.
export function pathsProblem(paths: readonly string[]): string | null {
    // toLowerCase is used here only to detect names that collide on a
    // case-insensitive disk (research Pitfall 4), never to judge a name.
    const byLower: Map<string, string> = new Map()
    for (const p of paths) {
        const lower: string = p.toLowerCase()
        if (!p.includes('/') && lower === SKILL_FILE.toLowerCase() && p !== SKILL_FILE) {
            return `the path ${shownPath(p)} differs from ${SKILL_FILE} only in letter case`
        }
        const first: string | undefined = byLower.get(lower)
        if (first !== undefined) {
            return `the paths ${shownPath(first)} and ${shownPath(p)} differ only in letter case`
        }
        byLower.set(lower, p)
    }
    for (const [lowerA, a] of byLower) {
        for (const [lowerB, b] of byLower) {
            if (lowerB.startsWith(`${lowerA}/`)) {
                return `${shownPath(a)} is a file and also a folder in ${shownPath(b)}`
            }
        }
    }
    return null
}

// The SKILL.md written for a component that has none yet. Generic text only.
export function starterSkill(name: string): string {
    return [
        '---',
        `name: ${name}`,
        'description: ""',
        '---',
        '',
        `# ${name}`,
        '',
        '## How it is deployed',
        '',
        '## Where it is deployed',
        '',
        '## Details',
        ''
    ].join('\n')
}

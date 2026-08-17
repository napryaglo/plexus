import type { IStorage } from '../../../services/storage/storage.js'
import claudeRoot from './scaffold/claude-root.md?raw'
import todlManual from '../../../services/projects/scaffold/todl-manual.md?raw'
import metaModelGuide from './scaffold/meta-model-guide.md?raw'
import newConceptCommand from './scaffold/new-concept.md?raw'

// The agent-support scaffold every meta-model project carries: a root CLAUDE.md
// (rules + workflow, auto-loaded by Claude Code) and a `.claude/` folder with the
// TODL language manual, a meta-model authoring guide, and a `/new-concept`
// command. Its purpose is to make an agent working in the project effective:
// the content is grounded in the CURRENT @pragmatic-lab/todl parser surface
// (namespace/`;`, bare type-directed references — no sigil, `?`/`[]`/`[+]`
// cardinality, author-declared `operator` edge glyphs, typed inline object
// literals, the prelude's standard annotations incl. icon/iconSource/wiki, and
// the `Element` root — NOT the archived YAML / `list<T>` / `&`-reference forms),
// so it stays truthful to what the live validator enforces.
//
// The markdown lives as `?raw` asset files under ./scaffold so it can be authored
// and reviewed as real documents rather than escaped string literals.

export const CLAUDE_MD_FILENAME = 'CLAUDE.md'
export const CLAUDE_DIR = '.claude'

export interface ScaffoldFile
{
    readonly path: string       // project-relative destination (POSIX)
    readonly content: string
}

// Source asset → destination path within the project.
export const SCAFFOLD_FILES: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME,                       content: claudeRoot },
    { path: `${CLAUDE_DIR}/todl-manual.md`,           content: todlManual },
    { path: `${CLAUDE_DIR}/meta-model-guide.md`,      content: metaModelGuide },
    { path: `${CLAUDE_DIR}/commands/new-concept.md`,  content: newConceptCommand },
]

// Write each scaffold file only when it is absent. This lets one function serve
// both entry points: createProject lays the full set into a fresh project, and
// openProject self-heals any missing file on an existing one — while NEVER
// overwriting an author's edits (an existing file is left untouched).
export async function ensureScaffold(storage: IStorage): Promise<void>
{
    await storage.CreateDirectory(`${CLAUDE_DIR}/commands`)
    for (const file of SCAFFOLD_FILES) {
        if (await storage.Exists(file.path)) continue
        await storage.WriteText(file.path, file.content)
    }
}

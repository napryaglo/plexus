import { DiagnosticSeverity, type Diagnostic } from '../diagnostics/diagnostic.js'
import type { RefreshedProjectSummary } from '../../../../shared/agent-api.js'

// The minimum an open project contributes to refresh targeting + summaries.
export interface OpenProjectRef { folder: string; name: string }

const MAX_SAMPLE_MESSAGES = 5

// Normalize a path for containment comparison: backslashes → slashes, drop a
// trailing slash, lowercase (Plexus targets Windows; folder identity is
// case-insensitive there and harmless elsewhere for our own project paths).
function normalize(path: string): string
{
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return slashed.toLowerCase()
}

// The open project whose folder CONTAINS `path` (the folder itself, or a path
// under it at a segment boundary). undefined if none — a sibling whose name is a
// mere string prefix ("/p/proj" vs "/p/project-x") does not match.
export function resolveOwningProject(open: readonly OpenProjectRef[], path: string): OpenProjectRef | undefined
{
    const p = normalize(path)
    return open.find((o) =>
    {
        const f = normalize(o.folder)
        return p === f || p.startsWith(`${f}/`)
    })
}

// Compact per-project problem summary from the flat diagnostics set.
export function summarizeProject(ref: OpenProjectRef, diagnostics: readonly Diagnostic[]): RefreshedProjectSummary
{
    const mine = diagnostics.filter((d) => d.projectId === ref.folder)
    return {
        name: ref.name,
        folder: ref.folder,
        errorCount:   mine.filter((d) => d.severity === DiagnosticSeverity.Error).length,
        warningCount: mine.filter((d) => d.severity === DiagnosticSeverity.Warning).length,
        sampleMessages: mine.slice(0, MAX_SAMPLE_MESSAGES).map((d) => d.message),
    }
}

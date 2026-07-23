import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type IDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { checkAgainst, Severity, type Diagnostic as Diagnostic_TODL, type SourceFile, type TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../storage/storage.js'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { EditorSeverity, type EditorDiagnostic } from '../../modules/code-editor/editor-diagnostic.js'
import { collectTodlSources } from '../../modules/meta-model/services/todl-sources.js'
import { resolveBases } from '../projects/base-resolver.js'
import { PROJECT_MANIFEST_FILENAME } from '../projects/project-factory.js'
import type { BaseBindings } from '../projects/base-binding.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic, type DiagnosticSpan } from '../diagnostics/diagnostic.js'

// Whole-project live validation for any TODL-authoring project (meta-model,
// library, architecture). It watches the shell's open documents; whenever an open
// `.todl` document's text changes it debounces, then validates ALL the project's
// `.todl` files together — against the project's declared BASE models (its
// meta-model, and for an architecture its libraries) via TODL's checkAgainst —
// and distributes the diagnostics back to each open document's Diagnostics
// channel, which the CodeEditor renders as Monaco squiggles. A meta-model project
// declares no base, so checkAgainst([], …) ≡ check(…): identical behavior.
//
// Bases are resolved from the project manifest and cached per storage; a
// republished base is picked up on ClearBaseCache() (the Refresh-Bases command).
// Diagnostics for files that aren't open are dropped in v1 (the Problems panel's
// future job).

const DEBOUNCE_MS = 250

// Producer id under which TODL diagnostics are published to the DiagnosticsService.
const TODL_OWNER = 'todl'

const SEVERITY_MAP: Record<string, EditorSeverity> = {
    [Severity.Error]:   EditorSeverity.Error,
    [Severity.Warning]: EditorSeverity.Warning,
}

const CANON_SEVERITY: Record<string, DiagnosticSeverity> = {
    [Severity.Error]:   DiagnosticSeverity.Error,
    [Severity.Warning]: DiagnosticSeverity.Warning,
}

// Map a spanned TODL diagnostic to a canonical Diagnostic for a project. A null
// span (unattributed / whole-model) becomes a project-level diagnostic (uri null).
export function diagnosticToCanonical(
    d: Diagnostic_TODL, projectId: string, projectName: string,
): Diagnostic
{
    const span: DiagnosticSpan | null = d.span
        ? { startLine: d.span.start.line, startColumn: d.span.start.column,
            endLine: d.span.end.line, endColumn: d.span.end.column }
        : null
    return {
        owner: TODL_OWNER, projectId, projectName,
        uri: d.span?.uri ?? null,
        message: d.message,
        severity: CANON_SEVERITY[d.severity] ?? DiagnosticSeverity.Error,
        span,
    }
}

// Map a spanned TODL diagnostic to an editor diagnostic. Both use 1-based
// positions with an exclusive end, so the range is a straight copy; a null span
// (genuine whole-model diagnostic) collapses to the document start.
export function diagnosticToEditor(d: Diagnostic_TODL): EditorDiagnostic
{
    const start = d.span?.start ?? { line: 1, column: 1 }
    const end = d.span?.end ?? { line: 1, column: 2 }
    return {
        severity:    SEVERITY_MAP[d.severity] ?? EditorSeverity.Error,
        message:     d.message,
        startLine:   start.line,
        startColumn: start.column,
        endLine:     end.line,
        endColumn:   end.column,
    }
}

// Overlay open documents' live text over the on-disk snapshot (open buffers may
// be unsaved). Keyed by uri = project-relative path = a document's Id.
export function overlaySources(
    stored: readonly SourceFile[],
    open: readonly { id: string; text: string }[],
): SourceFile[]
{
    const byUri = new Map<string, string>()
    for (const s of stored) byUri.set(s.uri, s.text)
    for (const o of open) byUri.set(o.id, o.text)
    return [...byUri].map(([uri, text]) => ({ uri, text }))
}

// A synthetic whole-file Error at the document start — used when validation can't
// attribute a location (a TODL throw, or an unresolved base binding).
function wholeFileError(message: string): EditorDiagnostic
{
    return { severity: EditorSeverity.Error, message, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
}

// Validate all sources together AGAINST the given base models and group
// diagnostics by source uri. Every input uri gets an entry (empty when clean) so
// a fixed file's squiggles clear. `bases` defaults to [] — checkAgainst([], s) is
// exactly check(s), so a meta-model project validates as before.
export function validateSources(sources: SourceFile[], bases: TodlDocument[] = []): Map<string, EditorDiagnostic[]>
{
    const byUri = new Map<string, EditorDiagnostic[]>()
    for (const s of sources) byUri.set(s.uri, [])

    let diagnostics: readonly Diagnostic_TODL[]
    try {
        diagnostics = checkAgainst(bases, sources).diagnostics
    } catch (e) {
        // TODL throws on some hard structural errors (e.g. a duplicate
        // definition) rather than reporting them as diagnostics. Surface a
        // project-level error on every file so the problem is visible, instead of
        // crashing the validation pass.
        const message = `Validation failed: ${(e as Error).message}`
        for (const uri of byUri.keys()) byUri.set(uri, [wholeFileError(message)])
        return byUri
    }

    for (const d of diagnostics) {
        const uri = d.span?.uri
        if (uri === undefined || uri === null) continue   // unattributed — dropped in v1
        let list = byUri.get(uri)
        if (list === undefined) { list = []; byUri.set(uri, list) }
        list.push(diagnosticToEditor(d))
    }
    return byUri
}

export class TodlValidationService extends ServiceBase
{
    public static readonly Key = new ServiceKey<TodlValidationService>('TodlValidationService')

    private hostUnsub: (() => void) | undefined
    // Each tracked (open, .todl) document → its project storage + the thunk that
    // unhooks its Content listener. Keyed by document so several projects' docs
    // coexist and validate independently.
    private readonly tracked = new Map<CodeDocument, { storage: IStorage; unhook: () => void }>()
    // Open projects (storage → identity), registered by the explorer on project
    // open. This is the unit of validation: a project validates whole even with
    // no editor open. Tracked docs only overlay live buffers + trigger passes.
    private readonly openProjects = new Map<IStorage, { projectId: string; projectName: string }>()
    // Per-project resolved bases, cached so a validation pass doesn't re-read the
    // backends on every keystroke. Dropped by ClearBaseCache after a republish.
    private readonly baseCache = new Map<IStorage, { bases: TodlDocument[]; problems: string[] }>()
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(provider: IServiceProvider) { super(provider) }

    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    private get diagnostics(): DiagnosticsService | undefined
    {
        return this.Provider.get(DiagnosticsService.Key)
    }

    // Track a `.todl` document + the project storage it belongs to (called by the
    // factory when it opens the file). Hooks the document's Content and schedules
    // a validation pass; the open-set subscription untracks it when it closes.
    public AttachDocument(doc: CodeDocument, storage: IStorage): void
    {
        if (this.tracked.has(doc)) return
        this.subscribeToHost()
        const listener = (): void => this.scheduleRevalidate()
        doc.AddPropertyChangedListener(CodeDocument.ContentKey, listener)
        this.tracked.set(doc, { storage, unhook: () => doc.RemovePropertyChangedListener(CodeDocument.ContentKey, listener) })
        this.scheduleRevalidate()
    }

    // Re-key a tracked document to a new project storage (after a cross-project
    // move) so it validates against the new project's bases. Keeps the Content
    // listener; schedules a revalidation pass. Untracked ⇒ a plain attach.
    public ReattachDocument(doc: CodeDocument, storage: IStorage): void
    {
        const t = this.tracked.get(doc)
        if (t === undefined) { this.AttachDocument(doc, storage); return }
        this.tracked.set(doc, { storage, unhook: t.unhook })
        this.scheduleRevalidate()
    }

    // Drop cached bases (all, or one project's) so the next Revalidate re-resolves
    // them from the backends — used after a base is (re)published.
    public ClearBaseCache(storage?: IStorage): void
    {
        if (storage === undefined) this.baseCache.clear()
        else this.baseCache.delete(storage)
    }

    // Register an open project so it validates whole (independent of open editors).
    // Idempotent; schedules a pass so the dock is populated on project open.
    public AttachProject(projectId: string, projectName: string, storage: IStorage): void
    {
        this.openProjects.set(storage, { projectId, projectName })
        this.scheduleRevalidate()
    }

    // Unregister a project on close: drop its base cache and its diagnostics.
    public DetachProject(storage: IStorage): void
    {
        const info = this.openProjects.get(storage)
        this.openProjects.delete(storage)
        this.baseCache.delete(storage)
        if (info !== undefined) this.diagnostics?.ClearProject(info.projectId)
    }

    // Stop watching and clear pending work.
    public Dispose(): void
    {
        if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
        this.hostUnsub?.()
        this.hostUnsub = undefined
        for (const t of this.tracked.values()) t.unhook()
        this.tracked.clear()
        this.baseCache.clear()
        this.openProjects.clear()
    }

    // Watch the open-set only to UNTRACK closed documents (docs are attached
    // explicitly by the factory, so no 'inserted' handling is needed).
    private subscribeToHost(): void
    {
        if (this.hostUnsub !== undefined) return
        this.hostUnsub = this.host.OpenDocuments.Subscribe((change) => {
            if (change.kind === 'removed') for (const d of change.items) this.untrack(d)
            else if (change.kind === 'cleared') { for (const t of this.tracked.values()) t.unhook(); this.tracked.clear() }
        })
    }

    private untrack(doc: IDocument): void
    {
        const t = this.tracked.get(doc as CodeDocument)
        if (t !== undefined) { t.unhook(); this.tracked.delete(doc as CodeDocument) }
    }

    private scheduleRevalidate(): void
    {
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.timer = undefined; void this.Revalidate() }, DEBOUNCE_MS)
    }

    // Resolve (and cache) a project's declared bases from its manifest. A project
    // with no manifest / no bindings (a bare source folder) resolves to [].
    private async basesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const cached = this.baseCache.get(storage)
        if (cached !== undefined) return cached
        let bindings: BaseBindings = {}
        try {
            const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as BaseBindings
            bindings = { metaModel: manifest.metaModel, libraries: manifest.libraries }
        } catch { /* no manifest → no bases */ }
        const resolved = await resolveBases(this.Provider, bindings)
        this.baseCache.set(storage, resolved)
        return resolved
    }

    // Validate each open project independently and distribute diagnostics to its
    // documents. Tracked docs are grouped by their project storage; each group is
    // checked over that project's file set (on-disk sources overlaid with the
    // group's live buffers) AGAINST the project's resolved bases. Public +
    // awaitable so it's directly testable.
    public async Revalidate(): Promise<void>
    {
        // Group tracked (open) docs by their storage for buffer overlay + squiggles.
        const docsByStorage = new Map<IStorage, CodeDocument[]>()
        for (const [doc, { storage }] of this.tracked) {
            const list = docsByStorage.get(storage)
            if (list === undefined) docsByStorage.set(storage, [doc])
            else list.push(doc)
        }

        for (const [storage, { projectId, projectName }] of this.openProjects) {
            const { bases, problems } = await this.basesFor(storage)
            const stored = await collectTodlSources(storage)
            const docs = docsByStorage.get(storage) ?? []
            const open = docs.map((d) => ({ id: d.Id, text: d.Content }))
            const sources = overlaySources(stored, open)

            // Canonical diagnostics for the store (every file in the project).
            const canonical: Diagnostic[] = []
            try {
                for (const d of checkAgainst(bases, sources).diagnostics) {
                    canonical.push(diagnosticToCanonical(d, projectId, projectName))
                }
            } catch (e) {
                const message = `Validation failed: ${(e as Error).message}`
                for (const s of sources) {
                    canonical.push({
                        owner: TODL_OWNER, projectId, projectName, uri: s.uri,
                        message, severity: DiagnosticSeverity.Error, span: null,
                    })
                }
            }
            if (problems.length > 0) {
                canonical.push({
                    owner: TODL_OWNER, projectId, projectName, uri: null,
                    message: `Unresolved base: ${problems.join('; ')}.`,
                    severity: DiagnosticSeverity.Error, span: null,
                })
            }
            this.diagnostics?.Publish(TODL_OWNER, projectId, canonical)
        }
    }
}

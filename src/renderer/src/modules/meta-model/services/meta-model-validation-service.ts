import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type IDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { check, Severity, type Diagnostic, type SourceFile } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { CodeDocument } from '../../code-editor/code-document.js'
import { EditorSeverity, type EditorDiagnostic } from '../../code-editor/editor-diagnostic.js'
import { collectTodlSources } from './todl-sources.js'

// Whole-project live validation for a meta-model project. It watches the shell's
// open documents; whenever an open `.todl` document's text changes it debounces,
// then validates ALL the project's `.todl` files together (open buffers overlaid
// on the on-disk snapshot, so cross-file references resolve) and distributes the
// diagnostics back to each open document's Diagnostics channel — which the
// CodeEditor renders as Monaco squiggles. Diagnostics for files that aren't open
// are dropped in v1 (that is the deferred Problems panel's job).

const DEBOUNCE_MS = 250

const SEVERITY_MAP: Record<string, EditorSeverity> = {
    [Severity.Error]:   EditorSeverity.Error,
    [Severity.Warning]: EditorSeverity.Warning,
}

// Map a spanned TODL diagnostic to an editor diagnostic. Both use 1-based
// positions with an exclusive end, so the range is a straight copy; a null span
// (genuine whole-model diagnostic) collapses to the document start.
export function diagnosticToEditor(d: Diagnostic): EditorDiagnostic
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

// A synthetic whole-file Error at the document start — used when validation
// can't attribute a location.
function wholeFileError(message: string): EditorDiagnostic
{
    return { severity: EditorSeverity.Error, message, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
}

// Validate all sources together and group diagnostics by source uri. Every input
// uri gets an entry (empty when clean) so a fixed file's squiggles clear.
export function validateSources(sources: SourceFile[]): Map<string, EditorDiagnostic[]>
{
    const byUri = new Map<string, EditorDiagnostic[]>()
    for (const s of sources) byUri.set(s.uri, [])

    let diagnostics: readonly Diagnostic[]
    try {
        diagnostics = check(sources).diagnostics
    } catch (e) {
        // TODL throws on some hard structural errors (e.g. a duplicate
        // definition) rather than reporting them as diagnostics. Surface a
        // project-level error on every file so the problem is visible, instead
        // of crashing the validation pass.
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

export class MetaModelValidationService extends ServiceBase
{
    public static readonly Key = new ServiceKey<MetaModelValidationService>('MetaModelValidationService')

    private hostUnsub: (() => void) | undefined
    // Each tracked (open, .todl) document → its project storage + the thunk that
    // unhooks its Content listener. Keyed by document so several projects' docs
    // coexist and validate independently.
    private readonly tracked = new Map<CodeDocument, { storage: IStorage; unhook: () => void }>()
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(provider: IServiceProvider) { super(provider) }

    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
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

    // Stop watching and clear pending work.
    public Dispose(): void
    {
        if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
        this.hostUnsub?.()
        this.hostUnsub = undefined
        for (const t of this.tracked.values()) t.unhook()
        this.tracked.clear()
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

    // Validate each open project independently and distribute diagnostics to its
    // documents. Tracked docs are grouped by their project storage; each group is
    // checked over that project's file set (on-disk sources overlaid with the
    // group's live buffers). Public + awaitable so it's directly testable.
    public async Revalidate(): Promise<void>
    {
        const byStorage = new Map<IStorage, CodeDocument[]>()
        for (const [doc, { storage }] of this.tracked) {
            const list = byStorage.get(storage)
            if (list === undefined) byStorage.set(storage, [doc])
            else list.push(doc)
        }
        for (const [storage, docs] of byStorage) {
            const stored = await collectTodlSources(storage)
            const open = docs.map((d) => ({ id: d.Id, text: d.Content }))
            const byUri = validateSources(overlaySources(stored, open))
            for (const doc of docs) {
                const target = doc.Diagnostics
                target.Clear()
                for (const dg of byUri.get(doc.Id) ?? []) target.Add(dg)
            }
        }
    }
}

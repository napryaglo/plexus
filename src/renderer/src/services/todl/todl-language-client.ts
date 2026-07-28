import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { MessageConnection } from 'vscode-jsonrpc'
import type { TodlDocument } from '@pragmatic-lab/todl'
import type { IStorage } from '../storage/storage.js'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { collectTodlSources } from '../../modules/meta-model/services/todl-sources.js'
import { resolveBases } from '../projects/base-resolver.js'
import { PROJECT_MANIFEST_FILENAME } from '../projects/project-factory.js'
import type { BaseBindings } from '../projects/base-binding.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../diagnostics/diagnostic.js'

// The slice of an LSP diagnostic / publish notification the client maps. LSP
// positions are 0-based; canonical diagnostics are 1-based with exclusive end.
interface LspRangeLike { start: { line: number; character: number }; end: { line: number; character: number } }
interface LspDiagnostic { range: LspRangeLike; message: string; severity?: number }
interface PublishDiagnosticsParams { uri: string; diagnostics: LspDiagnostic[] }

const LSP_SEVERITY: Record<number, DiagnosticSeverity> = {
  1: DiagnosticSeverity.Error,
  2: DiagnosticSeverity.Warning,
  3: DiagnosticSeverity.Info,
  4: DiagnosticSeverity.Hint,
}

// One open project as the client knows it: its identity (projectId =
// Project.RootPath), display name, and the storage its sources live in. Keyed in
// the registry by projectKey = encodeURIComponent(projectId), which is also the
// authority segment of every todl:// URI for the project.
interface RegisteredProject {
  projectId: string
  projectName: string
  storage: IStorage
}

// The renderer-side TODL language client. Owns the MessageConnection to the
// out-of-process server, a synthetic-URI registry that maps documents to/from
// (project, storage, relpath), the project source/base feed, diagnostics
// routing, and WorkspaceEdit application. Replaces TodlValidationService.
//
// This file grows in layers: registry (here) → source/base feed → document sync
// → diagnostics routing → WorkspaceEdit application.
export class TodlLanguageClient extends ServiceBase {
  public static readonly Key = new ServiceKey<TodlLanguageClient>('TodlLanguageClient')

  private connection: MessageConnection | undefined
  private readonly projects = new Map<string, RegisteredProject>() // projectKey → project
  // Per-project resolved bases (+ unresolved-base problems), cached so a base
  // set isn't re-read from the backends on every keystroke. Keyed by storage.
  private readonly baseCache = new Map<IStorage, { bases: TodlDocument[]; problems: string[] }>()
  // Server documents currently open per project (projectKey → set of URIs), so
  // edits/structural changes can didChange/didClose the right ones.
  private readonly openDocs = new Map<string, Set<string>>()
  // Monotonic didChange version per URI.
  private readonly versions = new Map<string, number>()
  // Open editor documents → their current server URI, and → the Content unhook.
  private readonly docUris = new Map<CodeDocument, string>()
  private readonly docListeners = new Map<CodeDocument, () => void>()
  // Latest diagnostics per project (projectId → relpath → canonical), so a
  // per-URI publish can be flattened into the whole-project slice the store wants.
  private readonly diagsByProject = new Map<string, Map<string, Diagnostic[]>>()

  constructor(provider: IServiceProvider) { super(provider) }

  private get diagnostics(): DiagnosticsService | undefined {
    return this.Provider.get(DiagnosticsService.Key)
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.connection?.sendNotification(method, params)
  }

  private nextVersion(uri: string): number {
    const v = (this.versions.get(uri) ?? 0) + 1
    this.versions.set(uri, v)
    return v
  }

  // Establish the handshake over an already-listening connection. The publish-
  // diagnostics handler is registered in the diagnostics-routing layer.
  public async Initialize(connection: MessageConnection): Promise<void> {
    this.connection = connection
    connection.onNotification('textDocument/publishDiagnostics', (p) =>
      this.onPublishDiagnostics(p as PublishDiagnosticsParams))
    await connection.sendRequest('initialize', {
      processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: 'pushed' },
    })
    await connection.sendNotification('initialized', {})
  }

  // The opaque, reversible authority segment for a project's URIs.
  public projectKeyFor(projectId: string): string { return encodeURIComponent(projectId) }

  // A document URI: todl://<projectKey>/<relpath>. An empty relpath yields the
  // project rootUri (the server partitions projects by this prefix).
  public uriFor(projectId: string, relpath: string): string {
    return `todl://${this.projectKeyFor(projectId)}/${relpath}`
  }

  // Record a project so its URIs resolve back to (project, storage, relpath).
  public registerProject(projectId: string, projectName: string, storage: IStorage): void {
    this.projects.set(this.projectKeyFor(projectId), { projectId, projectName, storage })
  }

  // Reverse a todl:// URI to its project + storage + project-relative path, or
  // null when the project is unknown (e.g. after close).
  public resolveUri(uri: string): { projectId: string; storage: IStorage; relpath: string } | null {
    const rest = uri.startsWith('todl://') ? uri.slice('todl://'.length) : ''
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const key = rest.slice(0, slash)
    const relpath = rest.slice(slash + 1)
    const entry = this.projects.get(key)
    if (entry === undefined) return null
    return { projectId: entry.projectId, storage: entry.storage, relpath }
  }

  // Resolve (and cache) a project's declared bases from its manifest. A project
  // with no manifest / no bindings resolves to []. Mirrors the retired
  // TodlValidationService.basesFor.
  private async basesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }> {
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

  private projectByStorage(storage: IStorage): { key: string; project: RegisteredProject } | null {
    for (const [key, project] of this.projects) if (project.storage === storage) return { key, project }
    return null
  }

  // Register a project, push its resolved bases, and didOpen every project .todl
  // (the whole set — not just the visible tab — so the server can analyze the
  // project as a whole).
  public async AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void> {
    this.registerProject(projectId, projectName, storage)
    const { bases } = await this.basesFor(storage)
    await this.notify('todl/setBases', { rootUri: this.uriFor(projectId, ''), bases })
    const opened = new Set<string>()
    for (const s of await collectTodlSources(storage)) {
      const uri = this.uriFor(projectId, s.uri)
      opened.add(uri)
      await this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: s.text },
      })
    }
    this.openDocs.set(this.projectKeyFor(projectId), opened)
  }

  // Unregister a project on close: didClose its docs, drop registry + caches.
  // (Diagnostics clearing is added in the diagnostics-routing layer.)
  public DetachProject(storage: IStorage): void {
    const found = this.projectByStorage(storage)
    if (found === null) return
    const opened = this.openDocs.get(found.key) ?? new Set<string>()
    for (const uri of opened) void this.notify('textDocument/didClose', { textDocument: { uri } })
    this.openDocs.delete(found.key)
    this.projects.delete(found.key)
    this.baseCache.delete(storage)
    this.diagsByProject.delete(found.project.projectId)
    this.diagnostics?.ClearProject(found.project.projectId)
  }

  // Re-resolve a project's bases after a (re)publish and push them to the server,
  // which drops the old set and re-analyzes.
  public async RefreshBases(storage: IStorage): Promise<void> {
    const found = this.projectByStorage(storage)
    if (found === null) return
    this.baseCache.delete(storage)
    const { bases } = await this.basesFor(storage)
    await this.notify('todl/refreshBases', { rootUri: this.uriFor(found.project.projectId, ''), bases })
  }

  // Record a document's URI and publish it on the document so the editor keys its
  // Monaco model on it.
  private assignUri(doc: CodeDocument, uri: string): void {
    this.docUris.set(doc, uri)
    doc.Uri = uri
  }

  private sendDidChange(uri: string, text: string): void {
    void this.notify('textDocument/didChange', {
      textDocument: { uri, version: this.nextVersion(uri) },
      contentChanges: [{ text }],
    })
  }

  // Wire an open editor document to the server: assign its URI, ensure the server
  // has it open, and forward every Content edit as a full-text didChange (the
  // server's incremental sync accepts a range-less full replace). Idempotent.
  public AttachDocument(doc: CodeDocument, storage: IStorage): void {
    if (this.docListeners.has(doc)) return
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, doc.Id)
    this.assignUri(doc, uri)
    const opened = this.openDocs.get(found.key)
    if (opened !== undefined && !opened.has(uri)) {
      opened.add(uri)
      void this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: doc.Content },
      })
    }
    const listener = (): void => {
      const current = this.docUris.get(doc)
      if (current !== undefined) this.sendDidChange(current, doc.Content)
    }
    doc.AddPropertyChangedListener(CodeDocument.ContentKey, listener)
    this.docListeners.set(doc, () => doc.RemovePropertyChangedListener(CodeDocument.ContentKey, listener))
  }

  // Move a document to (storage, relpath): close the old server doc, open the new
  // one. The Content listener reads the live URI, so it follows automatically.
  private moveDoc(doc: CodeDocument, storage: IStorage, relpath: string): void {
    const old = this.docUris.get(doc)
    if (old !== undefined) {
      void this.notify('textDocument/didClose', { textDocument: { uri: old } })
      for (const set of this.openDocs.values()) set.delete(old)
    }
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, relpath)
    this.assignUri(doc, uri)
    this.openDocs.get(found.key)?.add(uri)
    void this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: doc.Content },
    })
  }

  // In-place rename within the same project.
  public RelocateDocument(doc: CodeDocument, storage: IStorage, newPath: string): void {
    this.moveDoc(doc, storage, newPath)
  }

  // Cross-project move (doc.Id already points at the new path).
  public ReattachDocument(doc: CodeDocument, storage: IStorage): void {
    this.moveDoc(doc, storage, doc.Id)
  }

  // Reconcile the server's open set for a project with what is on disk now —
  // didOpen new files, didChange still-present ones, didClose removed ones.
  // Covers explorer create/delete/rename with no editor open.
  public async ResyncProject(projectId: string, storage: IStorage): Promise<void> {
    const key = this.projectKeyFor(projectId)
    const prev = this.openDocs.get(key) ?? new Set<string>()
    const next = new Set<string>()
    for (const s of await collectTodlSources(storage)) {
      const uri = this.uriFor(projectId, s.uri)
      next.add(uri)
      if (prev.has(uri)) {
        this.sendDidChange(uri, s.text)
      } else {
        void this.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: s.text },
        })
      }
    }
    for (const uri of prev) if (!next.has(uri)) void this.notify('textDocument/didClose', { textDocument: { uri } })
    this.openDocs.set(key, next)
  }

  // Route a server publishDiagnostics into the canonical store. The store wants
  // the whole project slice at once, so accumulate per-URI then flatten.
  private onPublishDiagnostics(params: PublishDiagnosticsParams): void {
    const key = params.uri.startsWith('todl://') ? params.uri.slice('todl://'.length).split('/')[0] : undefined
    const entry = key !== undefined ? this.projects.get(key) : undefined
    const resolved = this.resolveUri(params.uri)
    if (entry === undefined || resolved === null) return
    const canon = params.diagnostics.map((d): Diagnostic => ({
      owner: 'todl', projectId: entry.projectId, projectName: entry.projectName, uri: resolved.relpath,
      message: d.message,
      severity: LSP_SEVERITY[d.severity ?? 1] ?? DiagnosticSeverity.Error,
      span: {
        startLine: d.range.start.line + 1, startColumn: d.range.start.character + 1,
        endLine: d.range.end.line + 1, endColumn: d.range.end.character + 1,
      },
    }))
    let byUri = this.diagsByProject.get(entry.projectId)
    if (byUri === undefined) { byUri = new Map(); this.diagsByProject.set(entry.projectId, byUri) }
    byUri.set(resolved.relpath, canon)
    this.publishProject(entry.projectId)
  }

  // Flatten a project's per-URI diagnostics (plus any unresolved-base problems)
  // and replace its slice in the store.
  private publishProject(projectId: string): void {
    const byUri = this.diagsByProject.get(projectId) ?? new Map<string, Diagnostic[]>()
    const flat: Diagnostic[] = []
    for (const list of byUri.values()) flat.push(...list)
    const project = [...this.projects.values()].find((p) => p.projectId === projectId)
    if (project !== undefined) {
      const problems = this.baseCache.get(project.storage)?.problems ?? []
      if (problems.length > 0) {
        flat.push({
          owner: 'todl', projectId, projectName: project.projectName, uri: null,
          message: `Unresolved base: ${problems.join('; ')}.`,
          severity: DiagnosticSeverity.Error, span: null,
        })
      }
    }
    this.diagnostics?.Publish('todl', projectId, flat)
  }
}

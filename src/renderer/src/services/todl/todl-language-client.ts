import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { MessageConnection } from 'vscode-jsonrpc'
import type { IStorage } from '../storage/storage.js'

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

  constructor(provider: IServiceProvider) { super(provider) }

  // Establish the handshake over an already-listening connection. The publish-
  // diagnostics handler is registered in the diagnostics-routing layer.
  public async Initialize(connection: MessageConnection): Promise<void> {
    this.connection = connection
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
}

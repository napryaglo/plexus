import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IStorage } from '../storage/storage.js'
import type { Project } from './project.js'

// The contract a module's project factory implements — the behavior the
// generic ProjectExplorerService delegates to. A module declares a
// ProjectFactoryDefinition (mural) whose Factory service token resolves to an
// IProjectFactory; the explorer routes open/create/save through it, staying
// ignorant of any concrete project or file format.
//
// Persistence flows through an IStorage (rooted at the project, project-relative
// paths) rather than the raw file system, so a project's backend — local FS
// today, cloud/REST later — is transparent to the factory. The explorer builds
// the IStorage and hands it in.

// The manifest file at a project folder's root. Its `type` routes a folder to
// the factory that owns it; the rest of the manifest is factory-specific (each
// factory reads/writes its own extended shape). Only this envelope is generic.
// (JSON content, but the `.plexus` name alone identifies it — no `.json` tail.)
export const PROJECT_MANIFEST_FILENAME = 'project.plexus'

export interface ProjectManifestEnvelope
{
    type:     string
    name?:    string
    version?: number
    // The storage backend the project lives on (a StorageProviderRegistry id).
    // Absent ⇒ the default 'local' backend.
    storage?: string
}

// One file format a factory understands — surfaced in a "New file" affordance.
// `kind` is the ProjectNode kind ('diagram' for openable-in-app formats).
export interface ProjectFileFormat
{
    extension:   string   // leading dot, e.g. ".diagram"
    kind:        string
    displayName: string
}

export interface IProjectFactory
{
    readonly formats: readonly ProjectFileFormat[]

    // Project lifecycle. createProject writes an initial manifest into a fresh
    // project storage; openProject reads the manifest + builds the file tree;
    // saveProject persists project-level state (the manifest). All operate on a
    // rooted IStorage (project-relative paths).
    createProject(storage: IStorage, name: string): Promise<Project>
    openProject(storage: IStorage): Promise<Project>
    saveProject(project: Project, storage: IStorage): Promise<void>

    // File lifecycle. openFile deserializes a project file (project-relative
    // path) into a tab document (the host then opens it in the content host);
    // saveFile serializes a document back to its file; newFile creates an empty
    // file of a format and returns its project-relative path.
    openFile(storage: IStorage, path: string): Promise<IDocument>
    saveFile(document: IDocument): Promise<void>
    newFile(storage: IStorage, format: string, name: string): Promise<string>
}

// The outcome of a publish — surfaced verbatim by the explorer as its status.
export interface PublishResult
{
    ok:      boolean
    message: string
}

// Optional capability a factory MAY also implement: producing a shareable
// artifact from the project. The explorer feature-tests with isPublishable
// before offering its Publish command — the same pattern as ILocalFileAccess.
// `provider` is passed so publish can resolve a destination backend / services.
export interface IPublishableProjectFactory
{
    publish(project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
}

// Type guard: does this factory support publishing?
export function isPublishable(factory: IProjectFactory): factory is IProjectFactory & IPublishableProjectFactory
{
    return typeof (factory as Partial<IPublishableProjectFactory>).publish === 'function'
}

// Optional capability: re-point an already-open document after its file was
// renamed/moved on storage (an in-place rename). The explorer feature-tests
// with isRelocatable before offering to keep tabs open across a rename; a
// factory that omits it simply leaves stale tabs closed to the caller's policy.
// `newPath` is the document's new project-relative path.
export interface IRelocatableFileFactory
{
    relocateOpenFile(document: IDocument, newPath: string): void
}

// Type guard: can this factory re-point an open document to a new path?
export function isRelocatable(factory: IProjectFactory): factory is IProjectFactory & IRelocatableFileFactory
{
    return typeof (factory as Partial<IRelocatableFileFactory>).relocateOpenFile === 'function'
}

import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { checkAgainst, toJSON, Severity } from '@pragmatic-lab/todl'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type IPublishableProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
    type PublishResult,
} from '../../../services/projects/project-factory.js'
import type { BaseBindings, BaseRef } from '../../../services/projects/base-binding.js'
import { resolveBases } from '../../../services/projects/base-resolver.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'
import { ensureLibrariesBackend } from './libraries-backend.js'
import { collectTodlSources, extname, joinRel } from '../../meta-model/services/todl-sources.js'

// The 'library' project type's factory — the library module's contribution to
// the generic ProjectExplorerService (declared via `.projectFactories:` and
// resolved through the ProjectFactoryRegistry). It mirrors MetaModelProjectFactory,
// but a library is authored AGAINST a meta-model: creation binds a meta-model
// BaseRef, and publish validates every `.todl` with TODL's checkAgainst(base, …)
// before emitting the compiled TodlDocument + sources into the shared libraries
// backend under `<id>/<libVersion>/`, where architecture projects consume it.
//
// The `.todl` FILE format is edited by TodlDocumentFactory (resolved by
// extension) — editors own files, this factory owns the project. All persistence
// flows through the project's rooted IStorage (project-relative paths).
interface LibraryManifest extends ProjectManifestEnvelope
{
    id:         string           // stable publish identity, defaults to slugify(name)
    libVersion: string           // published version, defaults to '0.1.0'
    metaModel?: BaseRef          // the meta-model this library is authored against
}

export class LibraryProjectFactory extends ServiceBase implements IProjectFactory, IPublishableProjectFactory
{
    public static readonly Key = new ServiceKey<LibraryProjectFactory>('LibraryProjectFactory')
    public static readonly ProjectType = 'library'

    public readonly requiresMetaModel = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
    {
        const manifest: LibraryManifest = {
            type: LibraryProjectFactory.ProjectType, name, version: 1,
            id: slugify(name), libVersion: '0.1.0',
            ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
        }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        // Preserve the publish identity (id / libVersion) + the meta-model binding;
        // only the name tracks the project.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Validate every `.todl` against the bound meta-model; if clean, emit the
    // compiled model + copy the sources into the libraries backend under
    // `<id>/<libVersion>/`.
    public async publish(_project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        if (manifest.metaModel === undefined)
            return { ok: false, message: 'Set a meta-model binding before publishing.' }

        const { bases, problems } = await resolveBases(provider, { metaModel: manifest.metaModel })
        if (problems.length > 0) return { ok: false, message: `Publish blocked: ${problems.join('; ')}.` }

        const sources = await collectTodlSources(storage)
        if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }

        const { model, diagnostics } = checkAgainst(bases, sources)
        const errors = diagnostics.filter((d) => d.severity === Severity.Error)
        if (errors.length > 0)
            return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

        const dest = ensureLibrariesBackend(provider)
        const base = `${manifest.id}/${manifest.libVersion}`
        await dest.WriteText(`${base}/model.json`, JSON.stringify(toJSON(model), null, 2))
        for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
        return { ok: true, message: `Published ${manifest.id}@${manifest.libVersion} (${sources.length} file(s)).` }
    }

    private async buildProject(storage: IStorage, manifest: LibraryManifest): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')   // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node's children from storage. The manifest file
    // is hidden; `.todl` files are marked openable (kind 'todl'). Node paths are
    // project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = joinRel(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.todl' ? 'todl' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }
}

// ── helpers ──
function slugify(name: string): string
{
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'library'
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

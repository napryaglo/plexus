import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { Project } from './project.js'

// The contract a module's project factory implements — the behavior the
// generic ProjectExplorerService delegates to. A module declares a
// ProjectFactoryDefinition (mural) whose Factory service token resolves to an
// IProjectFactory; the explorer routes open/create/save through it, staying
// ignorant of any concrete project or file format.

// The manifest file at a project folder's root. Its `type` routes a folder to
// the factory that owns it; the rest of the manifest is factory-specific (each
// factory reads/writes its own extended shape). Only this envelope is generic.
export const PROJECT_MANIFEST_FILENAME = 'project.plexus.json'

export interface ProjectManifestEnvelope
{
    type:     string
    name?:    string
    version?: number
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

    // Project lifecycle. createProject writes an initial manifest into an empty
    // (or new) folder; openProject reads the manifest + builds the file tree;
    // saveProject persists project-level state (the manifest).
    createProject(folder: string, name: string): Promise<Project>
    openProject(folder: string): Promise<Project>
    saveProject(project: Project): Promise<void>

    // File lifecycle. openFile deserializes a project file into a tab document
    // (the host then opens it in the content host); saveFile serializes a
    // document back to its file; newFile creates an empty file of a format and
    // returns its path.
    openFile(project: Project, path: string): Promise<IDocument>
    saveFile(document: IDocument): Promise<void>
    newFile(project: Project, format: string, name: string): Promise<string>
}

import { MetaData, Model, type ICommand } from '@pragmatic-lab/mural/runtime'

import type { IProjectFactory } from './project-factory.js'
import type { IStorage } from '../storage/storage.js'
import type { Project, ProjectNode } from './project.js'

// One open project in the explorer — the VM the tree renders as a collapsible
// root. It bundles the project's model (Name + file tree) with the factory and
// storage that back it, and carries the project-specific commands (New File,
// Publish, Close) that its context menu binds. The explorer constructs one per
// open project and sets each command to a RelayCommand closing over this
// instance, so every action unambiguously names its project.
export class OpenProject extends Model
{
    static readonly NameKey = Model.RegisterProperty<string>(OpenProject, 'Name', '', MetaData.None)
    static readonly RootKey = Model.RegisterProperty<ProjectNode>(
        OpenProject, 'Root', undefined as unknown as ProjectNode, MetaData.None)
    static readonly NewFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'NewFileCommand', undefined, MetaData.None)
    static readonly PublishCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'PublishCommand', undefined, MetaData.None)
    static readonly CloseCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'CloseCommand', undefined, MetaData.None)

    private readonly project: Project
    private readonly factory: IProjectFactory
    private readonly storage: IStorage

    constructor(project: Project, factory: IProjectFactory, storage: IStorage)
    {
        super()
        this.project = project
        this.factory = factory
        this.storage = storage
        this.set_property_value(OpenProject.NameKey, project.Name)
        this.set_property_value(OpenProject.RootKey, project.Root)
    }

    public get Name(): string { return this.get_property_value(OpenProject.NameKey) }
    public get Root(): ProjectNode { return this.get_property_value(OpenProject.RootKey) }

    public get NewFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.NewFileCommandKey) }
    public set NewFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.NewFileCommandKey, v) }

    public get PublishCommand(): ICommand | undefined { return this.get_property_value(OpenProject.PublishCommandKey) }
    public set PublishCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.PublishCommandKey, v) }

    public get CloseCommand(): ICommand | undefined { return this.get_property_value(OpenProject.CloseCommandKey) }
    public set CloseCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.CloseCommandKey, v) }

    // The backing project model, factory, and storage (read-only to the explorer).
    public get Project(): Project { return this.project }
    public get Factory(): IProjectFactory { return this.factory }
    public get Storage(): IStorage { return this.storage }
    // The project's root folder — the dedupe + persistence key.
    public get Folder(): string { return this.project.RootPath }
}

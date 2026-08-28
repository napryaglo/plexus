import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type CommandDefinition, type DiagramStorage, type Diagram } from '@pragmatic-lab/mural/framework'
import { DiagramCommandExtensionKey } from './diagram-command-extension.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import { attachMediaDrop, type MediaDropDeps } from '../media/media-drop-handler.js'
import { LargeFileChoice } from '../media/media-storage.js'

// The `.diagram` document used across Plexus: a DiagramDocument that additionally
// routes app-contributed toolbar commands. When the shell dispatches a command
// this document doesn't natively run, it consults the registered
// IDiagramCommandExtension (see DiagramCommandExtensionKey) before deferring to
// the base document. Behaves exactly like DiagramDocument when no extension owns
// the command — so standalone (non-architecture) diagrams are unaffected.
export class PlexusDiagramDocument extends DiagramDocument
{
    private _wiredView: Diagram | undefined
    private _detachMediaDrop: (() => void) | undefined

    public constructor(storage: DiagramStorage, private readonly provider: IServiceProvider)
    {
        super(storage)
        // Wire OS media drop (files / links) whenever the diagram view mounts.
        // General to every .diagram — not just architecture projects.
        this.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, this._onActiveViewChanged)
    }

    private readonly _onActiveViewChanged = (): void => {
        const view = this.ActiveView
        if (view === this._wiredView) return
        this._detachMediaDrop?.()
        this._detachMediaDrop = undefined
        this._wiredView = view
        if (view === undefined) return
        const deps = this._mediaDropDeps()
        if (deps !== undefined) this._detachMediaDrop = attachMediaDrop(view, this, deps)
    }

    private _mediaDropDeps(): MediaDropDeps | undefined
    {
        const store = this.Storage
        if (!(store instanceof FileDiagramStorage)) return undefined
        return {
            storage: store.ProjectStorage,
            // Default until the large-file modal is wired (Task 9): embed the copy.
            promptLargeFile: async () => LargeFileChoice.Embed,
            newId: () => `media-${crypto.randomUUID()}`,
        }
    }

    public override Execute(definition: CommandDefinition): void
    {
        const ext = this.provider.get(DiagramCommandExtensionKey)
        if (ext !== undefined && ext.handles(definition.Id)) { ext.execute(this, definition.Id); return }
        super.Execute(definition)
    }

    public override CanExecute(definition: CommandDefinition): boolean
    {
        const ext = this.provider.get(DiagramCommandExtensionKey)
        if (ext !== undefined && ext.handles(definition.Id)) return ext.canExecute(this, definition.Id)
        return super.CanExecute(definition)
    }
}

import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type CommandDefinition, type DiagramStorage } from '@pragmatic-lab/mural/framework'
import { DiagramCommandExtensionKey } from './diagram-command-extension.js'

// The `.diagram` document used across Plexus: a DiagramDocument that additionally
// routes app-contributed toolbar commands. When the shell dispatches a command
// this document doesn't natively run, it consults the registered
// IDiagramCommandExtension (see DiagramCommandExtensionKey) before deferring to
// the base document. Behaves exactly like DiagramDocument when no extension owns
// the command — so standalone (non-architecture) diagrams are unaffected.
export class PlexusDiagramDocument extends DiagramDocument
{
    public constructor(storage: DiagramStorage, private readonly provider: IServiceProvider)
    {
        super(storage)
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

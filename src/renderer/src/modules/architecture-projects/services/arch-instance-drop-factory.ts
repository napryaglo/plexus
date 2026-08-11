import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'

import { resolveDropActions, DropActionKind, type DropAction } from './arch-drop-resolver.js'
import { defaultLabel } from './arch-default-label.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import type { ArchModel } from './arch-model.js'
import { ArchNodeVM } from './arch-node-vm.js'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto a diagram. For an architecture diagram it routes the
// drop through the project's ArchModel (Phase-3 semantics): resolve candidate
// (X,m) actions from the meta-model schema — 0 reject, 1 auto, many chooser —
// then create the routed entity, wire the reference, materialize a bound Figure,
// and persist. A standalone diagram (no ArchModel) falls back to a plain shape.
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public constructor(private readonly provider: IServiceProvider) {}

    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as IDocument
        const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
        const model = bindingSvc?.modelForDocument(doc)
        if (model === undefined) {
            // Standalone diagram: keep the old generic behavior.
            return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
        }

        // Read-filter: candidates + routing are scoped to the diagram's selected
        // viewpoints (default all when the binding service has no scope).
        const scope = bindingSvc?.scopeForDocument(doc) ?? new Set(model.viewpoints().map((v) => v.id))
        const actions = resolveDropActions(model.repository(), context.Descriptor.Key, scope)
        if (actions.length === 0) return null
        if (actions.length === 1) return this.apply(model, context, scope, actions[0])

        this.provider.getRequired(DropCandidateChooserService.Key).Show(actions, (chosen) => { this.apply(model, context, scope, chosen) })
        return null
    }

    // Create the entity for `action`, wire any reference, materialise an
    // ArchNodeVM at the drop position, and persist. Returns the VM (null if
    // no framing viewpoint). Label + Descriptor are left unset here; the
    // binding's rescan() (T6) is the sole authority that derives them.
    private apply(model: ArchModel, context: ToolboxDropContext, scope: Set<string>, action: DropAction): ArchNodeVM | null
    {
        const vp = [...model.repository().viewpointsFraming(action.concept)].find((v) => scope.has(v))
        if (vp === undefined) return null

        const entity = model.createInViewpoint(action.concept, vp)
        const schema = model.repository().effectiveSchema(action.concept)
        if (schema.fields.some((f) => f.name === 'label'))
            model.setField(entity.id, 'label', defaultLabel(model.repository(), action))
        if (action.kind === DropActionKind.Reference && action.member !== undefined && action.term !== undefined)
            model.addRef(entity.id, action.member, action.term)

        const { X, Y } = context.Position
        const vm = new ArchNodeVM()
        vm.Id = entity.id
        vm.Left = X
        vm.Top = Y
        context.Mutator.AddNode(vm)
        model.notifyChanged()      // rescan binds + labels the new node (T6)
        void model.save()          // persist the .todl (fire-and-forget)
        return vm
    }
}

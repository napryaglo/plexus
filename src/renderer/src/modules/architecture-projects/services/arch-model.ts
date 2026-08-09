import type { ModelDraft, Repository, Entity } from '@pragmatic-lab/todl'
import type { IStorage } from '../../../services/storage/storage.js'

// One viewpoint's projection over the model: the concepts it frames and the
// entities visible through it (an entity is a member when its concept is framed
// by this viewpoint, subtype-aware via Repository.viewpointsFraming).
export interface Viewpoint
{
    id: string
    framedConcepts: string[]
    members: Entity[]
}

// A live, per-project architecture model. Wraps a ModelDraft (bases ∪ own
// instances) and projects it through the meta-model's viewpoints. Read surface
// only here; mutation + save arrive in Task 2.
export class ArchModel
{
    public constructor(
        protected readonly draft: ModelDraft,
        protected readonly storage: IStorage,
        public readonly namespace: string,
    ) {}

    public entities(): Entity[]
    {
        return this.draft.ownInstances()
    }

    public repository(): Repository
    {
        return this.draft.model
    }

    public viewpoints(): Viewpoint[]
    {
        const repo = this.draft.model
        const ents = this.entities()
        return repo.viewpoints().map((id) => ({
            id,
            framedConcepts: repo.frames(id),
            members: ents.filter((e) => repo.viewpointsFraming(e.concept).includes(id)),
        }))
    }
}

import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import type { OpenProject } from '../projects/open-project.js'

// Optional post-new-file hook the ProjectExplorer calls after creating a file
// (before opening it). A no-op when unregistered — keeps the generic explorer
// decoupled from project-type-specific creation behavior (e.g. the architecture
// viewpoint picker).
export interface INewFileParticipant
{
    OnCreated(op: OpenProject, path: string): Promise<void>
}

export const NewFileParticipantKey = new ServiceKey<INewFileParticipant>('NewFileParticipant')

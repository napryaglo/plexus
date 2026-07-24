// Renderer orchestrator for the agent's refresh_project tool. Subscribes to the
// pushed agent event stream; on a RefreshProject request it resolves the target
// open project(s), re-scans + re-validates them via ProjectExplorerService, builds
// a compact problem summary from DiagnosticsService, and returns it to the agent
// bridge (which unblocks the tool call in main). Eagerly constructed at startup so
// a refresh works even if the chat panel was never opened.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { AgentEvent, IAgentApi, RefreshProjectRequest } from '../../../../shared/agent-api.js'
import { AgentEventKind } from '../../../../shared/agent-api.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { resolveOwningProject, summarizeProject, type OpenProjectRef } from './refresh-targets.js'

export class WorkspaceRefreshService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceRefreshService>('WorkspaceRefreshService')

    private readonly agent: IAgentApi
    private readonly unsubscribe: () => void

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
        {
            throw new Error(
                'WorkspaceRefreshService: window.api.agent is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.agent = bridge.agent
        this.unsubscribe = this.agent.onEvent((event) => {
            if (event.Kind === AgentEventKind.RefreshProject) void this.handle(event.Request)
        })
    }

    public Dispose(): void { this.unsubscribe() }

    private async handle(req: RefreshProjectRequest): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const open: OpenProjectRef[] = explorer.OpenProjects.ToArray().map((o) => ({ folder: o.Folder, name: o.Name }))

        let targets = open
        let note: string | undefined
        if (req.path !== undefined)
        {
            const owner = resolveOwningProject(open, req.path)
            if (owner === undefined) { targets = []; note = `No open project contains ${req.path}.` }
            else targets = [owner]
        }
        else if (open.length === 0)
        {
            note = 'No projects are open.'
        }

        try
        {
            await explorer.RefreshProjects(targets.map((t) => t.folder))
        }
        catch (e)
        {
            void this.agent.refreshProjectResult({ id: req.id, projects: [], error: (e as Error).message })
            return
        }

        const diagnostics = this.Provider.getRequired(DiagnosticsService.Key).All.ToArray()
        const projects = targets.map((t) => summarizeProject(t, diagnostics))
        void this.agent.refreshProjectResult({ id: req.id, projects, note })
    }
}

export default WorkspaceRefreshService

// The Agent capability's content service. Subscribes to the pushed agent event
// stream (window.api.agent) and folds it into an observable transcript via
// TranscriptReducer; exposes the transcript, the input draft, a send command,
// and a coarse status for the chat DataTemplate to bind. Module-local: named by
// the agent-chat module's Capability ServiceKey.
import {
    Key,
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { IAgentApi } from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { TranscriptReducer } from './transcript.js'

export class AgentService extends ServiceBase
{
    public static readonly Key = new ServiceKey<AgentService>('AgentService')

    public static readonly TranscriptKey = Model.RegisterProperty<ObservableCollection<Model>>(
        AgentService, 'Transcript', undefined as unknown as ObservableCollection<Model>, MetaData.None)
    public static readonly DraftKey = Model.RegisterProperty<string>(
        AgentService, 'Draft', '', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        AgentService, 'Status', 'idle', MetaData.None)
    public static readonly SendCommandKey = Model.RegisterProperty<ICommand>(
        AgentService, 'SendCommand', undefined as unknown as ICommand, MetaData.None)
    // Bound to a KeyDown EventTrigger on the input row; fires the turn only when
    // the pressed key is Return (the trigger fires for every bubbled keystroke).
    public static readonly SubmitCommandKey = Model.RegisterProperty<ICommand>(
        AgentService, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly reducer = new TranscriptReducer()
    private readonly agent: IAgentApi
    private readonly fallbackCwd: string
    private readonly store: OpenProjectsStore
    // The agent's target directories = the open-project folders. The first is the
    // CLI cwd; the rest ride as --add-dir. Kept in sync with the store.
    private workingDirs: readonly string[] = []
    private unsubscribe: (() => void) | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
        {
            throw new Error(
                'AgentService: window.api.agent is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.agent = bridge.agent
        this.fallbackCwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''
        this.store = provider.getRequired(OpenProjectsStore.Key)

        this.set_property_value(AgentService.TranscriptKey, this.reducer.Transcript)
        this.set_property_value(AgentService.SendCommandKey, new RelayCommand(() => this.send()))
        // Receives the KeyDown's KeyEventArgs; sends only on Return so plain typing
        // in the input doesn't post a turn.
        this.set_property_value(AgentService.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))

        // Fold every pushed agent event into the transcript.
        this.agent.onEvent((event) => this.reducer.apply(event))

        // Track the open-project set: seed from the store (forcing a load), then
        // follow changes. Each change re-targets the NEXT turn + refreshes Status.
        this.applyDirs(this.store.Current())
        void this.store.List().then((dirs) => this.applyDirs(dirs))
        this.unsubscribe = this.store.Subscribe((dirs) => this.applyDirs(dirs))
    }

    // Adopt a new open-project directory set: cache it and reflect the resulting
    // agent target (cwd + optional extras) in the Status line.
    private applyDirs(dirs: readonly string[]): void
    {
        this.workingDirs = [...dirs]
        const cwd = dirs.length > 0 ? dirs[0] : this.fallbackCwd
        const extra = dirs.length > 1 ? ` (+${dirs.length - 1} more)` : ''
        this.set_property_value(AgentService.StatusKey, `Agent directory: ${cwd}${extra}`)
    }

    // Drop the store subscription (the shell calls this when the service is torn
    // down; harmless if it isn't).
    public Dispose(): void { this.unsubscribe?.() }

    public get Transcript(): ObservableCollection<Model> { return this.get_property_value(AgentService.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(AgentService.DraftKey) }
    public set Draft(value: string) { this.set_property_value(AgentService.DraftKey, value) }
    public get Status(): string { return this.get_property_value(AgentService.StatusKey) }
    public get SendCommand(): ICommand { return this.get_property_value(AgentService.SendCommandKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(AgentService.SubmitCommandKey) }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        const dirs = this.workingDirs
        const cwd = dirs.length > 0 ? dirs[0] : this.fallbackCwd
        const addDirs = dirs.length > 0 ? dirs.slice(1) : []
        this.reducer.beginUserTurn(text)   // optimistic echo
        void this.agent.sendTurn(cwd, addDirs, text)
        this.set_property_value(AgentService.DraftKey, '')
    }
}

export default AgentService

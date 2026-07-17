// The Agent capability's content service. Subscribes to the pushed agent event
// stream (window.api.agent) and folds it into an observable transcript via
// TranscriptReducer; exposes the transcript, the input draft, a send command,
// and a coarse status for the chat DataTemplate to bind. Module-local: named by
// the agent-chat module's Capability ServiceKey.
import {
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

    private readonly reducer = new TranscriptReducer()
    private readonly agent: IAgentApi
    private readonly cwd: string

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
        this.cwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''

        this.set_property_value(AgentService.TranscriptKey, this.reducer.Transcript)
        this.set_property_value(AgentService.SendCommandKey, new RelayCommand(() => this.send()))

        // Fold every pushed agent event into the transcript.
        this.agent.onEvent((event) => this.reducer.apply(event))
    }

    public get Transcript(): ObservableCollection<Model> { return this.get_property_value(AgentService.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(AgentService.DraftKey) }
    public set Draft(value: string) { this.set_property_value(AgentService.DraftKey, value) }
    public get Status(): string { return this.get_property_value(AgentService.StatusKey) }
    public get SendCommand(): ICommand { return this.get_property_value(AgentService.SendCommandKey) }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        this.reducer.beginUserTurn(text)   // optimistic echo
        void this.agent.sendTurn(this.cwd, text)
        this.set_property_value(AgentService.DraftKey, '')
    }
}

export default AgentService

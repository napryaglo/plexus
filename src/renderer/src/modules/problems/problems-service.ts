import {
    Model, MetaData, ObservableCollection, ServiceBase, ServiceKey, RelayCommand,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { DiagnosticsService } from '../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../services/diagnostics/diagnostic.js'
import { ProjectExplorerService } from '../project-explorer/services/project-explorer-service.js'

// The three kinds of flat row the dock renders (a flattened tree: project → file
// → diagnostic). The template switches its chrome on Kind.
export enum ProblemRowKind { ProjectHeader, FileHeader, Diagnostic }

const PROJECT_BUCKET = 'Project'   // label for the null-uri (project-level) group

// One row in the dock. A Model so the .mu template binds $Label / $Detail / etc.
export class ProblemsRow extends Model
{
    public static readonly KindKey = Model.RegisterProperty<ProblemRowKind>(
        ProblemsRow, 'Kind', ProblemRowKind.Diagnostic, MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(ProblemsRow, 'Label', '', MetaData.None)
    public static readonly DetailKey = Model.RegisterProperty<string>(ProblemsRow, 'Detail', '', MetaData.None)
    public static readonly SeverityKey = Model.RegisterProperty<DiagnosticSeverity>(
        ProblemsRow, 'Severity', DiagnosticSeverity.Error, MetaData.None)
    public static readonly IsErrorKey = Model.RegisterProperty<boolean>(ProblemsRow, 'IsError', false, MetaData.None)
    public static readonly IsDiagnosticKey = Model.RegisterProperty<boolean>(ProblemsRow, 'IsDiagnostic', false, MetaData.None)
    public static readonly ProjectIdKey = Model.RegisterProperty<string>(ProblemsRow, 'ProjectId', '', MetaData.None)
    public static readonly UriKey = Model.RegisterProperty<string | null>(ProblemsRow, 'Uri', null, MetaData.None)
    public static readonly LineKey = Model.RegisterProperty<number>(ProblemsRow, 'Line', 1, MetaData.None)
    public static readonly ColumnKey = Model.RegisterProperty<number>(ProblemsRow, 'Column', 1, MetaData.None)
    public static readonly ActivateCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProblemsRow, 'ActivateCommand', undefined, MetaData.None)

    constructor(init: {
        kind: ProblemRowKind; label: string; detail?: string; severity?: DiagnosticSeverity;
        projectId?: string; uri?: string | null; line?: number; column?: number
    })
    {
        super()
        const severity = init.severity ?? DiagnosticSeverity.Error
        this.set_property_value(ProblemsRow.KindKey, init.kind)
        this.set_property_value(ProblemsRow.LabelKey, init.label)
        this.set_property_value(ProblemsRow.DetailKey, init.detail ?? '')
        this.set_property_value(ProblemsRow.SeverityKey, severity)
        this.set_property_value(ProblemsRow.IsErrorKey, severity === DiagnosticSeverity.Error)
        this.set_property_value(ProblemsRow.IsDiagnosticKey, init.kind === ProblemRowKind.Diagnostic)
        this.set_property_value(ProblemsRow.ProjectIdKey, init.projectId ?? '')
        this.set_property_value(ProblemsRow.UriKey, init.uri ?? null)
        this.set_property_value(ProblemsRow.LineKey, init.line ?? 1)
        this.set_property_value(ProblemsRow.ColumnKey, init.column ?? 1)
    }

    public get Kind(): ProblemRowKind { return this.get_property_value(ProblemsRow.KindKey) }
    public get Label(): string { return this.get_property_value(ProblemsRow.LabelKey) }
    public get ProjectId(): string { return this.get_property_value(ProblemsRow.ProjectIdKey) }
    public get Uri(): string | null { return this.get_property_value(ProblemsRow.UriKey) }
    public get Line(): number { return this.get_property_value(ProblemsRow.LineKey) }
    public get Column(): number { return this.get_property_value(ProblemsRow.ColumnKey) }
    public get ActivateCommand(): ICommand | undefined { return this.get_property_value(ProblemsRow.ActivateCommandKey) }
    public set ActivateCommand(v: ICommand | undefined) { this.set_property_value(ProblemsRow.ActivateCommandKey, v) }
}

// A grouped, observable view over the DiagnosticsService, rendered in the shell's
// Status region as the Problems dock. Rebuilds its flat Rows whenever the store
// changes; exposes rolled-up counts, an expand toggle, and row activation
// (open file + reveal the span through the project explorer).
export class ProblemsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProblemsService>('ProblemsService')

    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ProblemsRow>>(
        ProblemsService, 'Rows', undefined as unknown as ObservableCollection<ProblemsRow>, MetaData.None)
    public static readonly ErrorCountKey = Model.RegisterProperty<number>(ProblemsService, 'ErrorCount', 0, MetaData.None)
    public static readonly WarningCountKey = Model.RegisterProperty<number>(ProblemsService, 'WarningCount', 0, MetaData.None)
    // String forms for the status-bar cell (Text binds a string cleanly).
    public static readonly ErrorTextKey = Model.RegisterProperty<string>(ProblemsService, 'ErrorText', '0', MetaData.None)
    public static readonly WarningTextKey = Model.RegisterProperty<string>(ProblemsService, 'WarningText', '0', MetaData.None)
    public static readonly IsExpandedKey = Model.RegisterProperty<boolean>(ProblemsService, 'IsExpanded', false, MetaData.None)
    public static readonly ToggleCommandKey = Model.RegisterProperty<ICommand>(
        ProblemsService, 'ToggleCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProblemsService.RowsKey, new ObservableCollection<ProblemsRow>())
        this.set_property_value(ProblemsService.ToggleCommandKey,
            new RelayCommand(() => { this.IsExpanded = !this.IsExpanded }))
        const store = provider.get(DiagnosticsService.Key)
        store?.All.Subscribe(() => this.rebuild())
        this.rebuild()
    }

    public get Rows(): ObservableCollection<ProblemsRow> { return this.get_property_value(ProblemsService.RowsKey) }
    public get ErrorCount(): number { return this.get_property_value(ProblemsService.ErrorCountKey) }
    public get WarningCount(): number { return this.get_property_value(ProblemsService.WarningCountKey) }
    public get ErrorText(): string { return this.get_property_value(ProblemsService.ErrorTextKey) }
    public get WarningText(): string { return this.get_property_value(ProblemsService.WarningTextKey) }
    public get IsExpanded(): boolean { return this.get_property_value(ProblemsService.IsExpandedKey) }
    public set IsExpanded(v: boolean) { this.set_property_value(ProblemsService.IsExpandedKey, v) }
    public get ToggleCommand(): ICommand { return this.get_property_value(ProblemsService.ToggleCommandKey) }

    public Expand(): void { this.IsExpanded = true }

    // Open the row's file and scroll to its span (project-level rows do nothing).
    public ActivateRow(row: ProblemsRow): void
    {
        if (row.Uri === null) return
        void this.Provider.get(ProjectExplorerService.Key)?.OpenFileInProject(row.ProjectId, row.Uri, row.Line, row.Column)
    }

    private rebuild(): void
    {
        const store = this.Provider.get(DiagnosticsService.Key)
        const all: Diagnostic[] = store ? [...store.All] : []

        let errors = 0, warnings = 0
        for (const d of all) {
            if (d.severity === DiagnosticSeverity.Error) errors += 1
            else if (d.severity === DiagnosticSeverity.Warning) warnings += 1
        }
        this.set_property_value(ProblemsService.ErrorCountKey, errors)
        this.set_property_value(ProblemsService.WarningCountKey, warnings)
        this.set_property_value(ProblemsService.ErrorTextKey, String(errors))
        this.set_property_value(ProblemsService.WarningTextKey, String(warnings))

        // Group project → file (null-uri under a "Project" bucket), preserving
        // first-seen order for a stable list.
        const byProject = new Map<string, { name: string; byFile: Map<string, Diagnostic[]> }>()
        for (const d of all) {
            let proj = byProject.get(d.projectId)
            if (proj === undefined) { proj = { name: d.projectName, byFile: new Map() }; byProject.set(d.projectId, proj) }
            const fileKey = d.uri ?? PROJECT_BUCKET
            const list = proj.byFile.get(fileKey)
            if (list === undefined) proj.byFile.set(fileKey, [d]); else list.push(d)
        }

        const rows = this.Rows
        rows.Clear()
        const multiProject = byProject.size > 1
        for (const [projectId, proj] of byProject) {
            if (multiProject) rows.Add(new ProblemsRow({ kind: ProblemRowKind.ProjectHeader, label: proj.name }))
            for (const [fileKey, diags] of proj.byFile) {
                const fileLabel = fileKey === PROJECT_BUCKET ? PROJECT_BUCKET : fileNameOf(fileKey)
                rows.Add(new ProblemsRow({ kind: ProblemRowKind.FileHeader, label: fileLabel, detail: `${diags.length}` }))
                for (const d of diags) {
                    const row = new ProblemsRow({
                        kind: ProblemRowKind.Diagnostic,
                        label: d.message,
                        detail: d.span ? `${d.span.startLine}:${d.span.startColumn}` : '',
                        severity: d.severity,
                        projectId,
                        uri: d.uri,
                        line: d.span?.startLine ?? 1,
                        column: d.span?.startColumn ?? 1,
                    })
                    row.ActivateCommand = new RelayCommand(() => this.ActivateRow(row))
                    rows.Add(row)
                }
            }
        }
    }
}

function fileNameOf(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

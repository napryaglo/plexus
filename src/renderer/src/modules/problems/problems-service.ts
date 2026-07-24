import {
    Model, MetaData, ObservableCollection, ServiceBase, ServiceKey, RelayCommand,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { DiagnosticsService } from '../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../services/diagnostics/diagnostic.js'
import { ProjectExplorerService } from '../project-explorer/services/project-explorer-service.js'

// A standalone ServiceKey (like the framework's DiagramEditingContext). The
// StatusBar ShellControlDefinition references THIS as its DataContext: the shell
// resolves it via provider.get(def.DataContext) with no class→Key normalization,
// so it must be handed the ServiceKey instance, not the ProblemsService class.
export const ProblemsServiceKey = new ServiceKey<ProblemsService>('ProblemsService')

// The row kinds the dock renders: an optional project header (only when several
// projects have problems), then one self-contained Diagnostic row per problem.
export enum ProblemRowKind { ProjectHeader, Diagnostic }

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
    public get Detail(): string { return this.get_property_value(ProblemsRow.DetailKey) }
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
//
// The Key is the standalone ProblemsServiceKey (below the imports) — the .mu
// StatusBar control references THAT ServiceKey as its DataContext, because the
// shell resolves it via provider.get(token) with no class→Key normalization.
export class ProblemsService extends ServiceBase
{
    public static readonly Key = ProblemsServiceKey

    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ProblemsRow>>(
        ProblemsService, 'Rows', undefined as unknown as ObservableCollection<ProblemsRow>, MetaData.None)
    public static readonly ErrorCountKey = Model.RegisterProperty<number>(ProblemsService, 'ErrorCount', 0, MetaData.None)
    public static readonly WarningCountKey = Model.RegisterProperty<number>(ProblemsService, 'WarningCount', 0, MetaData.None)
    // The status-bar cell's face text (e.g. "3 errors, 2 warnings" / "No problems").
    public static readonly SummaryTextKey = Model.RegisterProperty<string>(ProblemsService, 'SummaryText', 'No problems', MetaData.None)
    // Drives the MenuButton popup open (bound one-way IsOpen = $IsOpen): a failed
    // publish sets it true via Expand() to surface the problems.
    public static readonly IsOpenKey = Model.RegisterProperty<boolean>(ProblemsService, 'IsOpen', false, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProblemsService.RowsKey, new ObservableCollection<ProblemsRow>())
        const store = provider.get(DiagnosticsService.Key)
        store?.All.Subscribe(() => this.rebuild())
        this.rebuild()
    }

    public get Rows(): ObservableCollection<ProblemsRow> { return this.get_property_value(ProblemsService.RowsKey) }
    public get ErrorCount(): number { return this.get_property_value(ProblemsService.ErrorCountKey) }
    public get WarningCount(): number { return this.get_property_value(ProblemsService.WarningCountKey) }
    public get SummaryText(): string { return this.get_property_value(ProblemsService.SummaryTextKey) }
    public get IsOpen(): boolean { return this.get_property_value(ProblemsService.IsOpenKey) }
    public set IsOpen(v: boolean) { this.set_property_value(ProblemsService.IsOpenKey, v) }

    public Expand(): void { this.IsOpen = true }

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
        this.set_property_value(ProblemsService.SummaryTextKey, summarize(errors, warnings))

        // Group by project (first-seen order) only to insert a project header when
        // more than one project has problems. Within a project, each diagnostic is
        // ONE self-contained row: the message plus its file + location — no separate
        // file-header rows (which read as disconnected siblings in a flat popup).
        const byProject = new Map<string, { name: string; diags: Diagnostic[] }>()
        for (const d of all) {
            let proj = byProject.get(d.projectId)
            if (proj === undefined) { proj = { name: d.projectName, diags: [] }; byProject.set(d.projectId, proj) }
            proj.diags.push(d)
        }

        const rows = this.Rows
        rows.Clear()
        const multiProject = byProject.size > 1
        for (const [projectId, proj] of byProject) {
            if (multiProject) rows.Add(new ProblemsRow({ kind: ProblemRowKind.ProjectHeader, label: proj.name }))
            for (const d of proj.diags) {
                const row = new ProblemsRow({
                    kind: ProblemRowKind.Diagnostic,
                    label: d.message,
                    detail: locationLabel(d),
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

// The "where" for a diagnostic row: "file.todl 3:5", "file.todl", or "" (a
// project-level problem like an unresolved base binding has no file/line).
function locationLabel(d: Diagnostic): string
{
    const file = d.uri === null ? '' : fileNameOf(d.uri)
    const loc = d.span ? `${d.span.startLine}:${d.span.startColumn}` : ''
    return [file, loc].filter(Boolean).join(' ')
}

function fileNameOf(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// The status-bar cell's face text — a glanceable count, or "No problems" when clean.
function summarize(errors: number, warnings: number): string
{
    if (errors === 0 && warnings === 0) return 'No problems'
    const parts: string[] = []
    if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`)
    if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
    return parts.join(', ')
}

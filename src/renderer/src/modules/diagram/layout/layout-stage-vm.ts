import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import type { CatalogStrategy } from '@pragmatic-lab/fresco'

// The "use the framework default for this stage" choice — selecting it leaves
// the stage unset in the PipelineConfiguration (LayoutPipeline's own default
// strategy applies).
export const DEFAULT_OPTION = '(default)'

// One row of the layout-stage builder: a stage label and a ComboBox of the
// strategies available for it (by display name), plus the current selection.
// A real Model so the .mu two-column template resolves by DataType and the
// ComboBox can two-way bind ItemsSource/SelectedItem. Selecting an option
// calls back into the service to update PipelineConfiguration.layout.
export class LayoutStageVM extends Model
{
    static readonly LabelKey = Model.RegisterProperty<string>(
        LayoutStageVM, 'Label', '', MetaData.None)
    static readonly OptionsKey = Model.RegisterProperty<ObservableCollection<string>>(
        LayoutStageVM, 'Options', undefined as unknown as ObservableCollection<string>, MetaData.None)
    static readonly SelectedKey = Model.RegisterProperty<string>(
        LayoutStageVM, 'Selected', DEFAULT_OPTION, MetaData.None)

    private readonly nameToClassName = new Map<string, string>()

    // onChange receives the chosen strategy's className, or undefined for the
    // "(default)" option.
    constructor(label: string, strategies: readonly CatalogStrategy[], private readonly onChange: (className: string | undefined) => void)
    {
        super()
        this.set_property_value(LayoutStageVM.LabelKey, label)

        const opts = new ObservableCollection<string>()
        opts.Add(DEFAULT_OPTION)
        for (const s of strategies)
        {
            opts.Add(s.name)
            this.nameToClassName.set(s.name, s.className)
        }
        this.set_property_value(LayoutStageVM.OptionsKey, opts)

        this.AddPropertyChangedListener(LayoutStageVM.SelectedKey, () => this.emit())
    }

    public get Label(): string { return this.get_property_value(LayoutStageVM.LabelKey) }
    public get Options(): ObservableCollection<string> { return this.get_property_value(LayoutStageVM.OptionsKey) }
    public get Selected(): string { return this.get_property_value(LayoutStageVM.SelectedKey) }
    public set Selected(v: string) { this.set_property_value(LayoutStageVM.SelectedKey, v) }

    private emit(): void
    {
        const sel = this.Selected
        this.onChange(sel === DEFAULT_OPTION ? undefined : this.nameToClassName.get(sel))
    }
}

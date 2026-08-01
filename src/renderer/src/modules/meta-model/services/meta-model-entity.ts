// meta-model-entity.ts — the data object a double-clicked ontology entity is
// projected into for the drawer. MetaModelEntity is BOTH the `instantiate` ctx
// symbol the generated presentation references (DataType = MetaModelEntity) AND
// the DataType the drawer's detail template binds. UITemplate holds the RESOLVED
// mm:<id> DataTemplate (filled by the service; undefined when unavailable); the
// drawer's ContentPresenter applies it (Content = entity, ContentTemplate =
// UITemplate) — the presenter owns the built visual, so nothing here is a Visual.
import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { DataTemplate } from '@pragmatic-lab/mural/basic'

export class MetaModelField extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(
        MetaModelField, 'Name', '', MetaData.None)
    public static readonly TypeKey = Model.RegisterProperty<string>(
        MetaModelField, 'Type', '', MetaData.None)
    public static readonly CardinalityKey = Model.RegisterProperty<number>(
        MetaModelField, 'Cardinality', 0, MetaData.None)

    public get Name(): string { return this.get_property_value(MetaModelField.NameKey) }
    public set Name(v: string) { this.set_property_value(MetaModelField.NameKey, v) }
    public get Type(): string { return this.get_property_value(MetaModelField.TypeKey) }
    public set Type(v: string) { this.set_property_value(MetaModelField.TypeKey, v) }
    public get Cardinality(): number { return this.get_property_value(MetaModelField.CardinalityKey) }
    public set Cardinality(v: number) { this.set_property_value(MetaModelField.CardinalityKey, v) }
}

export class MetaModelEntity extends Model
{
    public static readonly IdKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'Id', '', MetaData.None)
    public static readonly TypeOfKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'TypeOf', '', MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'Label', '', MetaData.None)
    public static readonly AttrsKey = Model.RegisterProperty<Record<string, unknown>>(
        MetaModelEntity, 'Attrs', {}, MetaData.None)
    public static readonly FieldsKey = Model.RegisterProperty<ObservableCollection<MetaModelField>>(
        MetaModelEntity, 'Fields',
        undefined as unknown as ObservableCollection<MetaModelField>, MetaData.None)
    public static readonly UITemplateKey = Model.RegisterProperty<DataTemplate | undefined>(
        MetaModelEntity, 'UITemplate', undefined, MetaData.None)
    public static readonly AnnotationsKey = Model.RegisterProperty<Record<string, Record<string, unknown>>>(
        MetaModelEntity, 'Annotations', {}, MetaData.None)

    public constructor()
    {
        super()
        this.set_property_value(MetaModelEntity.FieldsKey, new ObservableCollection<MetaModelField>())
    }

    public get Id(): string { return this.get_property_value(MetaModelEntity.IdKey) }
    public set Id(v: string) { this.set_property_value(MetaModelEntity.IdKey, v) }
    public get TypeOf(): string { return this.get_property_value(MetaModelEntity.TypeOfKey) }
    public set TypeOf(v: string) { this.set_property_value(MetaModelEntity.TypeOfKey, v) }
    public get Label(): string { return this.get_property_value(MetaModelEntity.LabelKey) }
    public set Label(v: string) { this.set_property_value(MetaModelEntity.LabelKey, v) }
    public get Attrs(): Record<string, unknown> { return this.get_property_value(MetaModelEntity.AttrsKey) }
    public set Attrs(v: Record<string, unknown>) { this.set_property_value(MetaModelEntity.AttrsKey, v) }
    public get Fields(): ObservableCollection<MetaModelField> { return this.get_property_value(MetaModelEntity.FieldsKey) }
    public get UITemplate(): DataTemplate | undefined { return this.get_property_value(MetaModelEntity.UITemplateKey) }
    public set UITemplate(v: DataTemplate | undefined) { this.set_property_value(MetaModelEntity.UITemplateKey, v) }
    public get Annotations(): Record<string, Record<string, unknown>> { return this.get_property_value(MetaModelEntity.AnnotationsKey) }
    public set Annotations(v: Record<string, Record<string, unknown>>) { this.set_property_value(MetaModelEntity.AnnotationsKey, v) }
}

import { Model, MetaData, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

// The window-height feed behind a seam so ViewportService is testable without a
// real DOM. The default implementation (windowViewportSource) reads the renderer
// window; tests inject a fake that can push heights.
export interface IViewportSource
{
    height(): number
    subscribe(onChange: () => void): () => void
}

function windowViewportSource(): IViewportSource
{
    return {
        height: () => window.innerHeight,
        subscribe: (onChange) => {
            window.addEventListener('resize', onChange)
            return () => window.removeEventListener('resize', onChange)
        },
    }
}

// Tracks the live viewport (window) height as a bindable Height DP and notifies
// Subscribe listeners on every resize. Consumers that need a value derived from
// the window size (the Problems popup caps its list at 30% of Height) subscribe
// here rather than touching the DOM.
export class ViewportService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ViewportService>('ViewportService')
    public static readonly HeightKey = Model.RegisterProperty<number>(ViewportService, 'Height', 0, MetaData.None)

    private readonly listeners = new Set<() => void>()

    constructor(provider: IServiceProvider, source: IViewportSource = windowViewportSource())
    {
        super(provider)
        this.set_property_value(ViewportService.HeightKey, source.height())
        source.subscribe(() => {
            this.set_property_value(ViewportService.HeightKey, source.height())
            for (const l of this.listeners) l()
        })
    }

    public get Height(): number { return this.get_property_value(ViewportService.HeightKey) }

    // Fired on every resize (after Height is updated). Returns an unsubscribe thunk.
    public Subscribe(listener: () => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}

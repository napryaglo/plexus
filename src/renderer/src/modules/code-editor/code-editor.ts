import * as monaco from 'monaco-editor'
import './monaco-env.js'
import { DomHost } from '@pragmatic-lab/mural/basic'
import { Color, DataContextBinding, Model, MetaData, ObservableCollection, Size, type PropertyDescriptor } from '@pragmatic-lab/mural/runtime'
import { SolidColorBrush } from '@pragmatic-lab/mural/visual-engine'
import { toMarkers, type EditorDiagnostic } from './editor-diagnostic.js'

// The Monaco theme name this control defines from mural's resolved tokens.
const MURAL_THEME = 'mural'

// Owner id for the markers this control sets — namespaces our diagnostics so
// setModelMarkers replaces only ours, never another provider's.
const MARKER_OWNER = 'meta-model'

// A DomHost that hosts a Monaco editor. It IS the foreign control — overriding
// DomHost.CreateHostElement to build Monaco inside the slot-filling host
// element. It is a pure VIEW: the document (its DataContext) owns the text and
// save/dirty, exactly as a Diagram binds a DiagramDocument's Nodes. The editor
// is declared directly in DataTemplate[CodeDocument] and configured by property
// bindings:
//
//     CodeEditor [ Text = $Content, Language = $Language ]
//
// Text is BindsTwoWayByDefault, so a user's edits flow back into the document's
// Content DP without an explicit binding mode. Monaco ↔ Text stays in sync
// through an `updating` guard that suppresses the echo in whichever direction
// isn't the origin of a given change.
export class CodeEditor extends DomHost
{
    // The editor's text, TwoWay by default: the document binds $Content here and
    // receives edits back through the same binding.
    public static readonly TextKey = Model.RegisterProperty<string>(
        CodeEditor, 'Text', '', MetaData.BindsTwoWayByDefault)

    // Monaco language id (e.g. 'typescript'). The document derives it from the
    // file extension and binds $Language.
    public static readonly LanguageKey = Model.RegisterProperty<string>(
        CodeEditor, 'Language', 'plaintext', MetaData.None)

    // Diagnostics against the text — the document binds its Diagnostics channel
    // here; we render them as Monaco markers. It is one ObservableCollection
    // instance whose CONTENTS change (Clear/Add) rather than being replaced, so
    // we subscribe to the collection, not just the DP.
    public static readonly DiagnosticsKey = Model.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
        CodeEditor, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)

    // A one-shot reveal request from the document (Problems-dock navigation): the
    // document binds its RevealRequest here; on change we scroll to + select it.
    public static readonly RevealRequestKey = Model.RegisterProperty<{ line: number; column: number; seq: number } | undefined>(
        CodeEditor, 'RevealRequest', undefined, MetaData.None)

    private editor: monaco.editor.IStandaloneCodeEditor | undefined
    // True while WE push a change across the Monaco↔DP boundary, so the
    // resulting echo on the other side is ignored (no feedback loop).
    private updating = false
    // Unsubscribe from the currently-bound Diagnostics collection.
    private diagUnsub: (() => void) | undefined

    // The editor is declared bare in DataTemplate[CodeDocument] and binds itself
    // to its DataContext (the document) here. This is exactly what markup
    // `Text = $Content, Language = $Language` would emit — relocated into the
    // control because the .mu compiler can't resolve an app-local control's DP
    // metadata to bind its properties in markup (only framework controls). Text
    // is BindsTwoWayByDefault, so edits flow back to the document's Content.
    constructor()
    {
        super()
        // `as unknown as T`: set_property_value accepts a Binding at runtime
        // (Model special-cases `value instanceof Binding`); the cast satisfies
        // its typed signature — the same idiom mural uses (inspector-stack.ts).
        this.set_property_value(
            CodeEditor.TextKey, DataContextBinding(this, 'Content') as unknown as string)
        this.set_property_value(
            CodeEditor.LanguageKey, DataContextBinding(this, 'Language') as unknown as string)
        this.set_property_value(
            CodeEditor.DiagnosticsKey,
            DataContextBinding(this, 'Diagnostics') as unknown as ObservableCollection<EditorDiagnostic>)
        this.set_property_value(
            CodeEditor.RevealRequestKey,
            DataContextBinding(this, 'RevealRequest') as unknown as { line: number; column: number; seq: number } | undefined)
    }

    public get Text(): string { return this.get_property_value(CodeEditor.TextKey) }
    public set Text(v: string) { this.set_property_value(CodeEditor.TextKey, v) }

    public get Language(): string { return this.get_property_value(CodeEditor.LanguageKey) }
    public set Language(v: string) { this.set_property_value(CodeEditor.LanguageKey, v) }

    public get Diagnostics(): ObservableCollection<EditorDiagnostic> | undefined
    {
        return this.get_property_value(CodeEditor.DiagnosticsKey)
    }

    // Build the host element (DomHost's sized container) and mount Monaco into
    // it, seeded from the current Text/Language. Runs once, lazily, from
    // HostElement — which MeasureOverride pokes the first time this control is
    // measured in the tree, so the editor materialises as soon as it has a slot.
    protected override CreateHostElement(document: Document): HTMLElement
    {
        const el = super.CreateHostElement(document)
        // Monaco fully owns keyboard input while focused, so stop key events at
        // the host boundary. mural's HtmlTarget listens for keydown/keyup on the
        // SVG root and routes them to its focused Visual — but clicking a DomHost
        // never moves mural focus (InjectPointerDown doesn't focus the hit; only a
        // control's own pointer handler does). So mural's focus stays on whatever
        // was last clicked — e.g. the project explorer, a Selector that treats
        // Space as "activate" and pulls focus. Without this, a Space (or any key)
        // typed in the editor bubbles out of the <foreignObject> to that stale
        // focus and yanks it away. Monaco's own handlers sit on its inner textarea
        // (deeper in the tree), so they've already run by the time the event
        // bubbles up to here; stopPropagation only blocks the leak to mural, and
        // we don't preventDefault, so the editor still inserts the character.
        // See DomHost's note: a host that must fully own input stops propagation
        // at its element boundary.
        const swallowKey = (e: Event): void => e.stopPropagation()
        el.addEventListener('keydown', swallowKey)
        el.addEventListener('keyup', swallowKey)
        // Build Monaco's theme from mural's live tokens BEFORE create so the
        // editor never flashes its default palette. We're in the tree by now
        // (MeasureOverride poked us), so TryFindResource resolves app resources.
        const theme = this.defineMuralTheme()
        this.editor = monaco.editor.create(el, {
            value:           this.Text,
            language:        this.Language,
            theme,
            automaticLayout: true,
            minimap:         { enabled: false },
        })
        // Monaco → DP: push user edits into Text (ignored when WE set the value).
        this.editor.onDidChangeModelContent(() =>
        {
            if (this.updating) return
            this.updating = true
            this.Text = this.editor?.getValue() ?? ''
            this.updating = false
        })
        // Catch up on diagnostics bound before the editor existed (the binding may
        // resolve before mount), and reflect any already-present ones.
        this.bindDiagnostics(this.Diagnostics)
        // Replay a reveal that arrived before mount (dock navigation opens a tab
        // then reveals; the editor may not exist yet on first open).
        if (this.pendingReveal !== undefined)
        {
            const { line, column } = this.pendingReveal
            this.pendingReveal = undefined
            this.revealSpan(line, column)
        }
        return el
    }

    // (Re)subscribe to a bound Diagnostics collection and render it. The document
    // mutates one collection instance in place (Clear/Add), so we listen to the
    // collection's changes; applyMarkers no-ops until the editor exists.
    private bindDiagnostics(collection: ObservableCollection<EditorDiagnostic> | undefined): void
    {
        this.diagUnsub?.()
        this.diagUnsub = collection?.Subscribe(() => this.applyMarkers())
        this.applyMarkers()
    }

    private applyMarkers(): void
    {
        const model = this.editor?.getModel()
        if (model === null || model === undefined) return
        monaco.editor.setModelMarkers(model, MARKER_OWNER, toMarkers(this.Diagnostics?.ToArray() ?? []))
    }

    // A reveal requested before the editor mounted, replayed once it exists.
    private pendingReveal: { line: number; column: number } | undefined

    // Scroll to + select (line, column) — both 1-based. Buffers the request when
    // the editor isn't mounted yet (open-then-reveal from the Problems dock).
    private revealSpan(line: number, column: number): void
    {
        if (this.editor === undefined) { this.pendingReveal = { line, column }; return }
        const range = new monaco.Range(line, column, line, column)
        this.editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth)
        this.editor.setSelection(range)
        this.editor.focus()
    }

    // Self-materialise: touching HostElement the first time we're measured in
    // the tree runs CreateHostElement, so no external code has to poke us to
    // mount. (Base DomHost stays lazy — an empty host has nothing to show.)
    protected override MeasureOverride(available: Size): Size
    {
        void this.HostElement
        return super.MeasureOverride(available)
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        // Rebind diagnostics even before the editor mounts (subscription is cheap;
        // applyMarkers no-ops until there's a model to mark).
        if (descriptor.Name === 'Diagnostics')
        {
            this.bindDiagnostics(newValue as ObservableCollection<EditorDiagnostic> | undefined)
            return
        }
        if (descriptor.Name === 'RevealRequest')
        {
            const req = newValue as { line: number; column: number } | undefined
            if (req !== undefined) this.revealSpan(req.line, req.column)
            return
        }
        if (this.editor === undefined) return
        // DP → Monaco: reflect an external Text change (initial load, a
        // programmatic set) into the buffer, unless Monaco itself was the origin.
        if (descriptor.Name === 'Text' && !this.updating)
        {
            const next = newValue as string
            if (this.editor.getValue() !== next)
            {
                this.updating = true
                this.editor.setValue(next)
                this.updating = false
            }
        }
        else if (descriptor.Name === 'Language')
        {
            const model = this.editor.getModel()
            if (model !== null) monaco.editor.setModelLanguage(model, newValue as string)
        }
    }

    public dispose(): void
    {
        this.diagUnsub?.()
        this.diagUnsub = undefined
        this.editor?.dispose()
        this.editor = undefined
    }

    // Resolve a mural color token (@Surface, @OnSurface, …) off this control's
    // resource scope. Returns the token's Color, or undefined if unresolved /
    // not a solid brush (the theme then falls back to the Monaco base).
    private themeColor(token: string): Color | undefined
    {
        const brush = this.TryFindResource(token)
        return brush instanceof SolidColorBrush ? brush.Color : undefined
    }

    // Define the 'mural' Monaco theme from the resolved surface tokens — chrome
    // only (background, gutter, line numbers, cursor, selection, line highlight,
    // widget borders); syntax token colors stay the Monaco base's, which is
    // tuned for legibility. Base (vs / vs-dark) is chosen from Surface luminance
    // so a light or dark mural scheme both read correctly. Resolved once at
    // mount — a runtime theme switch won't live-update the editor.
    private defineMuralTheme(): string
    {
        const surface        = this.themeColor('Surface')
        const onSurface      = this.themeColor('OnSurface')
        const onSurfaceVar   = this.themeColor('OnSurfaceVariant')
        const primary        = this.themeColor('Primary')
        const outlineVariant = this.themeColor('OutlineVariant')
        const container      = this.themeColor('SurfaceContainer')
        const containerHigh  = this.themeColor('SurfaceContainerHighest')

        const colors: Record<string, string> = {}
        const set = (key: string, c: Color | undefined): void => { if (c !== undefined) colors[key] = c.ToHex() }
        set('editor.background',                surface)
        set('editor.foreground',                onSurface)
        set('editorGutter.background',          surface)
        set('editorLineNumber.foreground',      onSurfaceVar)
        set('editorLineNumber.activeForeground', onSurface)
        set('editorCursor.foreground',          primary)
        // Selection is a translucent Primary wash so the text under it stays readable.
        if (primary !== undefined) colors['editor.selectionBackground'] = primary.WithAlpha(0x4d).ToHex()
        set('editor.lineHighlightBackground',   containerHigh)
        set('editorIndentGuide.background',     outlineVariant)
        set('editorWidget.background',          container)
        set('editorWidget.border',              outlineVariant)
        set('editorHoverWidget.background',     container)
        set('editorHoverWidget.border',         outlineVariant)

        // Relative luminance (Rec. 601) of Surface decides light vs dark base.
        const dark = surface === undefined
            || (0.299 * surface.R + 0.587 * surface.G + 0.114 * surface.B) < 128
        monaco.editor.defineTheme(MURAL_THEME, {
            base:    dark ? 'vs-dark' : 'vs',
            inherit: true,
            rules:   [],
            colors,
        })
        return MURAL_THEME
    }
}

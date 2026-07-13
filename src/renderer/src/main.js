// Renderer bootstrap — a thin plain-JS entry (mural convention: bootstraps
// stay plain JS). Vite bundles this and everything it pulls in, resolving
// `@visualisation-sub/mural/*` to the built dist (see electron.vite.config).
//
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the mural UI into #app. In the Electron renderer this is
// Chromium, so mural's SVG pipeline runs exactly as it does in a browser.
// Self-hosted icon font (@font-face). Imported before anything else so the face
// is registered by the time `document.fonts.load` runs below — resolves from
// local disk instead of the Google CDN, so the shell isn't gated on two network
// round-trips (was a multi-second white window). See fonts.css.
import './fonts.css'
import { app } from './app.mu.js'
import { HtmlTarget } from '@visualisation-sub/mural/visual-engine'
import { ContentHostService, InspectorService } from '@visualisation-sub/mural/framework'
import { DiagramWorkspaceService } from './modules/diagram/services/diagram-workspace-service.js'
import { attachAutoOpenInspector } from './modules/diagram/behaviors/auto-open-inspector-behavior.js'
import { registerThemeSchemePicker } from './theme/register-scheme-picker.js'

// Surface any uncaught error prominently (a swallowed mount throw shows as a
// blank white window otherwise).
window.addEventListener('error', (e) => console.error('[plexus] uncaught:', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => console.error('[plexus] unhandled rejection:', e.reason))

// Pin layout to the loaded icon-font metrics before mounting — measureText
// returns fallback widths until the @font-face resolves.
await document.fonts.load('24px "Material Symbols Outlined"')
try {
    app.initialize(new HtmlTarget(document.getElementById('app')))
    // Contribute the right-aligned status-bar colour-scheme picker (a service-
    // bound shell control) before opening the first document, so the toolbar
    // service surfaces it on the document-open rebuild.
    registerThemeSchemePicker(app)
    // Open the seeded diagram as the initial document. The content region is
    // document-driven (DocumentsContentHostService under ContentHostService.Key),
    // so opening the workspace's document activates it → the canvas renders via
    // DataTemplate[DiagramDocument]. Composition-root concern: the bootstrap
    // decides what's open at launch.
    const host = app.Services.get(ContentHostService.Key)
    const workspace = app.Services.get(DiagramWorkspaceService.Key)
    if (host !== undefined && workspace !== undefined) host.Open(workspace.Document)

    // Auto-open the Format Shape inspector the first time a shape is selected.
    // Watches the document's ActiveView (published when the canvas mounts), so it
    // wires up even though the canvas is created later inside a DataTemplate.
    const inspectors = app.Services.get(InspectorService.Key)
    if (workspace !== undefined && inspectors !== undefined)
    {
        attachAutoOpenInspector(workspace.Document, inspectors)
    }
} catch (err) {
    console.error('[plexus] mount failed:', err)
    throw err
}

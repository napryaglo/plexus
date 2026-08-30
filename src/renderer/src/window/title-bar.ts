// Custom title-bar wiring for the renderer.
//
// The window runs with a hidden OS title bar (titleBarStyle: 'hidden'); the HTML
// #titlebar band in index.html is the app's own draggable strip. This module
// keeps it in sync with app state:
//   • Title text  — the active document's Title, else the open project's Name,
//                   else "Plexus". Mirrored to document.title (taskbar/window).
//   • WCO colours — on every scheme change, re-tints the native caption buttons
//                   (via the window.api.titlebar bridge → setTitleBarOverlay) and
//                   the HTML band's own background/foreground (CSS vars) so the
//                   strip and the buttons read as one surface.
//   • macOS       — floats its traffic lights top-left, so tag <body> to swap
//                   the band's insets (index.html's body.is-mac rule).
import { Application, ThemeManager } from '@pragmatic-lab/mural/runtime'
import { SolidColorBrush } from '@pragmatic-lab/mural/visual-engine'
import {
    ContentHostService,
    DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-lab/mural/framework'
import { ProjectExplorerService } from '../modules/project-explorer/services/project-explorer-service.js'

// Title-bar tokens: the band + caption strip paint @SurfaceContainer (matching
// the command toolbar and side-pane header just below), inked @OnSurfaceVariant.
const BG_TOKEN     = 'SurfaceContainer'
const SYMBOL_TOKEN = 'OnSurfaceVariant'

// The preload bridge (window.api.titlebar) — untyped here (main.js-style access);
// absent when running outside Electron (e.g. a plain browser preview).
interface TitleBarBridge { setOverlay(colors: { color: string; symbolColor: string }): void }
function bridge(): TitleBarBridge | undefined {
    return (globalThis as unknown as { api?: { titlebar?: TitleBarBridge } }).api?.titlebar
}

// Resolve a colour token to an opaque #rrggbb hex from the active scheme.
function tokenHex(token: string, fallback: string): string {
    const res = Application.current?.Resources.Resolve(token)
    return res instanceof SolidColorBrush ? res.Color.ToHex().slice(0, 7) : fallback
}

export function attachTitleBar(app: Application): void {
    const titleEl = document.getElementById('plexus-title')
    const platform = (globalThis as unknown as { api?: { environment?: { Platform?: string } } }).api?.environment?.Platform
    if (platform === 'darwin') document.body.classList.add('is-mac')

    const host    = app.Services.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    const explorer = app.Services.get(ProjectExplorerService.Key)

    const currentTitle = (): string => {
        const doc = host?.ActiveDocument as IDocument | undefined
        if (doc?.Title) return doc.Title
        const projects = explorer?.OpenProjects
        if (projects && projects.Count > 0) return projects.Get(0)?.Name || 'Plexus'
        return 'Plexus'
    }
    const updateTitle = (): void => {
        const name = currentTitle()
        if (titleEl) titleEl.textContent = name
        document.title = name === 'Plexus' ? 'Plexus' : `${name} — Plexus`
    }
    host?.AddPropertyChangedListener(DocumentsContentHostService.ActiveDocumentKey, updateTitle)
    explorer?.OpenProjects.Subscribe(updateTitle)
    updateTitle()

    const pushOverlay = (): void => {
        const color       = tokenHex(BG_TOKEN, '#1c1b1f')
        const symbolColor = tokenHex(SYMBOL_TOKEN, '#cac4d0')
        document.documentElement.style.setProperty('--titlebar-bg', color)
        document.documentElement.style.setProperty('--titlebar-fg', symbolColor)
        bridge()?.setOverlay({ color, symbolColor })
    }
    ThemeManager.AddActivatedListener(pushOverlay)
    pushOverlay()
}

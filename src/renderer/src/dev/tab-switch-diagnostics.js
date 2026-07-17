// TEMPORARY diagnostic — remove once the tab→canvas swap is root-caused.
//
// The framework swap is proven correct in isolation (mural regression tests:
// tab-selecteditem-twoway, diagram-tab-switch, diagram-tab-switch-dom). Yet in
// the running app the tab highlight moves while the canvas appears frozen. This
// logs, on every ActiveDocument change, whether the swap happened LOGICALLY and
// whether the VISUAL tree followed — so we can tell a stuck-logical-state bug
// from a paint/DOM bug.
import { ContentControl, ContentHostService, Connector, Diagram, DocumentsContentHostService, ItemsControl } from '@pragmatic-lab/mural/framework'
import { DataTemplate } from '@pragmatic-lab/mural/basic'

// Walk a Visual subtree collecting every Diagram control.
function collectDiagrams(visual, out) {
    if (visual === undefined || visual === null) return
    if (visual instanceof Diagram) out.push(visual)
    const kids = visual.visualChildren
    if (kids !== undefined) for (const c of kids) collectDiagrams(c, out)
}

function docLabel(doc) {
    if (doc === undefined || doc === null) return '<none>'
    const nodes = doc.Nodes !== undefined ? doc.Nodes.Count : '?'
    return `${doc.Id ?? '?'} "${doc.Title ?? '?'}" nodes=${nodes}`
}

// Register EVERY Diagram instance ever constructed (via a one-time patch of a
// method that always runs), so we can count how many are still subscribed to a
// given document's Nodes. A Diagram subscribed to a live Nodes collection can't
// be GC'd (the collection holds a listener → CollectionView → Diagram), so a
// count > 1 for the active doc proves the outgoing-Diagram disposal leak.
const _liveDiagrams = new Set()
let _patched = false
function patchDiagramRegistry() {
    if (_patched) return
    _patched = true
    const proto = Diagram.prototype
    const orig = proto.OnPropertyChanged
    proto.OnPropertyChanged = function (...a) {
        _liveDiagrams.add(this)
        return orig.apply(this, a)
    }
}

// ── STAGE PROFILER ─────────────────────────────────────────────────────
// A tab switch is one synchronous longtask. To see WHERE the ~800ms goes we
// wrap the coarse realization stages and keep cumulative {ms, calls} buckets;
// the pointerup handler snapshots them before/after a switch and logs the
// per-switch delta. Same monkey-patch technique as the Diagram registry above.
// Each bucket also keeps a per-class tally (`by`) so we can see WHICH controls
// dominate a stage — the ~500 rebuilds are near-constant across switches, so
// they're fixed shell chrome; attribution names it exactly.
const mkBucket = () => ({ ms: 0, n: 0, by: new Map() })
const _stages = {
    applyContent: mkBucket(),   // ContentControl swap (construct + slot), excl. layout
    construct:    mkBucket(),   // DataTemplate.Apply — keyed by DataType
    materialize:  mkBucket(),   // ItemsControl.rebuildContainers — keyed by control class
    measure:      mkBucket(),   // Diagram-rooted Measure subtree
    arrange:      mkBucket(),   // Diagram-rooted Arrange subtree
    route:        mkBucket(),   // Connector.RecomputeRoute
}
let _stagesPatched = false
// `keyer(self, args)` → a label for the per-class tally, or undefined to skip.
function wrapStage(proto, name, bucket, keyer) {
    if (proto === undefined) { console.warn(`[tabperf] no proto for ${name}`); return }
    const orig = proto[name]
    if (typeof orig !== 'function') { console.warn(`[tabperf] cannot patch ${name} (not a function)`); return }
    proto[name] = function (...a) {
        const t = performance.now()
        try { return orig.apply(this, a) }
        finally {
            bucket.ms += performance.now() - t
            bucket.n++
            if (keyer !== undefined) {
                const k = keyer(this, a) ?? '?'
                bucket.by.set(k, (bucket.by.get(k) ?? 0) + 1)
            }
        }
    }
}
const className = (o) => (o && o.constructor && o.constructor.name) || '?'
function patchStageProfilers() {
    if (_stagesPatched) return
    _stagesPatched = true
    // applyContent/rebuildContainers are TS-`private` (soft) — real named
    // methods on the prototype in the built dist, so patchable by name.
    wrapStage(ContentControl.prototype, 'applyContent',      _stages.applyContent, (self) => className(self))
    // DataTemplate.Apply keyed by the template's DataType (what it builds).
    wrapStage(DataTemplate.prototype,   'Apply',             _stages.construct,    (self) => (self.DataType && self.DataType.name) || 'anon')
    wrapStage(ItemsControl.prototype,   'rebuildContainers', _stages.materialize,  (self) => className(self))
    wrapStage(Connector.prototype,      'RecomputeRoute',    _stages.route,        undefined)
    // Measure/Arrange are inherited; assigning on Diagram.prototype shadows
    // ONLY for Diagram instances (children keep the base method), so each
    // bucket = whole-subtree layout time rooted at a Diagram.
    wrapStage(Diagram.prototype,        'Measure',           _stages.measure,      undefined)
    wrapStage(Diagram.prototype,        'Arrange',           _stages.arrange,      undefined)
}
function snapshotStages() {
    const s = {}
    for (const k of Object.keys(_stages)) s[k] = { ms: _stages[k].ms, n: _stages[k].n, by: new Map(_stages[k].by) }
    return s
}
// Top-N per-class deltas for a stage, as "Class×count", most-frequent first.
function topBy(k, before, limit = 6) {
    const prev = before[k].by
    const deltas = []
    for (const [cls, n] of _stages[k].by) {
        const d = n - (prev.get(cls) ?? 0)
        if (d > 0) deltas.push([cls, d])
    }
    deltas.sort((a, b) => b[1] - a[1])
    return deltas.slice(0, limit).map(([cls, n]) => `${cls}×${n}`).join(' ')
}
function stageBreakdown(before) {
    const fmt = (k) => `${(_stages[k].ms - before[k].ms).toFixed(0)}ms×${_stages[k].n - before[k].n}`
    return `applyContent=${fmt('applyContent')} construct=${fmt('construct')} `
        + `materialize=${fmt('materialize')} measure=${fmt('measure')} `
        + `arrange=${fmt('arrange')} route=${fmt('route')}`
        + `\n[tabperf]   materialize by: ${topBy('materialize', before)}`
        + `\n[tabperf]   construct   by: ${topBy('construct', before)}`
        + `\n[tabperf]   applyContent by: ${topBy('applyContent', before)}`
}

export function attachTabSwitchDiagnostics(app, target) {
    patchDiagramRegistry()
    patchStageProfilers()
    const host = app.Services.get(ContentHostService.Key)
    if (host === undefined) { console.warn('[tabdiag] no ContentHostService'); return }

    // Count live Diagrams bound to a given Nodes collection. > 1 == leak.
    const subscribersOf = (doc) => {
        if (doc === undefined || doc === null) return -1
        let n = 0
        for (const d of _liveDiagrams) if (d.ItemsSource === doc.Nodes) n++
        return n
    }
    window.__tabsub = () => {
        const active = host.ActiveDocument
        console.log(
            `[tabsub] live Diagram instances=${_liveDiagrams.size} | `
            + `bound to active(${docLabel(active)})=${subscribersOf(active)}`,
        )
    }

    const report = (phase) => {
        const active = host.ActiveDocument
        // Defer one microtask so the ContentPresenter has rebuilt the slot.
        Promise.resolve().then(() => {
            const diagrams = []
            collectDiagrams(target.Content, diagrams)
            const summary = diagrams.map((d) => {
                const src = d.ItemsSource
                const count = src !== undefined && src.Count !== undefined ? src.Count : (Array.isArray(src) ? src.length : '?')
                const matchesActive = active !== undefined && active !== null && src === active.Nodes
                return `nodes=${count}${matchesActive ? ' <=ACTIVE' : ''}`
            })
            console.log(
                `[tabdiag] ${phase} | active=${docLabel(active)} | `
                + `activeView=${active && active.ActiveView ? 'set' : 'none'} | `
                + `inTreeDiagrams=${diagrams.length} [${summary.join(', ')}] | `
                + `LIVE Diagram instances=${_liveDiagrams.size}, bound to active=${subscribersOf(active)}`,
            )
        })
    }

    host.AddPropertyChangedListener(
        DocumentsContentHostService.ActiveDocumentKey,
        () => report('active-changed'),
    )
    // TEMP: catch WHO writes ActiveDocument=undefined mid-switch. The listener
    // fires synchronously inside set_property_value, so the trace's caller chain
    // is the writer. Only traces the transient (docs still open) — not a genuine
    // close-to-empty. Remove once the transient <none> is root-caused.
    host.AddPropertyChangedListener(
        DocumentsContentHostService.ActiveDocumentKey,
        () => {
            if (host.ActiveDocument === undefined && host.OpenDocuments.Count > 0) {
                console.warn('[tabdiag] ActiveDocument→undefined while', host.OpenDocuments.Count, 'open — writer trace:')
                console.trace('[tabdiag] transient <none> writer')
            }
        },
    )
    // Also expose a manual probe so you can click a tab then run
    // window.__tabdiag() in the devtools console to snapshot the tree.
    window.__tabdiag = () => report('manual')

    // ── PROFILING ──────────────────────────────────────────────────────
    // longtask observer: any main-thread task >50ms is reported with its
    // duration. A tab switch that blocks synchronously (a full canvas rebuild
    // — figure realization + connector routing + layout) shows up here as one
    // big task. If the ~1s delay produces NO longtask, the cost is spread
    // across frames (async / layout) instead of one JS hot path.
    try {
        const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                console.log(`[tabperf] longtask ${e.duration.toFixed(0)}ms`)
            }
        })
        obs.observe({ entryTypes: ['longtask'] })
    } catch (e) {
        console.warn('[tabperf] longtask observer unavailable:', e)
    }

    // click→paint timer: measures from a pointer release to the settled paint
    // frame, but only reports when the active document actually changed (a real
    // tab switch). Localises total user-perceived latency vs. the longtask JS.
    window.addEventListener('pointerup', () => {
        const t0 = performance.now()
        const before = host.ActiveDocument
        const stagesBefore = snapshotStages()
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const after = host.ActiveDocument
            if (after === before) return
            console.log(`[tabperf] click→paint ${(performance.now() - t0).toFixed(0)}ms | active=${docLabel(after)}`)
            console.log(`[tabperf] breakdown | ${stageBreakdown(stagesBefore)}`)
        }))
    }, true)

    console.log('[tabdiag] attached — switch tabs and watch for [tabdiag]/[tabperf] lines')
}

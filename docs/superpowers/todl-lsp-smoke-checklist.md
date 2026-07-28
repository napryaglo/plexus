# TODL Language Server — Manual Smoke Checklist

The irreducibly visual gate for Spec 3 (Plexus client). Everything below is
headless-tested where possible; this checklist covers what only real Monaco +
Electron can prove. Run with `npm run dev`.

**Prerequisite:** `@pragmatic-lab/todl` must expose the `language-server` subpath
(TODL 0.3.0 published to Verdaccio, or `npm link` to a local TODL checkout with
`dist` built). `npm run build:todl-server` must have produced
`out/main/todl-language-server.cjs`.

## Startup / plumbing
- [ ] App launches with no console errors about `todlLsp`, the language client, or a failed server fork.
- [ ] Main process spawns the server child (Task Manager shows an extra Electron/Node process after launch).

## Diagnostics (server-owned)
- [ ] Open a TODL project (meta-model / library / architecture). The Problems panel populates from the server (not the retired in-renderer validator).
- [ ] Introduce an error (e.g. a missing required field on an instance) → a red squiggle appears within ~1s and a Problems entry shows.
- [ ] Fix it → the squiggle and Problems entry clear.
- [ ] A file with an unresolved base binding still shows the "Unresolved base: …" project-level problem.
- [ ] Edit a `.todl` file that is NOT the active tab (via a second open project) → its diagnostics still update (whole-project analysis).

## Navigation & hover
- [ ] Hover a concept / instance → a hover popup with kind + signature + description.
- [ ] Ctrl-click a reference (e.g. an `extends`, a `&ref`, a relationship target) → jumps to the definition, including cross-file.
- [ ] Find All References on a symbol → lists every occurrence across files.

## Completion (schema-aware)
- [ ] Ctrl-Space in a type slot → concept/primitive/enum names.
- [ ] Type `&` in an assignment whose field targets a concept → only instances/terms valid for that concept (the schema-aware case).
- [ ] Completion inside an instance body → the concept's field/relationship names.

## Rename & quick-fix (WorkspaceEdit write-path)
- [ ] Rename a concept referenced across multiple files, some open and some closed → all occurrences update; open buffers become dirty (undo works), closed files are written to disk.
- [ ] Invalid rename (non-kebab / collision) → rejected with a message.
- [ ] Quick-fix lightbulb on a "missing required field" diagnostic → applies the `<field> = ;` insertion.

## Formatting / folding / symbols / semantic tokens
- [ ] Format Document → normalizes indentation/spacing; comments survive; running it again is a no-op.
- [ ] Folding arrows appear on braces/blocks and collapse correctly.
- [ ] The Outline / breadcrumb shows the document's symbols.
- [ ] Semantic colouring distinguishes concepts / primitives / enums / instances (richer than the Monarch base).

## Resilience
- [ ] Kill the server child (Task Manager) → main restarts it and the renderer resyncs; diagnostics reappear and providers work again without an app reload.
- [ ] Create / delete / rename a `.todl` file in the Project Explorer → the server picks it up (diagnostics for the new/removed file appear/clear) via the rescan → ResyncProject path.

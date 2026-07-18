// project-node-icon.ts — maps a ProjectNode's Kind to its leading glyph.
//
// The project tree renders declaratively now (a HierarchicalDataTemplate over
// ProjectNode.Children — see project-explorer.resources.mu). The per-kind icon
// is the one data-driven bit a template can't express as a static resource, so
// it flows through this value converter: `Geometry = $Kind << KindToGeometry`.
import { Application, type ValueConverter } from '@pragmatic-lab/mural/runtime'

import type { ProjectNodeKind } from './project.js'

// The leading glyph resource key for a node kind (registered in plexus-icons.mu).
// 'folder' reuses the command-bar @Folder; each file kind has its own glyph; an
// unrecognised kind falls back to the generic file glyph.
export function iconKeyForKind(kind: ProjectNodeKind): string
{
    switch (kind) {
        case 'folder': return 'Folder'
        case 'diagram': return 'Diagram'
        case 'todl': return 'Todl'
        default: return 'File'
    }
}

// Resolves a node's Kind to its themed leading geometry. Geometries are
// theme-agnostic (registered once in PlexusIcons), so a one-shot resolve is
// stable across scheme switches — the Shape's Fill carries the reactive theme
// brush. Returns undefined only if the resource dictionary isn't mounted yet,
// in which case the Shape paints nothing (same as an unresolved glyph).
export const KindToGeometry: ValueConverter = {
    convert: (kind: unknown) =>
        Application.current?.Resources.Resolve(iconKeyForKind(kind as ProjectNodeKind)),
}

// project-node-icon.ts — the project explorer's small glyph converters.
//
// The project tree renders declaratively (a HierarchicalDataTemplate over
// ProjectNode.Children — see project-explorer.resources.mu). Two bits are
// data-driven glyphs a template can't express as a static resource, so each
// flows through a value converter: the per-kind node icon (`$Kind <<
// KindToGeometry`) and the project header's expand/collapse chevron
// (`$IsExpanded << ExpandedToChevron`).
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

// Maps a project header's IsExpanded flag to its twisty glyph — down when
// expanded, right when collapsed — using the theme's shared Chevron* geometries
// (the same ones the TreeView rows paint).
export const ExpandedToChevron: ValueConverter = {
    convert: (expanded: unknown) =>
        Application.current?.Resources.Resolve(expanded ? 'ChevronDown' : 'ChevronRight'),
}

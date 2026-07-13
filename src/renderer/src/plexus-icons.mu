// plexus-icons.mu — the shared icon dictionary for Plexus.
//
// A standalone `resources` dictionary of vector icons: each `include` splices
// an SVG (under ./icons) into a keyed Geometry resource at compile time (via
// the CLI's SVG→geometry resolver). One geometry per capability shown in the
// shell's activity bar.
//
// Merged into the app's Resources by app.mu's `resources: { merge PlexusIcons }`
// directive, so every module's capabilities resolve `Icon = @<Key>` (a
// DynamicResource) against Application.Resources at render time. Painted by a
// Shape/Path with a theme brush — no colour is baked into the geometry.

resources PlexusIcons {
    include "icons/tool-box.svg"                 as ToolBox
    include "icons/layers.svg"                   as Layers
    include "icons/outline.svg"                  as Outline
    include "icons/architecture-repository.svg"  as ArchitectureRepository
    include "icons/technology-library.svg"       as TechnologyLibrary
    include "icons/project-explorer.svg"         as ProjectExplorer
    include "icons/architecture-meta-models.svg" as ArchitectureMetaModels

    // Activity-bar footer action (VSCode-style settings gear).
    include "icons/settings.svg"                 as Settings
}

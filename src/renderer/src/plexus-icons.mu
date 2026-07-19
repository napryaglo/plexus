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
    include "icons/ontologies.svg"               as Ontologies

    // Activity-bar footer action (VSCode-style settings gear).
    include "icons/settings.svg"                 as Settings

    // Send affordance for the agent-chat input (up-arrow, Material arrow_upward).
    include "icons/arrow-upward.svg"             as ArrowUpward

    // Project Explorer command-bar glyphs (Open / New / New File / Save / Publish).
    include "icons/folder.svg"                   as Folder
    include "icons/new-folder.svg"               as NewFolder
    include "icons/note-add.svg"                 as NoteAdd
    include "icons/upload-file.svg"              as UploadFile
    include "icons/save.svg"                      as Save
    include "icons/publish.svg"                  as Publish

    // Project-tree leading glyphs, one per ProjectNodeKind (folder reuses
    // @Folder above). Painted as a Shape/Fill by the tree row's leading slot.
    include "icons/diagram.svg"                  as Diagram
    include "icons/todl.svg"                     as Todl
    include "icons/file.svg"                     as File
}

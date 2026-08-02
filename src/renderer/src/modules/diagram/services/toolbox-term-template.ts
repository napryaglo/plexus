// toolbox-term-template.ts — resolve a term tile's drag-preview visual.
//
// Order: the library class template when the LibraryRegistry knows the term
// (published library class), else a plain text tile bearing the term's label.
// The meta-model presentation `mm:<id>` hook is applied by ToolboxService, which
// holds the source dictionary; this helper covers the library + text tiers.
import { DataTemplate, TextBlock } from '@pragmatic-lab/mural/basic'

import { LibraryRegistry } from '../../library/services/library-registry.js'

export function resolveTermTemplate(
    registry: LibraryRegistry | undefined,
    termId: string,
    concept: string,
    label: string,
): DataTemplate
{
    if (registry !== undefined) return registry.resolve(termId, concept)
    return new DataTemplate(() => {
        const tb = new TextBlock()
        tb.Text = label
        return tb
    })
}

// meta-model-converters.ts — value converters for the Meta-models panel markup.
import { Visibility, type ValueConverter } from '@pragmatic-lab/mural/runtime'

// Show a fallback (Visible) when the bound value is null/undefined; hide it
// (Collapsed) when present. Drives the drawer's "presentation unavailable" note,
// which appears only while the entity's Presentation is unset.
export const IsNullToVisibility: ValueConverter = {
    convert: (v: unknown) => (v == null ? Visibility.Visible : Visibility.Collapsed),
}

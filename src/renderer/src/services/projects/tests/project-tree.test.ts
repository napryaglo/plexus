import { test, expect } from 'vitest'

import { iconKeyForKind } from '../project-tree.js'

// The leading glyph key each ProjectNodeKind maps to (resource keys registered
// in plexus-icons.mu). 'folder' reuses the command-bar @Folder; the file kinds
// each get their own glyph; anything unknown falls back to the generic file.
test('maps each node kind to its icon resource key', () => {
    expect(iconKeyForKind('folder')).toBe('Folder')
    expect(iconKeyForKind('diagram')).toBe('Diagram')
    expect(iconKeyForKind('todl')).toBe('Todl')
    expect(iconKeyForKind('file')).toBe('File')
})

test('falls back to the generic file glyph for an unrecognised kind', () => {
    expect(iconKeyForKind('mystery' as never)).toBe('File')
})

import { test, expect } from 'vitest'

import { compareStorageEntries, type StorageEntry } from '../storage.js'

function entry(Name: string, IsDirectory: boolean): StorageEntry
{
    return { Name, IsDirectory }
}

// Sorting a shuffled listing yields folders first (alphabetical), then files
// (alphabetical) — the explorer-tree ordering both project factories present.
test('folders sort before files, each group alphabetical', () => {
    const listing = [
        entry('readme.md', false),
        entry('src', true),
        entry('Banana.txt', false),
        entry('assets', true),
        entry('apple.txt', false),
    ]
    const sorted = [...listing].sort(compareStorageEntries)
    expect(sorted.map((e) => e.Name)).toEqual([
        'assets', 'src', 'apple.txt', 'Banana.txt', 'readme.md',
    ])
})

// The alphabetical order is case-insensitive so 'Banana' doesn't sort ahead of
// 'apple' the way a raw code-point compare would.
test('names compare case-insensitively', () => {
    const sorted = [entry('Zebra', false), entry('apple', false)].sort(compareStorageEntries)
    expect(sorted.map((e) => e.Name)).toEqual(['apple', 'Zebra'])
})

// Names equal ignoring case fall back to a case-sensitive compare so the order
// is stable rather than dependent on input order.
test('case-only differences break ties deterministically', () => {
    const sorted = [entry('File', false), entry('file', false)].sort(compareStorageEntries)
    const reversed = [entry('file', false), entry('File', false)].sort(compareStorageEntries)
    expect(sorted.map((e) => e.Name)).toEqual(reversed.map((e) => e.Name))
})

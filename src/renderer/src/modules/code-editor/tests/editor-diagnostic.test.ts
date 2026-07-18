import { test, expect } from 'vitest'

import { EditorSeverity, toMarkers, type EditorDiagnostic } from '../editor-diagnostic.js'

test('toMarkers maps each severity to its Monaco value', () => {
    const diag = (severity: EditorSeverity): EditorDiagnostic => ({
        severity, message: 'x', startLine: 1, startColumn: 1, endLine: 1, endColumn: 2,
    })
    const [error, warning, info, hint] = toMarkers([
        diag(EditorSeverity.Error), diag(EditorSeverity.Warning),
        diag(EditorSeverity.Info), diag(EditorSeverity.Hint),
    ])
    expect(error?.severity).toBe(8)
    expect(warning?.severity).toBe(4)
    expect(info?.severity).toBe(2)
    expect(hint?.severity).toBe(1)
})

test('toMarkers copies the 1-based range and message verbatim', () => {
    const [m] = toMarkers([{
        severity: EditorSeverity.Error, message: 'boom',
        startLine: 3, startColumn: 5, endLine: 3, endColumn: 9,
    }])
    expect(m).toMatchObject({
        message: 'boom', startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 9,
    })
})

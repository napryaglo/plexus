import { describe, test, expect } from 'vitest'
import { resolveOwningProject, summarizeProject, type OpenProjectRef } from '../refresh-targets.js'
import { DiagnosticSeverity, type Diagnostic } from '../../diagnostics/diagnostic.js'

const OPEN: OpenProjectRef[] = [
    { folder: 'C:\\Users\\me\\projA', name: 'A' },
    { folder: 'C:\\Users\\me\\projB', name: 'B' },
]

function diag(projectId: string, severity: DiagnosticSeverity, message: string): Diagnostic
{
    return { owner: 'todl', projectId, projectName: 'x', uri: 'f.todl', message, severity, span: null }
}

describe('resolveOwningProject', () => {
    test('matches a file inside a project (Windows sep + case insensitive)', () => {
        const owner = resolveOwningProject(OPEN, 'c:/users/me/projA/models/x.todl')
        expect(owner?.name).toBe('A')
    })
    test('matches the project folder itself', () => {
        expect(resolveOwningProject(OPEN, 'C:\\Users\\me\\projB')?.name).toBe('B')
    })
    test('does not match a sibling whose name is a string-prefix but not a path-prefix', () => {
        expect(resolveOwningProject([{ folder: '/p/proj', name: 'P' }], '/p/project-x/f.todl')).toBeUndefined()
    })
    test('returns undefined when nothing contains the path', () => {
        expect(resolveOwningProject(OPEN, 'D:/other/x.todl')).toBeUndefined()
    })
})

describe('summarizeProject', () => {
    test('counts by severity and caps sample messages at 5', () => {
        const diags = [
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, 'e1'),
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Warning, 'w1'),
            ...Array.from({ length: 6 }, (_v, i) => diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, `x${i}`)),
            diag('C:\\Users\\me\\projB', DiagnosticSeverity.Error, 'other'),
        ]
        const s = summarizeProject(OPEN[0]!, diags)
        expect(s.folder).toBe('C:\\Users\\me\\projA')
        expect(s.errorCount).toBe(7)
        expect(s.warningCount).toBe(1)
        expect(s.sampleMessages.length).toBe(5)
        expect(s.sampleMessages).not.toContain('other')
    })
})

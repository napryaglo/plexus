import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagramExportService } from '../diagram-export-service.js'

// A minimal fake content host exposing just ActiveDocument.
function providerWith(activeDoc: unknown) {
  const provider = new ServiceProvider()
  provider.registerInstance(ContentHostService.Key, { ActiveDocument: activeDoc } as never)
  return provider
}

test('canExportActive is false when no document is active', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(svc.canExportActive()).toBe(false)
})

test('canExportActive is false for a non-diagram document', () => {
  const svc = new DiagramExportService(providerWith({ notADiagram: true }))
  expect(svc.canExportActive()).toBe(false)
})

test('ExportSvgCommand / ExportPptxCommand are ICommands', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(typeof svc.ExportSvgCommand.Execute).toBe('function')
  expect(typeof svc.ExportPptxCommand.CanExecute).toBe('function')
  expect(svc.ExportSvgCommand.CanExecute()).toBe(false) // no active diagram
})

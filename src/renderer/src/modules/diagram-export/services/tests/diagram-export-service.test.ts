import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagramExportService, ExportFormat } from '../diagram-export-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'

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

test('exportRendered (SVG) saves the given svg via SaveFileAs with a <baseName>.svg default path', async () => {
  // The pre-rendered path shared by the active-doc commands and the explorer's
  // headless export: no active document needed — it saves the svg it's handed.
  const calls: Array<{ content: string; DefaultPath: string }> = []
  const provider = providerWith(undefined)
  provider.registerInstance(FileSystemService.Key, {
    SaveFileAs: (content: string, opts: { DefaultPath: string }) => {
      calls.push({ content, DefaultPath: opts.DefaultPath })
      return Promise.resolve(opts.DefaultPath)
    },
    WriteBytes: () => Promise.resolve(),
  } as never)

  const svc = new DiagramExportService(provider)
  await svc.exportRendered(ExportFormat.Svg, { svg: '<svg>x</svg>', width: 40, height: 30 }, 'my-flow')

  expect(calls).toHaveLength(1)
  expect(calls[0]!.content).toBe('<svg>x</svg>')
  expect(calls[0]!.DefaultPath).toBe('my-flow.svg')
})

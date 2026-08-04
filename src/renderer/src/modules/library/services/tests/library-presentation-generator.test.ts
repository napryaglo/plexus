import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { generateLibraryPresentationMu } from '../library-presentation-generator.js'

// Two Instance-tier classes (attrs.class === true): one with an icon, one without.
const DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } },
        { id: 'microsoft.aws', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'aws', label: 'AWS' } },
    ],
    edges: [],
} as unknown as TodlDocument

test('emits a resources block with one include per icon and a class-keyed template per class', () => {
    const mu = generateLibraryPresentationMu(DOC, [])
    expect(mu).toContain('resources LibraryPresentation {')
    // one include for the single distinct icon, keyed by iconKey('resources/azure.svg')
    expect(mu).toContain('include "resources/azure.svg" as mm_icon_azure')
    // class-keyed templates (string key = class id) declaring the inert DataType
    // the mural compiler requires
    expect(mu).toContain('DataTemplate x:key="microsoft.azure" [ DataType = LibraryClassData ]')
    expect(mu).toContain('DataTemplate x:key="microsoft.aws" [ DataType = LibraryClassData ]')
})

test('the iconful class emits a Shape geometry + $Display label; the icon-less class is label-only', () => {
    const mu = generateLibraryPresentationMu(DOC, [])
    // iconful branch
    expect(mu).toContain('Shape [ Geometry = @mm_icon_azure')
    expect(mu).toContain('Text = $Display')
    // icon-less branch: no Shape inside the aws template
    const awsAt = mu.indexOf('x:key="microsoft.aws"')
    const awsTemplate = mu.slice(awsAt, mu.indexOf('    }\n', awsAt))
    expect(awsTemplate).not.toContain('Shape [')
    expect(awsTemplate).toContain('Text = $Display')
})

test('author override dictionaries are merged last; none → no merge line', () => {
    expect(generateLibraryPresentationMu(DOC, ['LibraryPresentationCustom']))
        .toContain('merge LibraryPresentationCustom')
    expect(generateLibraryPresentationMu(DOC, [])).not.toContain('merge ')
})

// A class whose icon is a raster image (PNG): the template fills a Border with the
// icon resource (an ImageBrush) instead of drawing an SVG geometry into a Shape.
const RASTER_DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.aml', tier: 'Instance', typeOf: 'technology',
          attrs: { class: true, id: 'aml', label: 'Azure ML', icon: 'resources/azure-machine-learning.png' } },
    ],
    edges: [],
} as unknown as TodlDocument

test('a raster-icon class fills a Border with the icon brush; no Shape/Geometry', () => {
    const mu = generateLibraryPresentationMu(RASTER_DOC, [])
    expect(mu).toContain('include "resources/azure-machine-learning.png" as mm_icon_azure_machine_learning')
    const t = mu.slice(mu.indexOf('x:key="microsoft.aml"'))
    expect(t).toContain('Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @mm_icon_azure_machine_learning ]')
    expect(t).not.toContain('Shape [')
    expect(t).not.toContain('Geometry =')
    expect(t).toContain('Text = $Display')
})

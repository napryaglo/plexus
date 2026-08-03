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

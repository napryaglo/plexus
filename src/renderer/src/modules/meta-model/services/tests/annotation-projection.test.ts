import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { projectAnnotations } from '../annotation-projection.js'

const doc: TodlDocument = {
  nodes: [
    { id: 'actor',          tier: 'Ontology', typeOf: 'concept',  attrs: { label: 'Human Actor' } },
    { id: 'actor@icon',     tier: 'Ontology', typeOf: 'icon',     attrs: { path: 'icons/actor.svg', namespace: 'acme' } },
    { id: 'actor@category', tier: 'Ontology', typeOf: 'category', attrs: { name: 'actors', order: 1, namespace: 'acme' } },
    { id: 'bare',           tier: 'Ontology', typeOf: 'concept',  attrs: {} },
    { id: 'package',        tier: 'Ontology', typeOf: 'package',  attrs: {} },
    { id: 'package@author', tier: 'Ontology', typeOf: 'author',   attrs: { name: 'Acme Corp', namespace: 'acme' } },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actor',   to: 'actor@icon' },
    { kind: 'Annotated', via: null, from: 'actor',   to: 'actor@category' },
    { kind: 'Annotated', via: null, from: 'actor',   to: 'missing@ghost' }, // dangling → skipped
    { kind: 'Annotated', via: null, from: 'package', to: 'package@author' },
    { kind: 'HasField',  via: null, from: 'actor',   to: 'actor.name' },    // non-annotation edge ignored
  ],
} as unknown as TodlDocument

describe('projectAnnotations', () => {
  it('keys annotations by name and strips the namespace provenance attr', () => {
    expect(projectAnnotations(doc, 'actor')).toEqual({
      icon: { path: 'icons/actor.svg' },
      category: { name: 'actors', order: 1 },
    })
  })
  it('returns {} for a target with no annotations', () => {
    expect(projectAnnotations(doc, 'bare')).toEqual({})
  })
  it('projects the package node annotations the same way', () => {
    expect(projectAnnotations(doc, 'package')).toEqual({ author: { name: 'Acme Corp' } })
  })
})

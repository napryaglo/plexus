import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import {
    CONTAINMENT_MEMBER_DEFAULT,
    isContainmentRelationship,
    isContainerConcept,
    containmentParentOf,
} from '../containment.js'

// Triplet: location contains component contains technology, via the default `in`
// containment member. `region` is a leaf marked @container by override (it is the
// target of no containment relationship).
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location; }
  concept technology { relationship in -> component; }
  concept region { annotate container {} }
  viewpoint V : frames location, component, technology, region
}`
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms V { location loc {} component comp { in = loc; } }
}` }

function build(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('the default containment member is `in`', () => {
    expect(CONTAINMENT_MEMBER_DEFAULT).toBe('in')
})

test('isContainmentRelationship recognizes the `in` member by default', () => {
    const repo = build().repository()
    expect(isContainmentRelationship(repo, 'component', 'in')).toBe(true)
})

test('containment targets are container concepts by default', () => {
    const repo = build().repository()
    expect(isContainerConcept(repo, 'location')).toBe(true)   // target of component.in
    expect(isContainerConcept(repo, 'component')).toBe(true)  // target of technology.in
    expect(isContainerConcept(repo, 'technology')).toBe(false) // target of nothing
})

test('@container annotation overrides a non-target leaf into a container', () => {
    const repo = build().repository()
    expect(isContainerConcept(repo, 'region')).toBe(true)
})

test('containmentParentOf returns the container the entity`s `in` ref points at', () => {
    const m = build()
    const comp = m.entities().find((e) => e.id === 'comp')!
    const parent = containmentParentOf(m.repository(), comp)
    expect(parent?.id).toBe('loc')
})

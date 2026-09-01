import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { resolveDropActions, DropActionKind } from '../arch-drop-resolver.js'

const MM = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept category {}
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  concept other { relationship uses -> technology; }
  viewpoint V : frames component, other
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Cats : represents category { term ai {} }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }
const scope = new Set(['V'])

test('dropping a technology yields exactly one action — the root component member', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'implementedBy', term: 'Stack.azure' })
})

test('the non-root concept `other` that also accepts technology is NOT scanned (no ambiguity, no chooser)', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions.map((a) => a.concept)).not.toContain('other')
})

test('dropping a category yields the root component category member', () => {
    const actions = resolveDropActions(repo(), 'Cats.ai', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'categorisedAs' })
})

test('a term accepted by no root yields no actions (reject)', () => {
    const NOROOT = `namespace m {
      annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
      concept a {} concept b { annotate materialize {} relationship r -> a; }
      concept c {}
      viewpoint V : frames b
      taxonomy T : represents c { term t {} }
    }`
    const r = load([{ uri: 'm.todl', text: NOROOT }]).model
    expect(resolveDropActions(r, 'T.t', new Set(['V']))).toEqual([])
})

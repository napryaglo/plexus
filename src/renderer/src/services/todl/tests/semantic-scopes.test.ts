import { describe, it, expect } from 'vitest'
import {
  TodlSemanticScope, editorSemanticLegend, todlSemanticThemeRules,
  TODL_KEYWORD_BLUE_DARK, TODL_KEYWORD_BLUE_LIGHT,
} from '../semantic-scopes.js'

const SERVER = { tokenTypes: ['type', 'class', 'enumMember', 'property', 'method', 'variable'], tokenModifiers: [] }

describe('editorSemanticLegend', () => {
  it('renames the concept-bearing types to TODL scopes, order preserved', () => {
    const legend = editorSemanticLegend(SERVER)
    expect(legend.tokenTypes).toEqual([
      TodlSemanticScope.Type, TodlSemanticScope.Class, 'enumMember', 'property', 'method', 'variable',
    ])
  })
  it('leaves modifiers and non-concept types untouched', () => {
    const legend = editorSemanticLegend({ tokenTypes: ['property', 'variable'], tokenModifiers: ['declaration'] })
    expect(legend.tokenTypes).toEqual(['property', 'variable'])
    expect(legend.tokenModifiers).toEqual(['declaration'])
  })
  it('is a pure copy (does not mutate the server legend)', () => {
    const server = { tokenTypes: ['type'], tokenModifiers: [] }
    editorSemanticLegend(server)
    expect(server.tokenTypes).toEqual(['type'])
  })
})

describe('todlSemanticThemeRules', () => {
  it('colors both TODL scopes the dark keyword blue', () => {
    const rules = todlSemanticThemeRules(true)
    expect(rules).toContainEqual({ token: TodlSemanticScope.Type, foreground: TODL_KEYWORD_BLUE_DARK })
    expect(rules).toContainEqual({ token: TodlSemanticScope.Class, foreground: TODL_KEYWORD_BLUE_DARK })
  })
  it('uses the light keyword blue on a light base', () => {
    const rules = todlSemanticThemeRules(false)
    expect(rules.every((r) => r.foreground === TODL_KEYWORD_BLUE_LIGHT)).toBe(true)
  })
})

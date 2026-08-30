import { test, expect } from 'vitest'
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../../../../../shared/agent-api.js'
import { AgentSkillChoice, buildAgentSkillChoices } from '../agent-skill-choice.js'

const CATALOG: ProjectCatalog = {
    agents: [{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }],
    skills: [{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'd' }],
}

test('builds one choice per item, agents first, labelled by kind', () => {
    const chosen: CatalogItem[] = []
    const choices = buildAgentSkillChoices(CATALOG, (item) => chosen.push(item))
    expect(choices.map((c) => c.Label)).toEqual(['agent: reviewer', 'skill: security-review'])
    choices[1].Command.Execute(undefined)
    expect(chosen).toEqual([{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'd' }])
})

test('an empty catalog yields no choices', () => {
    expect(buildAgentSkillChoices({ agents: [], skills: [] }, () => {})).toEqual([])
})

test('AgentSkillChoice exposes Label + Command', () => {
    const c = new AgentSkillChoice('agent: x', () => {})
    expect(c.Label).toBe('agent: x')
    expect(typeof c.Command.Execute).toBe('function')
})

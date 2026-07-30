import { test, expect } from 'vitest'

import { iconKey, humanize } from '../presentation-generator.js'

test('iconKey slugs an icon path to a stable identifier', () => {
    expect(iconKey('resources/actor-internal.svg')).toBe('mm_icon_actor_internal')
    expect(iconKey('resources/sub/role.service.svg')).toBe('mm_icon_role_service')
    expect(iconKey('a.svg')).toBe('mm_icon_a')
})

test('humanize title-cases an id split on - and .', () => {
    expect(humanize('app-component')).toBe('App Component')
    expect(humanize('actor')).toBe('Actor')
    expect(humanize('connector-type-style')).toBe('Connector Type Style')
})

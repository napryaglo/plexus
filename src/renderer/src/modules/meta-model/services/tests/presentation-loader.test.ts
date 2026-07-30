import { describe, it, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import type { IStorage, StorageEntry } from '../../../../services/storage/storage.js'
import { loadPresentation } from '../presentation-loader.js'

const GENERATED = [
  'resources MetaModelPresentation {',
  '    include "resources/foo.svg" as mm_icon_foo',
  '    DataTemplate x:key="mm:application" [ DataType = MetaModelEntity ] {',
  '        StackPanel [ Orientation = Horizontal ] {',
  '            Shape [ Geometry = @mm_icon_foo, Width = 16, Height = 16 ]',
  '            TextBlock [ Text = "Application" ]',
  '        }',
  '    }',
  '}',
].join('\n')

class FakeStorage implements IStorage {
  public readonly Root = 'fake://meta-models'
  private files: Record<string, string>
  constructor(files: Record<string, string>) { this.files = files }
  async ReadText(path: string): Promise<string> {
    const v = this.files[path]; if (v === undefined) throw new Error(`ENOENT ${path}`); return v
  }
  async ReadBytes(): Promise<Uint8Array> { throw new Error('unused') }
  async WriteText(): Promise<void> { throw new Error('unused') }
  async WriteBytes(): Promise<void> { throw new Error('unused') }
  async Exists(path: string): Promise<boolean> { return path in this.files }
  async Delete(): Promise<void> { throw new Error('unused') }
  async CreateDirectory(): Promise<void> { throw new Error('unused') }
  async Rename(): Promise<void> { throw new Error('unused') }
  async List(): Promise<readonly StorageEntry[]> { return [] }
}

describe('loadPresentation', () => {
  it('instantiates the generated dict and resolves an mm:<id> template with a real icon', async () => {
    const storage = new FakeStorage({
      'tech-architecture/0.1.0/presentation/presentation.generated.mu': GENERATED,
      'tech-architecture/0.1.0/presentation/resources/foo.svg':
        '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>',
    })
    const dict = await loadPresentation(storage, 'tech-architecture/0.1.0')
    expect(dict.CanResolve('mm:application')).toBe(true)
    expect(dict.Resolve('mm:application')).toBeInstanceOf(DataTemplate)
  })

  it('throws when the generated file is missing', async () => {
    const storage = new FakeStorage({})
    await expect(loadPresentation(storage, 'x/0.0.0')).rejects.toThrow()
  })
})

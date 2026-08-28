import { describe, it, expect, vi } from 'vitest'
import { Size } from '@pragmatic-lab/mural/runtime'
import { MediaKind } from '../media-kind'
import { MediaNodeVM } from '../media-node-vm'

describe('MediaNodeVM', () => {
    it('round-trips DPs', () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Hyperlink
        vm.Source = 'https://example.com'
        vm.Label = 'Example'
        vm.HyperlinkUri = 'https://example.com'
        expect(vm.MediaKind).toBe(MediaKind.Hyperlink)
        expect(vm.Label).toBe('Example')
    })

    it('LoadAsync sets a BitmapImage for an image source', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Image
        vm.Source = 'data:image/png;base64,AAAA'
        const measure = vi.fn(async () => new Size(64, 48))
        const natural = await vm.LoadAsync({ storage: {} as never, measure })
        expect(natural?.Width).toBe(64)
        expect(vm.Bitmap).toBeDefined()
    })

    it('LoadAsync is a no-op for non-image kinds', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.FileLink
        vm.Source = 'C:/x/y.pdf'
        const natural = await vm.LoadAsync({ storage: {} as never })
        expect(natural).toBeUndefined()
        expect(vm.Bitmap).toBeUndefined()
    })
})

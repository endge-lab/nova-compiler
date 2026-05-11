import { describe, expect, it } from 'vitest'
import { compileNovaCss } from '@/css/NovaCssCompiler'
import { compileNovaSfc } from '@/sfc/NovaSfcCompiler'

describe('Nova compiler performance', () => {
  it('compiles 1000 novacss rules under budget', () => {
    const source = Array.from({ length: 1_000 }, (_item, index) => (
      `TextBlock.item-${index} { color: var(--nova-scene-text, #123456); fontSize: ${12 + (index % 8)}; }`
    )).join('\n')

    const start = performance.now()
    const result = compileNovaCss(source)
    const elapsed = performance.now() - start

    expect(result.ok).toBe(true)
    expect(result.styleSheet?.rules).toHaveLength(1_000)
    expect(elapsed).toBeLessThan(150)
  })

  it('compiles a large dynamic nova template under budget', () => {
    const rows = Array.from({ length: 200 }, (_item, index) => (
      index % 2 === 0
        ? `<Inspector :documentId="props.items[${index}]?.id" />`
        : `<TextBlock id="item-${index}" :text="props.items[${index}]?.title" />`
    )).join('\n')

    const start = performance.now()
    const result = compileNovaSfc(`
      <script setup>
      import { InspectorNode as Inspector } from './InspectorNode'
      const props = defineProps()
      </script>
      <template>
        <Root id="root">
          <Grid id="grid">
            ${rows}
          </Grid>
        </Root>
      </template>
    `)
    const elapsed = performance.now() - start

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code.length).toBeGreaterThan(5_000)
    expect(elapsed).toBeLessThan(150)
  })
})

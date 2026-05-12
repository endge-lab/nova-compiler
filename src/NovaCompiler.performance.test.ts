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

    const source = `
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
    `
    const { result, elapsed } = measureCompileNovaSfc(source)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code.length).toBeGreaterThan(5_000)
    expect(elapsed).toBeLessThan(150)
    console.info(`[bench] compiler:nova-large-dynamic elapsed=${elapsed.toFixed(2)}ms budget=150ms`)
  })

  it('compiles a large nova template with scoped slots under budget', () => {
    const rows = Array.from({ length: 200 }, (_item, index) => (
      `<TextBlock id="item-${index}" :text="props.items[${index}]?.title" />`
    )).join('\n')
    const slotBlocks = Array.from({ length: 20 }, (_item, index) => `
      <ScrollArea id="scroll-${index}" :contentHeight="480">
        <Flex>
          <TextBlock :text="props.items[${index}]?.title" />
        </Flex>
        <template #thumb="{ orientation, state, thumbRect }">
          <Surface
            :key="orientation"
            :x="thumbRect.x"
            :y="thumbRect.y"
            :width="thumbRect.width"
            :height="thumbRect.height"
            :opacity="state.opacity"
          />
        </template>
      </ScrollArea>
    `).join('\n')

    const source = `
      <script setup>
      const props = defineProps()
      </script>
      <template>
        <Root id="root">
          <Grid id="grid">
            ${rows}
          </Grid>
          ${slotBlocks}
        </Root>
      </template>
    `
    const { result, elapsed } = measureCompileNovaSfc(source)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('slots:{thumb:')
    expect(elapsed).toBeLessThan(180)
    console.info(`[bench] compiler:nova-slots elapsed=${elapsed.toFixed(2)}ms budget=180ms`)
  })
})

function measureCompileNovaSfc(source: string): { result: ReturnType<typeof compileNovaSfc>; elapsed: number } {
  let best: { result: ReturnType<typeof compileNovaSfc>; elapsed: number } | null = null

  for (let index = 0; index < 3; index += 1) {
    const start = performance.now()
    const result = compileNovaSfc(source)
    const elapsed = performance.now() - start
    if (!best || elapsed < best.elapsed) best = { result, elapsed }
  }

  return best!
}

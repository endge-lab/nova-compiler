import { describe, expect, it } from 'vitest'
import { compileNovaCss } from '@/css/nova-css-compiler'
import { compileNovaSfc } from '@/sfc/nova-sfc-compiler'

describe('Nova compiler performance', () => {
  it('compiles 1000 novacss rules under budget', () => {
    const source = Array.from({ length: 1_000 }, (_item, index) => (
      `TextBlock.item-${index} { color: var(--nova-scene-text, #123456); fontSize: ${12 + (index % 8)}; }`
    )).join('\n')

    const { result, elapsed } = measureCompileNovaCss(source)

    expect(result.ok).toBe(true)
    expect(result.styleSheet?.rules).toHaveLength(1_000)
    expect(elapsed).toBeLessThan(150)
    console.info(`[bench] compiler:novacss-1000 elapsed=${elapsed.toFixed(2)}ms budget=150ms`)
  })

  it('compiles 1000 novacss rules with 100 media conditions under budget', () => {
    const rules = Array.from({ length: 1_000 }, (_item, index) => (
      `.item-${index} { color: #123456; fontSize: ${12 + (index % 8)}; }`
    )).join('\n')
    const mediaRules = Array.from({ length: 100 }, (_item, index) => (
      `@media (min-width: ${600 + index * 4}px) { .item-${index} { display: ${index % 2 === 0 ? 'none' : 'normal'}; } }`
    )).join('\n')

    const { result, elapsed } = measureCompileNovaCss(`${rules}\n${mediaRules}`)

    expect(result.ok).toBe(true)
    expect(result.styleSheet?.rules).toHaveLength(1_100)
    expect(elapsed).toBeLessThan(180)
    console.info(`[bench] compiler:novacss-media elapsed=${elapsed.toFixed(2)}ms budget=180ms`)
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

  it('compiles public if/for control-flow under budget', () => {
    const rows = Array.from({ length: 80 }, (_item, index) => `
      <Surface for="cell in props.rows[${index}]?.cells ?? []" :key="cell.id" :x="cell.x" :y="cell.y">
        <TextBlock if="cell.visible" :text="cell.label" />
        <TextBlock else-if="cell.loading" text="Loading" />
        <TextBlock else text="Empty" />
      </Surface>
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
        </Root>
      </template>
    `
    const { result, elapsed } = measureCompileNovaSfc(source)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('__novaFor')
    expect(result.code).toContain('cell.visible')
    expect(elapsed).toBeLessThan(160)
    console.info(`[bench] compiler:nova-control-flow elapsed=${elapsed.toFixed(2)}ms budget=160ms`)
  })
})

function measureCompileNovaCss(source: string): { result: ReturnType<typeof compileNovaCss>; elapsed: number } {
  let best: { result: ReturnType<typeof compileNovaCss>; elapsed: number } | null = null

  for (let index = 0; index < 3; index += 1) {
    const start = performance.now()
    const result = compileNovaCss(source)
    const elapsed = performance.now() - start
    if (!best || elapsed < best.elapsed) best = { result, elapsed }
  }

  return best!
}

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

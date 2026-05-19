import { bench, describe } from 'vitest'
import type { Plugin } from 'vite'
import { novaVitePlugin } from '@/vite/novaVitePlugin'

const rows = Array.from({ length: 500 }, (_item, index) => (
  `<TextBlock id="item-${index}" :text="props.items[${index}]?.title" />`
)).join('\n')

const source = `
  <script setup lang="ts">
  const props = { items: [] }
  </script>
  <template>
    <NovaCanvas>
      <Flex direction="column">
        ${rows}
      </Flex>
    </NovaCanvas>
  </template>
`

describe('NovaCanvas default-slot compiler benchmarks', () => {
  bench('large auto-root default DSL transform', async () => {
    const plugin = novaVitePlugin()
    await runTransform(plugin, source, `${process.cwd()}/src/pages/Bench.vue`)
  })
})

async function runTransform(plugin: Plugin, code: string, id: string): Promise<unknown> {
  const transform = plugin.transform
  const context = {
    /**
     * Выполняет действие addWatchFile в рамках ответственности текущего класса.
     */
    addWatchFile() {},
  }

  if (typeof transform === 'function') {
    return await transform.call(context as never, code, id)
  }

  return await transform?.handler.call(context as never, code, id)
}

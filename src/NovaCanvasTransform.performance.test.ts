import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { novaVitePlugin } from '@/vite/novaVitePlugin'

describe('NovaCanvas Vue transform performance', () => {
  it('transforms a NovaCanvas SFC with 200 nodes, reactive bindings and novacss under budget', async () => {
    const plugin = novaVitePlugin()
    const source = createVueSource(1, 200, 20)

    const startedAt = performance.now()
    const result = await runTransform(plugin, source, `${process.cwd()}/src/pages/Bench.vue`)
    const elapsed = performance.now() - startedAt

    expect(result).toMatchObject({ map: null })
    expect(elapsed).toBeLessThan(100)
    console.info(`[bench] compiler:vue-novacanvas-1 elapsed=${elapsed.toFixed(2)}ms budget=100ms`)
  })

  it('transforms five NovaCanvas instances and clears stale owner virtual modules', async () => {
    const plugin = novaVitePlugin()
    const file = `${process.cwd()}/src/pages/MultiBench.vue`
    const first = await runTransform(plugin, createVueSource(5, 40, 4, 'first'), file)
    const firstCode = (first as { code: string }).code
    const firstVirtualId = firstCode.match(/from "(virtual:nova-template:[^"]+)"/)?.[1]

    const startedAt = performance.now()
    const second = await runTransform(plugin, createVueSource(5, 40, 4, 'second'), file)
    const elapsed = performance.now() - startedAt
    const secondCode = (second as { code: string }).code
    const virtualIds = [...secondCode.matchAll(/from "(virtual:nova-template:[^"]+)"/g)].map(match => match[1])

    expect(virtualIds).toHaveLength(5)
    expect(firstVirtualId).toBeTruthy()
    expect(await runLoad(plugin, firstVirtualId!)).toBeNull()
    expect(elapsed).toBeLessThan(180)
    console.info(`[bench] compiler:vue-novacanvas-5 elapsed=${elapsed.toFixed(2)}ms budget=180ms virtualModules=5`)
  })
})

function createVueSource(canvasCount: number, nodeCount: number, bindingCount: number, label = 'bench'): string {
  const bindings = Array.from({ length: bindingCount }, (_item, index) => `const value${index} = ${index}`).join('\n')
  const canvases = Array.from({ length: canvasCount }, (_item, canvasIndex) => {
    const nodes = Array.from({ length: nodeCount }, (_row, index) => {
      const binding = `value${index % bindingCount}`
      return `<TextBlock id="${label}-${canvasIndex}-${index}" :text="${binding}" />`
    }).join('\n')

    return `<NovaCanvas><Flex direction="column">${nodes}</Flex></NovaCanvas>`
  }).join('\n')

  return `
    <script setup lang="ts">
    ${bindings}
    </script>

    <template>
      <section>
        ${canvases}
      </section>
    </template>

    <style scoped lang="novacss">
    TextBlock { color: #111111; }
    Flex { background: #f8fafc; }
    </style>

    <style lang="novacss">
    Root { background: #ffffff; }
    </style>
  `
}

async function runTransform(plugin: Plugin, code: string, id: string): Promise<unknown> {
  const transform = plugin.transform
  const context = {
    addWatchFile() {},
  }

  if (typeof transform === 'function') {
    return await transform.call(context as never, code, id)
  }

  return await transform?.handler.call(context as never, code, id)
}

async function runLoad(plugin: Plugin, id: string): Promise<unknown> {
  const load = plugin.load
  const context = {
    addWatchFile() {},
  }

  if (typeof load === 'function') {
    return await load.call(context as never, id)
  }

  return await load?.handler.call(context as never, id)
}

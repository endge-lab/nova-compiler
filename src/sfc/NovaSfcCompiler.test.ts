import { describe, expect, it } from 'vitest'
import { compileNovaSfc } from '@/sfc/NovaSfcCompiler'

describe('Nova SFC compiler', () => {
  it('generates a NovaNode class with setup, keyed loop and scoped style asset', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      const props = defineProps()
      function save() { props.onSave?.() }
      </script>

      <template>
        <Root id="root" class="demo">
          <Button
            v-for="item in props.items"
            :key="item.id"
            :layout="{ width: '100%', height: 32 }"
            :text="item.title"
            @press="save"
          />
        </Root>
      </template>

      <style scoped>
      Root.demo { color: var(--nova-scene-text, #111111); }
      </style>
    `, {
      filename: '/demo/NovaDemo.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('export default class NovaDemo extends NovaNode')
    expect(result.code).toContain('new NovaTemplateRuntime(this)')
    expect(result.code).toContain('props.items')
    expect(result.code).toContain("layout:{ width: '100%', height: 32 }")
    expect(result.code).not.toContain('const props = this.props;')
    expect(result.code).toContain('const props = this.setupState.props;')
    expect(result.code).toContain('novaScopeId')
    expect(result.code).toContain('__novaScope: __novaSfcStyle.scopeId')
  })

  it('reports missing template and unknown tags', () => {
    const result = compileNovaSfc(`
      <script setup>
      const value = 1
      </script>
      <template><Unknown /></template>
    `)

    expect(result.diagnostics.some(item => item.code === 'unknown-tag')).toBe(true)
  })

  it('reports missing keys for dynamic lists and compiles branch chains', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <TextBlock v-if="props.ready" text="ready" />
          <TextBlock v-else-if="props.pending" text="pending" />
          <TextBlock v-else text="empty" />
          <Button v-for="item in props.items" :text="item.title" />
        </Root>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'missing-key')).toBe(true)
    expect(result.code).toContain('(props.ready) ?')
    expect(result.code).toContain('(props.pending) ?')
  })

  it('compiles imported nova components and Component src includes', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import TimelineChart from './TimelineChart.nova'
      const props = defineProps()
      const emit = defineEmits()
      </script>

      <template>
        <Root>
          <TimelineChart :options="props.options" @select="emit('select', args[0])" />
          <Component src="./Legend.nova" :items="props.items" />
        </Root>
      </template>
    `, {
      filename: '/demo/Workbench.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain("import TimelineChart from './TimelineChart.nova'")
    expect(result.code).toContain('import __NovaComponent0 from "./Legend.nova"')
    expect(result.code).toContain('type:TimelineChart')
    expect(result.code).toContain('type:__NovaComponent0')
    expect(result.code).toContain('select:(...args) => (emit')
  })

  it('reports dynamic Component src and children on compiled components', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import TimelineChart from './TimelineChart.nova'
      </script>

      <template>
        <Root>
          <Component :src="props.src" />
          <TimelineChart><TextBlock text="slot" /></TimelineChart>
        </Root>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'dynamic-component-src')).toBe(true)
    expect(result.diagnostics.some(item => item.code === 'compiled-component-children')).toBe(true)
  })

  it('splits scoped and global style assets', () => {
    const result = compileNovaSfc(`
      <template>
        <Root class="local">
          <TextBlock class="global" text="demo" />
        </Root>
      </template>

      <style scoped>
      Root.local { background: #ffffff; }
      </style>

      <style>
      TextBlock.global { color: #111111; }
      </style>
    `, {
      filename: '/demo/Styles.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('__novaSfcGlobalStyles = [__novaSfcGlobalStyle]')
    expect(result.code).toContain('registerNovaUiGlobalStyleSheet')
    expect(result.code).toContain('__novaScope: __novaSfcStyle.scopeId')
    expect(result.code).toContain('styleSheet:__novaSfcStyle')
  })
})

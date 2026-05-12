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

  it('compiles imported class component symbols and aliases as constructor types', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import { InspectorNode as Inspector } from './InspectorNode'
      import Sidebar from './Sidebar.nova'
      </script>

      <template>
        <SplitPane>
          <Inspector :documentId="props.id" />
          <Sidebar />
        </SplitPane>
      </template>
    `, {
      filename: '/demo/ClassWorkbench.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain("import { InspectorNode as Inspector } from './InspectorNode'")
    expect(result.code).toContain('type:Inspector')
    expect(result.code).toContain('type:Sidebar')
    expect(result.code).toContain('documentId:props.id')
  })

  it('reports dynamic Component src while compiling children as default slots', () => {
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
    expect(result.diagnostics.some(item => item.code === 'compiled-component-children')).toBe(false)
    expect(result.code).toContain('slots:{default:')
    expect(result.code).toContain('type:TimelineChart')
  })

  it('compiles named scoped slots and fallback slot outlets', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import SceneList from './SceneList.nova'
      const props = defineProps()
      </script>

      <template>
        <Root>
          <ScrollArea id="scroll" scrollbarVisibility="active">
            <Flex>
              <TextBlock v-for="item in props.items" :key="item.id" :text="item.title" />
            </Flex>

            <template #thumb="{ orientation, state, thumbRect }">
              <Surface
                :key="orientation"
                class="thumb"
                :x="thumbRect.x"
                :y="thumbRect.y"
                :width="thumbRect.width"
                :height="thumbRect.height"
                :opacity="state.opacity"
              />
            </template>
          </ScrollArea>

          <SceneList>
            <template #default="{ selected }">
              <slot name="empty" :selected="selected">
                <TextBlock text="fallback" />
              </slot>
            </template>
          </SceneList>
        </Root>
      </template>
    `, {
      filename: '/demo/Slots.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('slots:{thumb:')
    expect(result.code).toContain('const { orientation, state, thumbRect } = __slotProps;')
    expect(result.code).toContain('slots:{default:')
    expect(result.code).toContain('this.renderSlot("empty"')
    expect(result.code).toContain('selected:selected')
  })

  it('compiles named slots on Component src includes', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Component src="./Panel.nova">
            <template #footer="{ state }">
              <TextBlock :text="state.label" />
            </template>
          </Component>
        </Root>
      </template>
    `, {
      filename: '/demo/ComponentSlots.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('import __NovaComponent0 from "./Panel.nova"')
    expect(result.code).toContain('slots:{footer:')
    expect(result.code).toContain('const { state } = __slotProps;')
  })

  it('reports orphan slot templates', () => {
    const result = compileNovaSfc(`
      <template>
        <template #thumb>
          <TextBlock text="bad" />
        </template>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'orphan-slot-template')).toBe(true)
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

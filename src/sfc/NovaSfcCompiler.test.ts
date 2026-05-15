import { describe, expect, it } from 'vitest'
import { compileNovaSfc } from '@/sfc/nova-sfc-compiler'

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
            for="item in props.items"
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
    expect(result.code).toContain('registerNovaUIKit(app.schema)')
    expect(result.code).toContain('__ensureNovaUiKit(app)')
    expect(result.code).toContain('new NovaTemplateRuntime(this, { refs: props.novaRefs ?? {} })')
    expect(result.code).toContain('__novaFor(props.items).flatMap((item, index)')
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
          <TextBlock if="props.ready" text="ready" />
          <TextBlock else-if="props.pending" text="pending" />
          <TextBlock else text="empty" />
          <Button for="item in props.items" :text="item.title" />
        </Root>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'missing-key')).toBe(true)
    expect(result.diagnostics.some(item => item.code === 'unsupported-directive')).toBe(false)
    expect(result.code).toContain('(props.ready) ?')
    expect(result.code).toContain('(props.pending) ?')
  })

  it('requires keys for numeric range loops', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Surface for="i in 5" :x="i" />
        </Root>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'missing-key')).toBe(true)
  })

  it('compiles public if/else-if/else and for syntax', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <TextBlock if="props.ready" text="ready" />
          <TextBlock else-if="props.pending" text="pending" />
          <TextBlock else text="empty" />
          <Button for="item in props.items" :key="item.id" :text="item.title" />
          <Surface for="i in 5" :key="i" :x="i" />
        </Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('(props.ready) ?')
    expect(result.code).toContain('(props.pending) ?')
    expect(result.code).toContain('__novaFor(props.items).flatMap((item, index)')
    expect(result.code).toContain('__novaFor(5).flatMap((i, index)')
  })

  it('prefers Vue-like bound control-flow syntax and keeps legacy syntax working', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <TextBlock :if="props.ready" text="ready" />
          <TextBlock :else-if="props.pending" text="pending" />
          <TextBlock else text="empty" />
          <Button :for="item in props.items" :key="item.id" :text="item.title" />
          <Surface if="props.legacy" background="#ffffff" />
        </Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('(props.ready) ?')
    expect(result.code).toContain('(props.pending) ?')
    expect(result.code).toContain('__novaFor(props.items).flatMap((item, index)')
    expect(result.code).toContain('(props.legacy) ?')
  })

  it('compiles Scenes and Scene DSL tags to core Nova scene schema types', () => {
    const result = compileNovaSfc(`
      <template>
        <Scenes :active="props.activeScene" strategy="keep-alive">
          <Scene id="red">
            <Root id="red-root" />
          </Scene>
          <Scene id="blue">
            <Root id="blue-root" />
          </Scene>
        </Scenes>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('type:"nova.scenes"')
    expect(result.code).toContain('type:"nova.scene"')
    expect(result.code).toContain('active:props.activeScene')
    expect(result.code).toContain('strategy:"keep-alive"')
  })

  it('exposes canvas namespace for explicit root sizing', () => {
    const result = compileNovaSfc(`
      <template>
        <Root :width="canvas.width" :height="canvas.height">
          <TextBlock text="demo" />
        </Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('const canvas = { width: this.width, height: this.height };')
    expect(result.code).toContain('width:canvas.width')
    expect(result.code).toContain('height:canvas.height')
  })

  it('normalizes kebab-case DSL props to camelCase schema props', () => {
    const result = compileNovaSfc(`
      <script setup>
      const props = defineProps()
      </script>
      <template>
        <Root>
          <Flex justify-content="center" :align-items="props.align" row-gap="12" />
        </Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('justifyContent:"center"')
    expect(result.code).toContain('alignItems:props.align')
    expect(result.code).toContain('rowGap:12')
    expect(result.code).not.toContain('"justify-content"')
    expect(result.code).not.toContain('"align-items"')
    expect(result.code).not.toContain('"row-gap"')
  })

  it('reports conflicting camelCase and kebab-case aliases on one DSL node', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Flex justifyContent="start" justify-content="center" />
        </Root>
      </template>
    `)

    expect(result.diagnostics.some(item => item.code === 'duplicate-prop-alias')).toBe(true)
  })

  it('reports legacy v-if/v-for as unsupported directives', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <TextBlock v-if="props.ready" text="ready" />
          <Button v-for="item in props.items" :key="item.id" :text="item.title" />
        </Root>
      </template>
    `)

    expect(result.diagnostics.filter(item => item.code === 'unsupported-directive')).toHaveLength(2)
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

  it('keeps native events in schema events and maps UI Kit semantic events to callback props', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import Widget from './Widget.nova'
      const props = defineProps()
      function clickHandler(event) {}
      function pressHandler(event) {}
      function valueHandler(value) {}
      function scrollEndHandler(state) {}
      function resizeStartHandler(payload) {}
      </script>

      <template>
        <Root>
          <Button @click="clickHandler" @press="pressHandler" />
          <Slider @value-change="valueHandler" @drag-start="valueHandler" />
          <ScrollArea @scroll-end="scrollEndHandler" />
          <SplitPane @resize-start="resizeStartHandler" />
          <Widget @press="pressHandler" />
        </Root>
      </template>
    `, {
      filename: '/demo/Events.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('events:{click:clickHandler}')
    expect(result.code).toContain('onPress:pressHandler')
    expect(result.code).toContain('onValueChange:valueHandler')
    expect(result.code).toContain('onDragStart:valueHandler')
    expect(result.code).toContain('onScrollEnd:scrollEndHandler')
    expect(result.code).toContain('onResizeStart:resizeStartHandler')
    expect(result.code).toContain('type:Widget')
    expect(result.code).toContain('events:{press:pressHandler}')
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
              <TextBlock for="item in props.items" :key="item.id" :text="item.title" />
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

  it('emits ref and refKey schema fields without forwarding them as component props', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <TimelineChart.Root
            ref="timeline"
            :ref-key="item.id"
            :data="props.data"
          />
        </Root>
      </template>
    `)

    expect(result.code).toContain('ref:"timeline"')
    expect(result.code).toContain('refKey:item.id')
    expect(result.code).toContain('data:props.data')
    expect(result.code).not.toContain('props:{ref:')
    expect(result.code).not.toContain('props:{"ref-key"')
  })
})

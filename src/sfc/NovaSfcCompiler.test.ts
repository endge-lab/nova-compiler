import { describe, expect, it } from 'vitest'
import {
  compileNovaSfc,
  compileTimelineGroupColumnTemplatesSource,
  compileTimelineTaskProfilesSource,
} from '@/sfc/nova-sfc-compiler'

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
    expect(result.code).toContain('import { Nova as __NovaRuntime, NovaNode, NovaTemplateRuntime }')
    expect(result.code).toContain('__NovaRuntime.trackNode(this, () => {')
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

  it('compiles static asset paths for Image and SelectInput aliases', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Image src="./assets/avatar.png" :radius="18" />
          <SelectInput src="./assets/search.svg" asset-color="#52627a" />
        </Root>
      </template>
    `, {
      filename: '/demo/NovaDemo.nova',
      resolveImport: request => {
        if (request === './assets/avatar.png') return { filename: '/demo/assets/avatar.png', source: '' }
        if (request === './assets/search.svg') return { filename: '/demo/assets/search.svg', source: '<svg />' }
        return null
      },
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('type:__NovaUIKit.Image')
    expect(result.code).toContain('src:__novaSfcAssets.images.avatar_')
    expect(result.code).toContain('type:__NovaUIKit.SelectInput')
    expect(result.code).toContain('icon:__novaSfcAssets.icons.search_')
    expect(result.code).toContain('color: "#52627a"')
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

  it('inlines external template src files without creating component nodes', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <template src="./body.nova" />
        </Root>
      </template>
    `, {
      filename: '/demo/Screen.nova',
      resolveImport: request => request === './body.nova'
        ? {
            filename: '/demo/body.nova',
            source: `
              <template>
                <TextBlock text="Included" />
              </template>
            `,
          }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.dependencies).toEqual(['/demo/body.nova'])
    expect(result.code).toContain('text:"Included"')
    expect(result.code).not.toContain('type:__NovaComponent')
  })

  it('inlines imported .nova schema fragments with nova:schema directive', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import Markers from './plugins/Markers.nova'
      </script>

      <template>
        <TimelineChart.Root>
          <Markers nova:schema />
        </TimelineChart.Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => request === './plugins/Markers.nova'
        ? {
            filename: '/demo/plugins/Markers.nova',
            source: `
              <template>
                <TimelineChart.Markers :create="{ modifiers: ['alt'] }">
                  <TimelineChart.Marker id="today" kind="today" label="Сегодня" color="#1d73ff" />
                </TimelineChart.Markers>
              </template>
            `,
          }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.dependencies).toEqual(['/demo/plugins/Markers.nova'])
    expect(result.code).toContain('compiledMarkers:')
    expect(result.code).toContain('create:{ modifiers: [\'alt\'] }')
    expect(result.code).toContain('defaultValue:[{id:"today",kind:"today"')
    expect(result.code).not.toContain("import Markers from './plugins/Markers.nova'")
    expect(result.code).not.toContain('type:Markers')
  })

  it('reports invalid nova:schema usage', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import NotNova from './plain.ts'
      </script>

      <template>
        <Root>
          <Missing nova:schema />
          <NotNova nova:schema />
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
    })

    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'nova-schema-import-missing',
      'nova-schema-source',
    ]))
  })

  it('keeps nova:inline as a legacy alias for nova:schema', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import Markers from './plugins/Markers.nova'
      </script>

      <template>
        <TimelineChart.Root>
          <Markers nova:inline />
        </TimelineChart.Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => request === './plugins/Markers.nova'
        ? {
            filename: '/demo/plugins/Markers.nova',
            source: '<template><TimelineChart.Markers /></template>',
          }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('compiledMarkers:')
  })

  it('collects static SVG assets into an auto Nova asset bundle with dedupe', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Icon src="./plane.svg" asset-color="#52627a" :x="0" :y="0" :width="16" :height="16" />
          <Icon src="./plane.svg" asset-color="#52627a" :x="20" :y="0" :width="16" :height="16" />
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => request === './plane.svg'
        ? { filename: '/demo/plane.svg', source: '<svg />' }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('const __novaSfcAssets = __NovaRuntime.assets.define')
    expect(result.code.match(/plane\.svg\?raw/g)).toHaveLength(1)
    expect(result.code).toContain('this.nova.assets.use(__novaSfcAssets)')
    expect(result.code).toContain('this.nova.assets.unuse(__novaSfcAssets)')
  })

  it('collects StripePattern fills and excludes declaration nodes from visual schema', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <StripePattern id="weekendStripe" bg-color="transparent" stripe-color="rgba(37,99,235,.08)" :stripe-width="2" />
          <TimelineChart.Root>
            <TimelineTaskProfile name="default">
              <Rect :width="width" :height="height" fill-pattern="weekendStripe" />
            </TimelineTaskProfile>
          </TimelineChart.Root>
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('__NovaRuntime.assets.stripe')
    expect(result.code).toContain('background:__novaSfcAssets.fills.weekendStripe')
    expect(result.code).not.toContain('type:"StripePattern"')
  })

  it('collects Nova.Assets declarations and excludes the assets container from visual schema', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      const heatmapCanvas = document.createElement('canvas')
      </script>
      <template>
        <Root>
          <Nova.Assets>
            <Nova.StripePattern id="softTaskStripe" bg-color="transparent" stripe-color="rgba(255,255,255,.16)" :stripe-width="2" />
            <Nova.Image id="terminalMap" src="./terminal.png" />
            <Nova.Icon id="warningIcon" src="./warning.svg" color="#ef4444" />
            <Nova.CanvasTexture id="heatmapTexture" :source="heatmapCanvas" />
            <Nova.LinearGradient id="taskFade" from="#ffffff" to="rgba(255,255,255,0)" :angle="90" />
            <Nova.RadialGradient id="spotlight" inner="#ffffff" outer="#2563eb" :radius-x="0.7" />
            <Nova.ConicGradient id="wheel" from="#22c55e" to="#ef4444" :start-angle="45" />
            <Nova.Pattern id="tile" src="./tile.png" repeat="repeat-x" />
            <Nova.Noise id="grain" base-color="rgba(255,255,255,0)" noise-color="#0f172a" :opacity="0.12" />
            <Nova.MeshGradient id="mesh" background="#ffffff" :points="[{ x: 0.5, y: 0.5, color: '#2563eb' }]" />
            <Nova.NineSliceImage id="panelFrame" src="./panel.png" :slice="8" />
            <Nova.Font id="displayFont" family="Nova Display" src="./display.woff2" weight="700" />
          </Nova.Assets>
          <Image src="terminalMap" />
          <Icon icon="warningIcon" :x="0" :y="0" :width="16" :height="16" />
          <Rect :width="100" :height="20" fill-pattern="taskFade" />
          <Rect :width="100" :height="20" background="heatmapTexture" />
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => {
        if (request === './terminal.png') return { filename: '/demo/terminal.png', source: '' }
        if (request === './warning.svg') return { filename: '/demo/warning.svg', source: '<svg />' }
        if (request === './tile.png') return { filename: '/demo/tile.png', source: '' }
        if (request === './panel.png') return { filename: '/demo/panel.png', source: '' }
        if (request === './display.woff2') return { filename: '/demo/display.woff2', source: '' }
        return null
      },
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('__NovaRuntime.assets.stripe')
    expect(result.code).toContain('__NovaRuntime.assets.image')
    expect(result.code).toContain('__NovaRuntime.assets.svg')
    expect(result.code).toContain('__NovaRuntime.assets.canvas')
    expect(result.code).toContain('__NovaRuntime.assets.linearGradient')
    expect(result.code).toContain('__NovaRuntime.assets.radialGradient')
    expect(result.code).toContain('__NovaRuntime.assets.conicGradient')
    expect(result.code).toContain('__NovaRuntime.assets.pattern')
    expect(result.code).toContain('__NovaRuntime.assets.noise')
    expect(result.code).toContain('__NovaRuntime.assets.meshGradient')
    expect(result.code).toContain('__NovaRuntime.assets.nineSliceImage')
    expect(result.code).toContain('__NovaRuntime.assets.font')
    expect(result.code).toContain('src:__novaSfcAssets.images.terminalMap')
    expect(result.code).toContain('icon:__novaSfcAssets.icons.warningIcon')
    expect(result.code).toContain('background:__novaSfcAssets.fills.taskFade')
    expect(result.code).toContain('background:__novaSfcAssets.fills.heatmapTexture')
    expect(result.code).not.toContain('type:"Nova.Assets"')
    expect(result.code).not.toContain('type:"Nova.StripePattern"')
  })

  it('reports required diagnostics for new Nova asset declarations', () => {
    const result = compileNovaSfc(`
      <template>
        <Root>
          <Nova.Assets>
            <Nova.RadialGradient id="radial" />
            <Nova.ConicGradient id="conic" />
            <Nova.MeshGradient id="mesh" />
            <Nova.NineSliceImage id="panel" src="./panel.png" />
            <Nova.Font id="font" src="./font.woff2" />
          </Nova.Assets>
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => ({ filename: `/demo/${request}`, source: '' }),
    })

    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'radial-gradient-colors',
      'conic-gradient-colors',
      'mesh-gradient-points',
      'nine-slice-image-slice',
      'font-family',
    ]))
  })

  it('registers imported Nova.Assets bundles in component lifecycle', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import timelineAssets from './timeline.assets'
      </script>
      <template>
        <Root>
          <Nova.Assets global src="./shared.assets" />
          <Nova.Assets global :bundle="timelineAssets" />
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => {
        if (request === './shared.assets') return { filename: '/demo/shared.assets.ts', source: 'export default {}' }
        return null
      },
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('import __novaAssetBundle0 from "/demo/shared.assets.ts";')
    expect(result.code).toContain('this.refreshAssetBundles();')
    expect(result.code).toContain('const bundles = [__novaAssetBundle0, timelineAssets].filter(Boolean);')
    expect(result.code).toContain('this.nova.assets.use(bundle);')
    expect(result.code).toContain('this.nova.assets.unuse(bundle);')
  })

  it('inlines external template src files inside TimelineTaskProfile bodies', () => {
    const result = compileTimelineTaskProfilesSource(`
      <TimelineTaskProfile name="planned">
        <template #default src="./planned.nova" />
      </TimelineTaskProfile>
    `, {
      filename: '/demo/App.vue',
      resolveImport: request => request === './planned.nova'
        ? {
            filename: '/demo/planned.nova',
            source: `
              <template>
                <Rect :width="width" :height="height" background="#f8fafc" />
                <TextBlock :text="task.title" :width="width - 12" :height="height" />
              </template>
            `,
          }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.dependencies).toEqual(['/demo/planned.nova'])
    expect(result.code).toContain('planned:{')
    expect(result.code).toContain("type:'rect'")
    expect(result.code).toContain("type:'text'")
    expect(result.code).toContain('text:task.title')
  })

  it('compiles TimelineChart.GroupColumn cell and header slots to schema factories', () => {
    const result = compileTimelineGroupColumnTemplatesSource(`
      <TimelineChart.GroupsPanel>
        <TimelineChart.GroupColumn id="readiness">
          <template #header="{ column, x, y, width, height }">
            <TextBlock :text="column.title" :x="x" :y="y" :width="width" :height="height" />
          </template>

          <template #cell="{ group, x, y, width, height }">
            <ProgressRing
              :x="x + 14"
              :y="y + 4"
              :value="group.item.readiness"
              :size="14"
              :stroke-width="2"
              color="#10b981"
            />
            <TextBlock :text="String(group.item.readiness) + '%'" :x="x + 32" :y="y" :width="width - 32" :height="height" />
          </template>
        </TimelineChart.GroupColumn>
      </TimelineChart.GroupsPanel>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('readiness:{')
    expect(result.code).toContain('header:(__timelineGroupColumnHeader)')
    expect(result.code).toContain('cell:(__timelineGroupColumn)')
    expect(result.code).toContain('__NovaUIKit.progressRingSchema')
    expect(result.code).toContain('value:group.item.readiness')
  })

  it('compiles TimelineChart.GroupsPanel background slot to a panel schema factory', () => {
    const result = compileNovaSfc(`
      <template>
        <TimelineChart.Root>
          <TimelineChart.GroupsPanel>
            <template #background="{ x, y, width, height, bodyY, bodyHeight, columnRects, visibleGroups, api }">
              <Rect :x="x" :y="y" :width="width" :height="height" background="#fff" />
              <Rect
                for="group in visibleGroups"
                :x="x"
                :y="Math.max(group.y, bodyY)"
                :width="width"
                :height="Math.max(0, Math.min(group.y + group.height, bodyY + bodyHeight) - Math.max(group.y, bodyY))"
                :background="group.hasChildren ? '#f8fbff' : '#fff'"
              />
            </template>
            <template #overlay="{ x, y, height, columnRects, api }">
              <Line
                for="columnRect in columnRects"
                :x1="columnRect.x + columnRect.width - 1"
                :y1="y"
                :x2="columnRect.x + columnRect.width - 1"
                :y2="height"
                :color="api.resolveThemeToken('--line', '#e7edf5')"
              />
            </template>
          </TimelineChart.GroupsPanel>
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('compiledGroupPanelTemplate:')
    expect(result.code).toContain('compiledGroupPanelOverlayTemplate:')
    expect(result.code).toContain('const columnRects = ctx.columnRects')
    expect(result.code).toContain('const bodyY = ctx.bodyY')
    expect(result.code).toContain('const bodyHeight = ctx.bodyHeight')
    expect(result.code).toContain('__novaFor(visibleGroups)')
    expect(result.code).toContain('__novaFor(columnRects)')
  })

  it('inlines imported nova:schema fragments inside TimelineChart.GroupsPanel', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import GroupPanel from './groups/GroupPanel.nova'
      </script>

      <template>
        <TimelineChart.Root>
          <TimelineChart.GroupsPanel :layout="{ width: 220, height: 'fill' }">
            <GroupPanel nova:schema />
          </TimelineChart.GroupsPanel>
        </TimelineChart.Root>
      </template>
    `, {
      filename: '/demo/App.nova',
      resolveImport: request => request === './groups/GroupPanel.nova'
        ? {
            filename: '/demo/groups/GroupPanel.nova',
            source: `
              <template>
                <template #background="{ x, y, width, height }">
                  <Rect :x="x" :y="y" :width="width" :height="height" background="#ffffff" />
                </template>

                <TimelineChart.GroupColumn id="status">
                  <template #cell="{ group, x, y }">
                    <Circle :x="x + 8" :y="y + 8" :radius="4" :background="group.item.color" />
                  </template>
                </TimelineChart.GroupColumn>
              </template>
            `,
          }
        : null,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.dependencies).toEqual(['/demo/groups/GroupPanel.nova'])
    expect(result.code).toContain('compiledGroupPanelTemplate:')
    expect(result.code).toContain('compiledGroupColumnTemplates:{')
    expect(result.code).toContain('status:{')
    expect(result.code).toContain('type:"TimelineChart.GroupsPanel"')
    expect(result.code).not.toContain('type:"TimelineChart.GroupColumn"')
    expect(result.code).not.toContain("import GroupPanel from './groups/GroupPanel.nova'")
  })

  it('compiles TimelineChart.GridTemplate to a grid schema factory', () => {
    const result = compileNovaSfc(`
      <template>
        <TimelineChart.Root>
          <TimelineChart.GridTemplate>
            <Rect
              :x="store.groupsWidth"
              :y="verticalLines[0]?.y ?? 0"
              :width="store.mainPanelWidth"
              :height="verticalLines[0]?.height ?? height"
              :background="api.resolveThemeToken('--grid-bg', '#f8fbff')"
            />
            <Rect
              for="line in verticalLines"
              :key="line.id"
              :x="line.x"
              :y="line.y"
              :width="line.lineWidth"
              :height="line.height"
              :background="line.color"
            />
          </TimelineChart.GridTemplate>
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('compiledGridTemplate:')
    expect(result.code).toContain('const verticalLines = ctx.verticalLines')
    expect(result.code).toContain('const horizontalLines = ctx.horizontalLines')
    expect(result.code).toContain('const store = ctx.store')
    expect(result.code).toContain('__novaFor(verticalLines)')
    expect(result.code).not.toContain('type:"TimelineChart.GridTemplate"')
  })

  it('compiles TimelineChart.Markers DSL to compiled marker options', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      const markers = []
      </script>

      <template>
        <TimelineChart.Root>
          <TimelineChart.Markers
            :items="markers"
            :create="{ modifiers: ['alt', 'option'] }"
            :body-layer="{ anchor: 'chart.beforeTasks', clip: 'tasks' }"
            :label-layer="{ anchor: 'root.overlay', clip: 'root' }"
          >
            <TimelineChart.Marker
              id="today"
              kind="today"
              label="Сегодня"
              color="#1d73ff"
              :line="{ from: 'tasks.top', to: 'tasks.bottom' }"
              :label-placement="{ anchor: 'timescale.bottom', align: 'center', offsetY: 6 }"
            />
          </TimelineChart.Markers>
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('compiledMarkers:')
    expect(result.code).toContain('value:markers')
    expect(result.code).toContain('create:{ modifiers: [\'alt\', \'option\'] }')
    expect(result.code).toContain('bodyLayer:{ anchor: \'chart.beforeTasks\', clip: \'tasks\' }')
    expect(result.code).toContain('labelLayer:{ anchor: \'root.overlay\', clip: \'root\' }')
    expect(result.code).toContain('defaultValue:[{id:"today",kind:"today"')
    expect(result.code).toContain('line:{ from: \'tasks.top\', to: \'tasks.bottom\' }')
    expect(result.code).toContain('label:{ anchor: \'timescale.bottom\', align: \'center\', offsetY: 6 }')
  })

  it('compiles TimelineChart.Markers and Marker body/label slots', () => {
    const result = compileNovaSfc(`
      <template>
        <TimelineChart.Root>
          <TimelineChart.Markers>
            <template #body="{ defaultRender }">
              <Rect :width="10" :height="10" background="#000000" />
            </template>
            <template #label="{ defaultRender }">
              <TextBlock text="Marker" :width="40" :height="14" />
            </template>
            <TimelineChart.Marker id="today" kind="today">
              <template #body="{ rects, timeToPx, state }">
                <Rect :x="timeToPx(state.now)" :y="rects.tasks.y" :width="2" :height="rects.tasks.height" />
              </template>
              <template #label="{ rects }">
                <TextBlock text="Сегодня" :x="rects.timescale.x" :y="rects.timescale.y" :width="56" :height="16" />
              </template>
            </TimelineChart.Marker>
          </TimelineChart.Markers>
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('renderBody:(__timelineMarker)')
    expect(result.code).toContain('renderLabel:(__timelineMarker)')
    expect(result.code).toContain('defaultValue:[{id:"today",kind:"today",renderBody:')
  })

  it('compiles TimelineChart.Marker slot to renderMarker context', () => {
    const result = compileNovaSfc(`
      <template>
        <TimelineChart.Root>
          <TimelineChart.Markers>
            <TimelineChart.Marker id="today" kind="today">
              <template #default="{ rects, timeToPx, state, defaultRender }">
                <Rect :x="timeToPx(state.now) - 1" :y="rects.tasks.y" :width="2" :height="rects.tasks.height" background="#1d73ff" />
                <TextBlock text="Сегодня" :x="timeToPx(state.now) + 4" :y="rects.tasks.y" :width="56" :height="18" />
              </template>
            </TimelineChart.Marker>
          </TimelineChart.Markers>
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('renderMarker:(__timelineMarker)')
    expect(result.code).toContain('const rects = ctx.rects')
    expect(result.code).toContain('const timeToPx = ctx.timeToPx')
    expect(result.code).toContain('const defaultRender = ctx.defaultRender')
    expect(result.code).toContain('x:timeToPx(state.now) - 1')
  })

  it('inlines external template src files inside TimelineChart.GroupsPanel without component nodes', () => {
    const result = compileTimelineGroupColumnTemplatesSource(`
      <TimelineChart.GroupsPanel>
        <template src="./groups/GroupPanel.nova" />
      </TimelineChart.GroupsPanel>
    `, {
      filename: '/demo/App.vue',
      resolveImport: request => {
        if (request === './groups/GroupPanel.nova') {
          return {
            filename: '/demo/groups/GroupPanel.nova',
            source: `
              <template>
                <template src="./columns/StatusColumn.nova" />
              </template>
            `,
          }
        }
        if (request === './columns/StatusColumn.nova') {
          return {
            filename: '/demo/groups/columns/StatusColumn.nova',
            source: `
              <template>
                <TimelineChart.GroupColumn id="status">
                  <template #cell="{ group, x, y, width, height }">
                    <Circle :x="x + 8" :y="y + 8" :radius="4" :background="group.item.color" />
                  </template>
                </TimelineChart.GroupColumn>
              </template>
            `,
          }
        }
        return null
      },
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.dependencies).toEqual(['/demo/groups/GroupPanel.nova', '/demo/groups/columns/StatusColumn.nova'])
    expect(result.code).toContain('status:{')
    expect(result.code).toContain("type:'circle'")
    expect(result.code).not.toContain('type:__NovaComponent')
  })

  it('reports non-schema components inside TimelineChart.GroupColumn schema slots', () => {
    const result = compileTimelineGroupColumnTemplatesSource(`
      <TimelineChart.GroupColumn id="status">
        <template #cell="{ group }">
          <Button :text="group.item.title" />
        </template>
      </TimelineChart.GroupColumn>
    `)

    expect(result.diagnostics.some(item => item.code === 'timeline-group-column-unsupported-node')).toBe(true)
  })

  it('compiles TimelineTaskProfile Rect radius as an independent style', () => {
    const result = compileTimelineTaskProfilesSource(`
      <TimelineTaskProfile name="planned" :selection-highlight="{ radius: 10 }">
        <Rect :width="width" :height="height" background="#f8fafc" :radius="8" />
      </TimelineTaskProfile>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('radius:8')
    expect(result.code).toContain('selectionHighlight:{ radius: 10 }')
  })

  it('compiles TimelineChart annotation profiles into visualProfiles on TimelineChart.Root', () => {
    const result = compileNovaSfc(`
      <template>
        <TimelineChart.Root :data="data">
          <TimelineChart.PointProfile
            id="milestone"
            shape="diamond"
            :size="11"
            :fill="point => point.custom?.color ?? '#10b981'"
            label-position="right"
            :label-offset="8"
            interaction="select-point"
          />
          <TimelineChart.LinkProfile
            id="trace"
            :stroke="link => link.custom?.color ?? '#10b981'"
            pattern="solid"
            routing="orthogonal"
            from-port="right.middle"
            :elbow="{ mode: 'ratio', value: 0.62 }"
          />
        </TimelineChart.Root>
      </template>
    `)

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain('visualProfiles:{pointProfiles:{milestone:{recipe:{')
    expect(result.code).toContain('shape:"diamond"')
    expect(result.code).toContain("fill:point => point.custom?.color ?? '#10b981'")
    expect(result.code).toContain('label:{text:point => point.label,position:"right",offset:8')
    expect(result.code).toContain('linkProfiles:{trace:{recipe:{')
    expect(result.code).toContain('pattern:"solid"')
    expect(result.code).toContain('routing:{type:"orthogonal",fromPort:"right.middle",elbow:{ mode: \'ratio\', value: 0.62 }}')
    expect(result.code).not.toContain('type:"TimelineChart.PointProfile"')
    expect(result.code).not.toContain('type:"TimelineChart.LinkProfile"')
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

  it('compiles default imported nova components through tag syntax', () => {
    const result = compileNovaSfc(`
      <script setup lang="ts">
      import Header from './layout/Header.nova'
      </script>

      <template>
        <Root>
          <Header :layout="{ width: 'fill', height: 48 }" />
        </Root>
      </template>
    `, {
      filename: '/demo/App.nova',
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.code).toContain("import Header from './layout/Header.nova'")
    expect(result.code).toContain('type:Header')
    expect(result.code).toContain("layout:{ width: 'fill', height: 48 }")
    expect(result.code).toContain('this[NOVA_UI_STYLE_TARGET] = true')
    expect(result.code).toContain('this.__novaRefreshParentStyleCascade()')
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
          <SearchInput @value-change="valueHandler" @search="valueHandler" />
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
    expect(result.code).toContain('onSearch:valueHandler')
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

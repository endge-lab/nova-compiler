import { describe, expect, it } from 'vitest'
import {
  getNovaLanguageCompletions,
  getNovaLanguageDiagnostics,
  getNovaLanguageDefinitionLinks,
  getNovaLanguageDefinitions,
  getNovaLanguageMetadata,
} from '@/language/nova-language-service'

describe('Nova language service', () => {
  it('resolves UI Kit tags to source definitions', () => {
    const source = `
      <template>
        <Root>
          <Surface width="120" />
        </Root>
      </template>
    `

    const definitions = getNovaLanguageDefinitions(source, '/demo/Card.nova', source.indexOf('Surface') + 1)

    expect(definitions).toHaveLength(1)
    expect(definitions[0].target).toMatchObject({
      kind: 'ui-kit',
      name: 'Surface',
      symbol: 'Surface',
    })
    expect(definitions[0].target.source).toContain('Surface/Surface.ts')
  })

  it('resolves Component src and imported component definitions', () => {
    const source = `
      <script setup lang="ts">
      import { InspectorNode as Inspector } from './InspectorNode'
      </script>
      <template>
        <Root>
          <Inspector />
          <Component src="./Legend.nova" />
        </Root>
      </template>
    `

    const imported = getNovaLanguageDefinitions(source, '/demo/Card.nova', source.indexOf('Inspector />') + 1)
    const included = getNovaLanguageDefinitions(source, '/demo/Card.nova', source.indexOf('Component src') + 1)

    expect(imported[0].target).toMatchObject({
      kind: 'import',
      name: 'Inspector',
      source: './InspectorNode',
      symbol: 'InspectorNode',
    })
    expect(included[0].target).toMatchObject({
      kind: 'component-src',
      name: './Legend.nova',
      source: './Legend.nova',
    })
  })

  it('returns Volar-compatible definition links', () => {
    const source = '<template><Root><TextBlock text="Demo" /></Root></template>'

    const links = getNovaLanguageDefinitionLinks(source, '/demo/Text.nova', source.indexOf('TextBlock') + 1)

    expect(links).toHaveLength(1)
    expect(links[0].targetUri).toContain('TextBlock/TextBlock.ts')
    expect(links[0].originSelectionRange.start).toBe(source.indexOf('TextBlock'))
  })

  it('extracts inline NovaCanvas metadata from Vue templates only for the default DSL slot', () => {
    const source = `
      <script setup lang="ts">
      import DemoScene from './DemoScene.nova'
      </script>
      <template>
        <NovaCanvas>
          <Surface :width="width" />
          <DemoScene />
          <template #overlay>
            <button>Plain Vue</button>
          </template>
        </NovaCanvas>
      </template>
    `

    const metadata = getNovaLanguageMetadata(source, '/demo/Page.vue')
    const tags = metadata.map(item => item.tag)
    const definitions = getNovaLanguageDefinitions(source, '/demo/Page.vue', source.indexOf('DemoScene />') + 1)

    expect(tags).toContain('Surface')
    expect(tags).toContain('DemoScene')
    expect(tags).not.toContain('button')
    expect(definitions[0].target).toMatchObject({
      kind: 'import',
      name: 'DemoScene',
      source: './DemoScene.nova',
      symbol: 'default',
    })
  })

  it('reports Vue novacss style diagnostics with Vue source offsets', () => {
    const source = `
      <template>
        <NovaCanvas>
          <Flex />
        </NovaCanvas>
      </template>
      <style lang="novacss">
      .box {
        display: flex;
      }
      </style>
    `

    const diagnostics = getNovaLanguageDiagnostics(source, '/demo/Page.vue')

    expect(diagnostics.some(item => item.code === 'unsupported-display')).toBe(true)
    expect(diagnostics[0]?.line).toBeGreaterThan(7)
  })

  it('offers NovaCSS media, display and responsive utility completions', () => {
    const completions = getNovaLanguageCompletions('/demo/style.novacss').map(item => item.label)

    expect(completions).toEqual(expect.arrayContaining([
      '@media',
      'display',
      'none',
      'normal',
      'hidden',
      'shown',
      'sm:',
      'md:',
      'lg:',
    ]))
  })
})

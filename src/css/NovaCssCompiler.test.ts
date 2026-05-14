import { describe, expect, it } from 'vitest'
import { compileNovaCss } from '@/css/nova-css-compiler'

describe('Nova CSS compiler', () => {
  it('compiles imports, nesting and token dependencies', () => {
    const result = compileNovaCss(`
      @import "./tokens.novacss";

      Root.demo {
        color: var(--nova-scene-text, #111111);

        & > TextBlock.title {
          fontSize: 18;
        }
      }
    `, {
      filename: '/demo/root.novacss',
      resolveImport: request => request === './tokens.novacss'
        ? 'Button.primary { background: var(--nova-accent, #2563eb); }'
        : null,
    })

    expect(result.ok).toBe(true)
    expect(result.imports).toEqual(['./tokens.novacss'])
    expect(result.styleSheet?.rules).toHaveLength(3)
    expect(result.tokenDependencies).toEqual(expect.arrayContaining(['--nova-scene-text', '--nova-accent']))
  })

  it('returns diagnostics for invalid values and unknown declarations', () => {
    const result = compileNovaCss(`
      TextBlock {
        fontSize: nope;
        unknownValue: 1;
      }
    `)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some(item => item.code === 'invalid-number')).toBe(true)
    expect(result.diagnostics.some(item => item.code === 'unknown-declaration')).toBe(true)
  })

  it('normalizes kebab-case declarations to canonical camelCase declarations', () => {
    const result = compileNovaCss(`
      Flex.panel {
        font-size: 18;
        line-height: 24;
        border-radius: 14;
        row-gap: 8;
        column-gap: 12;
        accent-color: #14b8a6;
      }
    `)

    expect(result.ok).toBe(true)
    const declarations = result.styleSheet?.rules[0]?.declarations
    expect(declarations?.inheritedText?.fontSize).toBe(18)
    expect(declarations?.inheritedText?.lineHeight).toBe(24)
    expect(declarations?.box?.border?.radius).toBe(14)
    expect(declarations?.layout?.rowGap).toBe(8)
    expect(declarations?.layout?.columnGap).toBe(12)
    expect(declarations?.visual?.accentColor).toBe('#14b8a6')
  })
})

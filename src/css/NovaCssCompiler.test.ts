import { describe, expect, it } from 'vitest'
import { compileNovaCss } from '@/css/NovaCssCompiler'

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
})

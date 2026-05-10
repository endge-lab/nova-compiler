import { compileNovaCss } from '@/css/NovaCssCompiler'
import { compileNovaSfc } from '@/sfc/NovaSfcCompiler'

export interface NovaLanguageDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  line?: number
  column?: number
}

export interface NovaCompletionItem {
  label: string
  kind: 'component' | 'property' | 'style'
}

const COMPONENT_COMPLETIONS = [
  'Root',
  'Flex',
  'Grid',
  'TextBlock',
  'Surface',
  'Button',
  'Tag',
  'SplitPane',
  'ScrollArea',
  'Scrollbar',
  'Slider',
  'Checkbox',
  'Toggle',
  'Tooltip',
  'SegmentedControl',
  'Panel',
]

const STYLE_COMPLETIONS = [
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'background',
  'padding',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'gap',
  'accentColor',
  'cursor',
]

/** Возвращает diagnostics для IDE/LSP integrations. */
export function getNovaLanguageDiagnostics(
  source: string,
  filename: string,
): NovaLanguageDiagnostic[] {
  const result = filename.endsWith('.novacss')
    ? compileNovaCss(source, { filename })
    : compileNovaSfc(source, { filename })

  return result.diagnostics
}

/** Возвращает базовые completions для JetBrains/LSP слоя. */
export function getNovaLanguageCompletions(filename: string): NovaCompletionItem[] {
  if (filename.endsWith('.novacss')) {
    return STYLE_COMPLETIONS.map(label => ({ label, kind: 'style' }))
  }

  return [
    ...COMPONENT_COMPLETIONS.map(label => ({ label, kind: 'component' as const })),
    ...STYLE_COMPLETIONS.map(label => ({ label, kind: 'property' as const })),
  ]
}

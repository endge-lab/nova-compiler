import { baseParse, ElementTypes, NodeTypes, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom'
import { parse as parseVueSfc } from '@vue/compiler-sfc'
import { compileNovaCss } from '../css/nova-css-compiler'
import {
  compileNovaSfc,
  NOVA_UI_KIT_DEFINITION_TARGETS,
  type NovaDefinitionTarget,
  type NovaSourceRange,
  type NovaTemplateNodeMetadata,
} from '../sfc/nova-sfc-compiler'

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
  detail?: string
  documentation?: string
  required?: boolean
}

export interface NovaComponentManifest {
  packageName: string
  version: string
  groups: Array<{
    id: string
    title: string
    components: Array<NovaComponentDoc>
  }>
}

export interface NovaComponentDoc {
  name: string
  title?: string
  description?: { ru?: string; en?: string }
  props?: Array<{
    name: string
    type: string
    required?: boolean
    description?: { ru?: string; en?: string }
  }>
}

export interface NovaLanguageServiceOptions {
  manifests?: Array<NovaComponentManifest>
  tagName?: string
}

export interface NovaLanguagePosition {
  line: number
  column: number
}

export interface NovaLanguageDefinition {
  originRange: NovaSourceRange
  target: NovaDefinitionTarget
}

export interface NovaLanguageDefinitionLink {
  originSelectionRange: NovaSourceRange
  targetUri: string
  targetRange: NovaSourceRange
  targetSelectionRange: NovaSourceRange
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
  'Nova.Assets',
  'Nova.StripePattern',
  'Nova.Image',
  'Nova.Icon',
  'Nova.CanvasTexture',
  'Nova.LinearGradient',
  'Nova.RadialGradient',
  'Nova.ConicGradient',
  'Nova.Pattern',
  'Nova.Noise',
  'Nova.MeshGradient',
  'Nova.NineSliceImage',
  'Nova.Font',
]

const STYLE_COMPLETIONS = [
  '@media',
  'color',
  'fontFamily',
  'font-family',
  'fontSize',
  'font-size',
  'fontWeight',
  'font-weight',
  'fontStyle',
  'font-style',
  'lineHeight',
  'line-height',
  'background',
  'opacity',
  'padding',
  'borderColor',
  'border-color',
  'borderWidth',
  'border-width',
  'borderRadius',
  'border-radius',
  'clip',
  'display',
  'none',
  'normal',
  'gap',
  'rowGap',
  'row-gap',
  'columnGap',
  'column-gap',
  'accentColor',
  'accent-color',
  'trackColor',
  'track-color',
  'thumbColor',
  'thumb-color',
  'hoverBackground',
  'hover-background',
  'pressedBackground',
  'pressed-background',
  'activeBackground',
  'active-background',
  'disabledOpacity',
  'disabled-opacity',
  'cursor',
  'hidden',
  'shown',
  'sm:',
  'md:',
  'lg:',
]

/** Возвращает diagnostics для IDE/LSP integrations. */
export function getNovaLanguageDiagnostics(
  source: string,
  filename: string,
): Array<NovaLanguageDiagnostic> {
  if (filename.endsWith('.vue')) return collectVueNovaCssDiagnostics(source, filename)

  const result = filename.endsWith('.novacss')
    ? compileNovaCss(source, { filename })
    : compileNovaSfc(source, { filename })

  return result.diagnostics
}

/** Возвращает базовые completions для JetBrains/LSP слоя. */
export function getNovaLanguageCompletions(
  filename: string,
  options: NovaLanguageServiceOptions = {},
): Array<NovaCompletionItem> {
  if (filename.endsWith('.novacss')) {
    return STYLE_COMPLETIONS.map(label => ({ label, kind: 'style' }))
  }

  const manifestComponents = collectManifestComponents(options.manifests)
  const manifestProps = options.tagName
    ? collectManifestProps(manifestComponents.get(options.tagName))
    : []

  return [
    ...COMPONENT_COMPLETIONS.map(label => ({ label, kind: 'component' as const })),
    ...[...manifestComponents.values()].map(component => ({
      label: component.name,
      kind: 'component' as const,
      detail: component.title,
      documentation: component.description?.ru,
    })),
    ...manifestProps,
    ...STYLE_COMPLETIONS.map(label => ({ label, kind: 'property' as const })),
  ]
}

function collectManifestComponents(
  manifests: Array<NovaComponentManifest> | undefined,
): Map<string, NovaComponentDoc> {
  const components = new Map<string, NovaComponentDoc>()

  for (const manifest of manifests ?? []) {
    for (const group of manifest.groups ?? []) {
      for (const component of group.components ?? []) {
        components.set(component.name, component)
      }
    }
  }

  return components
}

function collectManifestProps(component: NovaComponentDoc | undefined): Array<NovaCompletionItem> {
  if (!component) return []

  return (component.props ?? []).map(prop => ({
    label: prop.name,
    kind: 'property' as const,
    detail: prop.type,
    documentation: prop.description?.ru,
    required: prop.required,
  }))
}

function collectVueNovaCssDiagnostics(
  source: string,
  filename: string,
): Array<NovaLanguageDiagnostic> {
  const sfc = parseVueSfc(source, { filename })
  const diagnostics: Array<NovaLanguageDiagnostic> = []

  for (const error of sfc.errors) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-parse-error',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  for (const block of sfc.descriptor.styles) {
    if (block.lang !== 'novacss') continue

    const result = compileNovaCss(block.content, { filename })
    diagnostics.push(...result.diagnostics.map(diagnostic => ({
      ...diagnostic,
      line: block.loc.start.line + (diagnostic.line ?? 1) - 1,
      column: (diagnostic.line ?? 1) === 1
        ? block.loc.start.column + (diagnostic.column ?? 1) - 1
        : diagnostic.column,
    })))
  }

  return diagnostics
}

/** Возвращает source metadata для IDE integrations. */
export function getNovaLanguageMetadata(
  source: string,
  filename: string,
): Array<NovaTemplateNodeMetadata> {
  if (filename.endsWith('.vue')) return collectVueNovaCanvasMetadata(source)
  if (filename.endsWith('.novacss')) return []
  return compileNovaSfc(source, { filename }).metadata.nodes
}

/** Возвращает definition targets для Ctrl+B/F12-like integrations. */
export function getNovaLanguageDefinitions(
  source: string,
  filename: string,
  position: number | NovaLanguagePosition,
): Array<NovaLanguageDefinition> {
  const offset = typeof position === 'number' ? position : positionToOffset(source, position)
  const nodes = getNovaLanguageMetadata(source, filename)
  const node = nodes.find(item => containsRange(item.tagRange, offset))
    ?? nodes
      .filter(item => containsRange(item.range, offset))
      .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0]

  if (!node || node.target.kind === 'unknown' || node.target.kind === 'namespaced') return []

  return [{
    originRange: node.tagRange,
    target: node.target,
  }]
}

/** Возвращает LSP/Volar-like definition links поверх Nova definition metadata. */
export function getNovaLanguageDefinitionLinks(
  source: string,
  filename: string,
  position: number | NovaLanguagePosition,
): Array<NovaLanguageDefinitionLink> {
  return getNovaLanguageDefinitions(source, filename, position)
    .filter(definition => !!definition.target.source)
    .map(definition => ({
      originSelectionRange: definition.originRange,
      targetUri: definition.target.source!,
      targetRange: { start: 0, end: 0 },
      targetSelectionRange: { start: 0, end: 0 },
    }))
}

function collectVueNovaCanvasMetadata(source: string): Array<NovaTemplateNodeMetadata> {
  const sfc = parseVueSfc(source)
  const template = sfc.descriptor.template
  if (!template) return []

  const imports = collectScriptSetupImports(sfc.descriptor.scriptSetup?.content ?? '')
  const ast = baseParse(template.content)
  const result: Array<NovaTemplateNodeMetadata> = []
  const baseOffset = template.loc.start.offset

  for (const child of ast.children) {
    collectVueTemplateNodeMetadata(child, baseOffset, false, imports, result)
  }

  return result
}

function collectVueTemplateNodeMetadata(
  child: TemplateChildNode,
  baseOffset: number,
  insideNovaCanvas: boolean,
  imports: Map<string, { imported: string; source: string }>,
  result: Array<NovaTemplateNodeMetadata>,
): void {
  if (child.type !== NodeTypes.ELEMENT) return

  const element = child as ElementNode
  const nextInsideNovaCanvas = insideNovaCanvas || element.tag === 'NovaCanvas'

  if (insideNovaCanvas && element.tagType !== ElementTypes.TEMPLATE) {
    result.push({
      tag: element.tag,
      range: toRange(element, baseOffset),
      tagRange: toTagRange(element, baseOffset),
      attrs: collectStaticAttrs(element),
      attrRanges: {},
      target: resolveVueNodeTarget(element, imports),
    })
  }

  if (!Array.isArray(element.children)) return

  for (const nested of element.children) {
    if (element.tag === 'NovaCanvas' && isNamedVueTemplate(nested)) continue
    collectVueTemplateNodeMetadata(nested, baseOffset, nextInsideNovaCanvas, imports, result)
  }
}

function resolveVueNodeTarget(
  element: ElementNode,
  imports: Map<string, { imported: string; source: string }>,
): NovaDefinitionTarget {
  if (NOVA_UI_KIT_DEFINITION_TARGETS[element.tag]) {
    return {
      kind: 'ui-kit',
      name: element.tag,
      source: NOVA_UI_KIT_DEFINITION_TARGETS[element.tag],
      symbol: element.tag,
    }
  }

  if (element.tag === 'Component') {
    const src = readStaticAttr(element, 'src')
    return src
      ? { kind: 'component-src', name: src, source: src }
      : { kind: 'unknown', name: element.tag }
  }

  const imported = imports.get(element.tag) ?? imports.get(element.tag.split('.')[0] ?? '')
  if (imported) {
    return {
      kind: 'import',
      name: element.tag,
      source: imported.source,
      symbol: imported.imported,
    }
  }

  return element.tag.includes('.')
    ? { kind: 'namespaced', name: element.tag, symbol: element.tag }
    : { kind: 'unknown', name: element.tag }
}

function collectScriptSetupImports(source: string): Map<string, { imported: string; source: string }> {
  const imports = new Map<string, { imported: string; source: string }>()
  const pattern = /import\s+(?:([\w$]+)|\{([^}]+)\}|\*\s+as\s+([\w$]+))\s+from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    const [, defaultImport, namedImports, namespaceImport, importSource] = match
    if (defaultImport) imports.set(defaultImport, { imported: 'default', source: importSource })
    if (namespaceImport) imports.set(namespaceImport, { imported: '*', source: importSource })
    if (namedImports) {
      for (const raw of namedImports.split(',')) {
        const [imported, local = imported] = raw.trim().split(/\s+as\s+/)
        if (local) imports.set(local.trim(), { imported: imported.trim(), source: importSource })
      }
    }
  }

  return imports
}

function collectStaticAttrs(element: ElementNode): Record<string, string | true> {
  const attrs: Record<string, string | true> = {}
  for (const prop of element.props) {
    if (prop.type !== NodeTypes.ATTRIBUTE) continue
    attrs[prop.name] = prop.value?.content ?? true
  }
  return attrs
}

function readStaticAttr(element: ElementNode, name: string): string | undefined {
  const attr = element.props.find(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === name)
  return attr?.type === NodeTypes.ATTRIBUTE ? attr.value?.content : undefined
}

function isNamedVueTemplate(node: TemplateChildNode): boolean {
  return node.type === NodeTypes.ELEMENT
    && node.tag === 'template'
    && node.props?.some((prop: any) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot')
}

function toRange(node: { loc: { start: { offset: number }; end: { offset: number } } }, baseOffset: number): NovaSourceRange {
  return {
    start: baseOffset + node.loc.start.offset,
    end: baseOffset + node.loc.end.offset,
  }
}

function toTagRange(element: ElementNode, baseOffset: number): NovaSourceRange {
  const start = baseOffset + element.loc.start.offset + 1
  return {
    start,
    end: start + element.tag.length,
  }
}

function containsRange(range: NovaSourceRange, offset: number): boolean {
  return offset >= range.start && offset <= range.end
}

function rangeSize(range: NovaSourceRange): number {
  return range.end - range.start
}

function positionToOffset(source: string, position: NovaLanguagePosition): number {
  const targetLine = Math.max(1, position.line)
  const targetColumn = Math.max(1, position.column)
  let line = 1
  let column = 1

  for (let index = 0; index < source.length; index += 1) {
    if (line === targetLine && column === targetColumn) return index
    if (source[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return source.length
}

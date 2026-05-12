import { createHash } from 'node:crypto'
import { parse as parseScript } from '@babel/parser'
import {
  baseParse,
  ElementTypes,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type TemplateChildNode,
} from '@vue/compiler-dom'
import { parse as parseSfc, type SFCStyleBlock } from '@vue/compiler-sfc'
import type { NovaUiStyleDiagnostic } from '@endge/nova-ui-kit'
import { compileNovaCss, serializeStyleAsset, type NovaCssCompileOptions } from '@/css/NovaCssCompiler'

export interface NovaSfcCompileOptions extends NovaCssCompileOptions {
  filename?: string
  className?: string
}

export interface NovaSfcCompileResult {
  code: string
  diagnostics: Array<NovaUiStyleDiagnostic>
  scopeId: string
  dependencies: Array<string>
}

interface TemplateNode {
  tag: string
  attrs: Record<string, string | true>
  children: Array<TemplateNode>
  slots: Record<string, TemplateSlotNode>
}

interface TemplateSlotNode {
  name: string
  scope?: string
  children: Array<TemplateNode>
}

interface ScriptSetupCompileResult {
  imports: Array<string>
  body: string
  names: Array<string>
  importedRuntimeSymbols: Set<string>
  topLevelNames: Set<string>
}

interface StyleCompileResult {
  scopedStyleAssetCode: string
  globalStyleAssetCode: string
  hasScopedStyles: boolean
  hasGlobalStyles: boolean
  diagnostics: Array<NovaUiStyleDiagnostic>
}

interface GenerateContext {
  diagnostics: Array<NovaUiStyleDiagnostic>
  importedRuntimeSymbols: Set<string>
  generatedImports: Array<string>
  componentImports: Map<string, string>
  hasScopedStyles: boolean
}

const UI_KIT_TAGS = new Set([
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
])

const PRIMITIVE_TAGS = new Set(['rect', 'border', 'line', 'circle', 'polygon', 'text', 'icon'])

/** Компилирует `.nova` SFC в TypeScript module с generated NovaNode class. */
export function compileNovaSfc(source: string, options: NovaSfcCompileOptions = {}): NovaSfcCompileResult {
  const filename = options.filename
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const sfc = parseSfc(source, { filename })
  const scopeId = createScopeId(filename ?? source)
  const className = options.className ?? createClassName(filename)

  for (const error of sfc.errors) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-parse-error',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  if (!sfc.descriptor.template) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-template',
      message: 'Файл .nova должен содержать <template>.',
    })
  }
  if (sfc.descriptor.script) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported-script',
      message: 'Файл .nova поддерживает только <script setup>.',
    })
  }

  const setup = compileScriptSetup(sfc.descriptor.scriptSetup?.content ?? '', diagnostics)
  const styles = compileSfcStyles(sfc.descriptor.styles, scopeId, options)
  diagnostics.push(...styles.diagnostics)

  const templateNodes = sfc.descriptor.template
    ? parseTemplate(sfc.descriptor.template.content, diagnostics)
    : []
  validateTemplateNodes(templateNodes, diagnostics, {
    importedRuntimeSymbols: setup.importedRuntimeSymbols,
    hasScopedStyles: styles.hasScopedStyles,
  })

  const context: GenerateContext = {
    diagnostics,
    importedRuntimeSymbols: setup.importedRuntimeSymbols,
    generatedImports: [],
    componentImports: new Map(),
    hasScopedStyles: styles.hasScopedStyles,
  }
  const templateCode = generateNodeSequence(templateNodes, context)

  return {
    code: generateModule({
      className,
      setup,
      templateCode,
      scopeId,
      scopedStyleAssetCode: styles.scopedStyleAssetCode,
      globalStyleAssetCode: styles.globalStyleAssetCode,
      hasScopedStyles: styles.hasScopedStyles,
      hasGlobalStyles: styles.hasGlobalStyles,
      generatedImports: context.generatedImports,
    }),
    diagnostics,
    scopeId,
    dependencies: [...context.componentImports.keys()],
  }
}

function compileSfcStyles(
  styles: Array<SFCStyleBlock>,
  scopeId: string,
  options: NovaSfcCompileOptions,
): StyleCompileResult {
  const scopedSource = joinStyleSources(styles.filter(block => block.scoped), options)
  const globalSource = joinStyleSources(styles.filter(block => !block.scoped), options)
  const hasScopedStyles = scopedSource.trim().length > 0
  const hasGlobalStyles = globalSource.trim().length > 0
  const scopedStyleAsset = compileNovaCss(scopedSource, {
    ...options,
    scopeId: hasScopedStyles ? scopeId : undefined,
  })
  const globalStyleAsset = compileNovaCss(globalSource, {
    ...options,
    scopeId: undefined,
  })

  return {
    scopedStyleAssetCode: serializeStyleAsset(scopedStyleAsset),
    globalStyleAssetCode: serializeStyleAsset(globalStyleAsset),
    hasScopedStyles,
    hasGlobalStyles,
    diagnostics: [...scopedStyleAsset.diagnostics, ...globalStyleAsset.diagnostics],
  }
}

function joinStyleSources(styles: Array<SFCStyleBlock>, options: NovaSfcCompileOptions): string {
  return styles.map(block => {
    if (typeof block.attrs.src === 'string') {
      const imported = options.resolveImport?.(block.attrs.src, options.filename)
      if (!imported) return ''
      return typeof imported === 'string' ? imported : imported.source
    }
    return block.content
  }).join('\n')
}

function compileScriptSetup(source: string, diagnostics: Array<NovaUiStyleDiagnostic>): ScriptSetupCompileResult {
  const importRanges: Array<[number, number]> = []
  const imports: Array<string> = []
  const importedRuntimeSymbols = new Set<string>()
  const topLevelNames = new Set<string>()

  if (source.trim()) {
    try {
      const ast = parseScript(source, {
        sourceType: 'module',
        plugins: ['typescript'],
      }) as any

      for (const statement of ast.program.body as Array<any>) {
        if (typeof statement.start === 'number' && typeof statement.end === 'number' && statement.type === 'ImportDeclaration') {
          importRanges.push([statement.start, statement.end])
          if (statement.importKind !== 'type') imports.push(source.slice(statement.start, statement.end))
          if (statement.importKind !== 'type') {
            for (const specifier of statement.specifiers) {
              importedRuntimeSymbols.add(specifier.local.name)
              topLevelNames.add(specifier.local.name)
            }
          }
          continue
        }

        collectStatementNames(statement, topLevelNames)
      }
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'script-parse-error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const bodyWithoutImports = removeRanges(source, importRanges)
  const transformed = transformScriptSetupMacros(bodyWithoutImports)
  const names = collectRuntimeSetupNames(transformed)
  for (const name of names) topLevelNames.add(name)

  return {
    imports,
    body: transformed.trim(),
    names,
    importedRuntimeSymbols,
    topLevelNames,
  }
}

function collectStatementNames(statement: any, target: Set<string>): void {
  if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
    if (statement.id?.name) target.add(statement.id.name)
    return
  }

  if (statement.type !== 'VariableDeclaration') return
  for (const declaration of statement.declarations) collectPatternNames(declaration.id, target)
}

function collectPatternNames(pattern: any, target: Set<string>): void {
  if (!pattern) return
  if (pattern.type === 'Identifier') {
    target.add(pattern.name)
    return
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type === 'ObjectProperty') collectPatternNames(property.value, target)
      if (property.type === 'RestElement') collectPatternNames(property.argument, target)
    }
    return
  }
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) collectPatternNames(element, target)
  }
}

function collectRuntimeSetupNames(source: string): Array<string> {
  const names = new Set<string>()
  try {
    const ast = parseScript(source, {
      sourceType: 'module',
      plugins: ['typescript'],
      allowReturnOutsideFunction: true,
    }) as any
    for (const statement of ast.program.body as Array<any>) collectStatementNames(statement, names)
  } catch {
    for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
    for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  }
  return [...names]
}

function transformScriptSetupMacros(source: string): string {
  return source
    .replace(/defineProps\s*<[^>]+>\s*\(\s*\)/g, '__props')
    .replace(/defineProps\s*\([^)]*\)/g, '__props')
    .replace(/defineEmits\s*<[^>]+>\s*\(\s*\)/g, '__emit')
    .replace(/defineEmits\s*\([^)]*\)/g, '__emit')
}

function removeRanges(source: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return source
  let cursor = 0
  let output = ''
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    output += source.slice(cursor, start)
    cursor = end
  }
  output += source.slice(cursor)
  return output
}

function parseTemplate(source: string, diagnostics: Array<NovaUiStyleDiagnostic>): Array<TemplateNode> {
  const root = baseParse(source)
  return root.children.flatMap(child => convertTemplateChild(child, diagnostics)).filter(Boolean)
}

function convertTemplateChild(
  child: TemplateChildNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): Array<TemplateNode> {
  if (child.type === NodeTypes.TEXT) {
    if (child.content.trim()) {
      diagnostics.push({
        severity: 'error',
        code: 'unsupported-text-node',
        message: 'Текстовые nodes в Nova template не поддерживаются. Используйте <TextBlock>.',
      })
    }
    return []
  }
  if (child.type !== NodeTypes.ELEMENT) return []

  const element = child as ElementNode
  if (element.tagType === ElementTypes.TEMPLATE) {
    diagnostics.push({
      severity: 'error',
      code: 'orphan-slot-template',
      message: '<template #name> должен быть дочерним элементом компонента.',
    })
    return []
  }

  if (element.tagType === ElementTypes.SLOT) {
    return [{
      tag: 'slot',
      attrs: collectElementAttrs(element, diagnostics),
      children: convertElementChildren(element, diagnostics).children,
      slots: {},
    }]
  }

  const nested = convertElementChildren(element, diagnostics)

  return [{
    tag: element.tag,
    attrs: collectElementAttrs(element, diagnostics),
    children: nested.children,
    slots: nested.slots,
  }]
}

function convertElementChildren(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  const children: Array<TemplateNode> = []
  const slots: Record<string, TemplateSlotNode> = {}

  for (const child of element.children) {
    if (child.type === NodeTypes.ELEMENT && child.tagType === ElementTypes.TEMPLATE) {
      const slot = convertSlotTemplate(child as ElementNode, diagnostics)
      if (slot) {
        if (slots[slot.name]) {
          diagnostics.push({
            severity: 'error',
            code: 'duplicate-slot',
            message: `Slot "${slot.name}" уже объявлен.`,
          })
        } else {
          slots[slot.name] = slot
        }
        continue
      }
    }

    children.push(...convertTemplateChild(child, diagnostics))
  }

  return { children, slots }
}

function convertSlotTemplate(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): TemplateSlotNode | null {
  const slotDirective = element.props.find((prop): prop is DirectiveNode => (
    prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot'
  ))

  if (!slotDirective) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported-template-node',
      message: 'Nova template поддерживает <template> только как named slot: <template #name>.',
    })
    return null
  }

  const arg = slotDirective.arg
  if (arg && (arg.type !== NodeTypes.SIMPLE_EXPRESSION || (arg as any).isStatic === false)) {
    diagnostics.push({
      severity: 'error',
      code: 'dynamic-slot-name',
      message: 'Dynamic slot names не поддерживаются. Используйте статический #name.',
    })
    return null
  }

  const name = arg && arg.type === NodeTypes.SIMPLE_EXPRESSION && arg.content
    ? arg.content
    : 'default'
  const scope = slotDirective.exp && slotDirective.exp.type === NodeTypes.SIMPLE_EXPRESSION
    ? slotDirective.exp.content.trim()
    : undefined
  const nested = convertElementChildren(element, diagnostics)

  return {
    name,
    scope,
    children: nested.children,
  }
}

function collectElementAttrs(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): Record<string, string | true> {
  const attrs: Record<string, string | true> = {}
  for (const prop of element.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const attr = prop as AttributeNode
      attrs[attr.name] = attr.value?.content ?? true
      continue
    }

    const directive = prop as DirectiveNode
    const arg = directive.arg && directive.arg.type === NodeTypes.SIMPLE_EXPRESSION
      ? directive.arg.content
      : ''
    const exp = directive.exp && directive.exp.type === NodeTypes.SIMPLE_EXPRESSION
      ? directive.exp.content
      : ''

    if (directive.name === 'bind') {
      if (!arg) {
        diagnostics.push({
          severity: 'error',
          code: 'unsupported-v-bind',
          message: `v-bind object на <${element.tag}> пока не поддерживается.`,
        })
        continue
      }
      attrs[`:${arg}`] = exp || 'undefined'
      continue
    }

    if (directive.name === 'on') {
      if (!arg) {
        diagnostics.push({
          severity: 'error',
          code: 'unsupported-v-on',
          message: `v-on object на <${element.tag}> пока не поддерживается.`,
        })
        continue
      }
      attrs[`@${arg}`] = exp || true
      continue
    }

    if (['if', 'else-if', 'else', 'for'].includes(directive.name)) {
      attrs[`v-${directive.name}`] = exp || true
      continue
    }

    diagnostics.push({
      severity: 'error',
      code: 'unsupported-directive',
      message: `Директива v-${directive.name} на <${element.tag}> пока не поддерживается.`,
    })
  }
  return attrs
}

function validateTemplateNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  options: { importedRuntimeSymbols: Set<string>; hasScopedStyles: boolean },
): void {
  if (options.hasScopedStyles && (nodes.length !== 1 || nodes[0]?.tag !== 'Root')) {
    diagnostics.push({
      severity: 'error',
      code: 'scoped-style-root-required',
      message: '<style scoped> требует единственный top-level <Root>, потому что style engine живет на Root.',
    })
  }

  validateTemplateNodeList(nodes, diagnostics, options)
}

function validateTemplateNodeList(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  options: { importedRuntimeSymbols: Set<string> },
): void {
  let previousAcceptsElse = false

  for (const node of nodes) {
    const isComponentInclude = node.tag === 'Component'
    const isImportedComponent = options.importedRuntimeSymbols.has(node.tag)
    const staticSrc = readAttr(node, 'src')
    const isSlotOutlet = node.tag === 'slot'

    if (!isSlotOutlet
      && !UI_KIT_TAGS.has(node.tag)
      && !PRIMITIVE_TAGS.has(node.tag)
      && !node.tag.includes('.')
      && !isComponentInclude
      && !isImportedComponent
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-tag',
        message: `Неизвестный Nova tag "${node.tag}".`,
      })
    }

    if (readAttr(node, 'v-for') && !readAttr(node, ':key') && !readAttr(node, 'key')) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-key',
        message: `v-for на <${node.tag}> должен содержать обязательный :key.`,
      })
    }

    if (isComponentInclude) {
      if (readAttr(node, ':src')) {
        diagnostics.push({
          severity: 'error',
          code: 'dynamic-component-src',
          message: '<Component> поддерживает только статический src. Динамический :src входит в async/lazy loading и не поддерживается в v1.',
        })
      }
      if (!staticSrc) {
        diagnostics.push({
          severity: 'error',
          code: 'component-src-required',
          message: '<Component> требует статический src.',
        })
      }
    }

    if (isSlotOutlet && readAttr(node, ':name')) {
      diagnostics.push({
        severity: 'error',
        code: 'dynamic-slot-name',
        message: '<slot :name> не поддерживается. Используйте статический name.',
      })
    }

    const isElseBranch = !!readAttr(node, 'v-else-if') || Object.prototype.hasOwnProperty.call(node.attrs, 'v-else')
    if (isElseBranch && !previousAcceptsElse) {
      diagnostics.push({
        severity: 'error',
        code: 'orphan-else',
        message: `v-else/v-else-if на <${node.tag}> должен идти после v-if.`,
      })
    }

    validateTemplateNodeList(node.children, diagnostics, options)
    for (const slot of Object.values(node.slots)) {
      validateTemplateNodeList(slot.children, diagnostics, options)
    }
    previousAcceptsElse = !!readAttr(node, 'v-if') || !!readAttr(node, 'v-else-if')
  }
}

function generateNodeSequence(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const chunks: Array<string> = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (readAttr(node, 'v-else-if') || Object.prototype.hasOwnProperty.call(node.attrs, 'v-else')) continue

    const condition = readAttr(node, 'v-if')
    if (!condition) {
      chunks.push(generateNodeList(node, context, index === 0))
      continue
    }

    let branch = `(${condition}) ? ${generateNodeArray(node, context, index === 0)}`
    let fallback = '[]'
    let cursor = index + 1
    while (cursor < nodes.length) {
      const next = nodes[cursor]
      const elseIf = readAttr(next, 'v-else-if')
      const hasElse = Object.prototype.hasOwnProperty.call(next.attrs, 'v-else')
      if (!elseIf && !hasElse) break

      if (elseIf) {
        branch += ` : (${elseIf}) ? ${generateNodeArray(next, context, cursor === 0)}`
      } else {
        fallback = generateNodeArray(next, context, cursor === 0)
        cursor += 1
        break
      }
      cursor += 1
    }

    chunks.push(`${branch} : ${fallback}`)
    index = cursor - 1
  }

  return `[${chunks.join(',')}].flat().filter(Boolean)`
}

function generateNodeList(node: TemplateNode, context: GenerateContext, isTopLevelRoot: boolean): string {
  const forSource = readAttr(node, 'v-for')
  if (forSource) {
    const parsed = parseForExpression(forSource)
    if (parsed) {
      const schema = generateSchema(node, true, context, isTopLevelRoot)
      return `(${parsed.source} ?? []).flatMap((${parsed.item}, ${parsed.index}) => [${schema}])`
    }
  }

  return generateSchema(node, false, context, isTopLevelRoot)
}

function generateNodeArray(node: TemplateNode, context: GenerateContext, isTopLevelRoot: boolean): string {
  const list = generateNodeList(node, context, isTopLevelRoot)
  return list.startsWith('(') || list.startsWith('this.renderSlot(')
    ? list
    : `[${list}]`
}

function generateSchema(
  node: TemplateNode,
  fromFor: boolean,
  context: GenerateContext,
  isTopLevelRoot: boolean,
): string {
  if (node.tag === 'slot') return generateSlotOutlet(node, context)

  const type = resolveNodeTypeExpression(node, context)
  const isCompiledComponent = node.tag === 'Component' || context.importedRuntimeSymbols.has(node.tag)
  const props = generateProps(node, context, isCompiledComponent, isTopLevelRoot)
  const events = generateEvents(node, isCompiledComponent)
  const children = node.children.length > 0 && !isCompiledComponent
    ? generateNodeSequence(node.children, context)
    : ''
  const slots = generateSlots(node, context, isCompiledComponent)
  const key = readAttr(node, ':key') ?? readAttr(node, 'key') ?? (fromFor ? 'index' : undefined)
  const refName = readAttr(node, 'ref')
  const dynamicRefKey = readAttr(node, ':ref-key') ?? readAttr(node, ':refKey')
  const staticRefKey = readAttr(node, 'ref-key') ?? readAttr(node, 'refKey')
  const contextSource = readAttr(node, ':context')
  const layout = readAttr(node, ':layout') ?? readAttr(node, 'layout')
  const id = readAttr(node, ':id')
    ? `id:${readAttr(node, ':id')}`
    : readAttr(node, 'id')
      ? `id:${JSON.stringify(readAttr(node, 'id'))}`
      : ''
  const fields = [
    `type:${type}`,
    id,
    key ? `key:${key}` : '',
    refName ? `ref:${JSON.stringify(refName)}` : '',
    dynamicRefKey ? `refKey:${dynamicRefKey}` : staticRefKey ? `refKey:${JSON.stringify(staticRefKey)}` : '',
    contextSource ? `context:${contextSource}` : '',
    layout ? `layout:${layout}` : '',
    props ? `props:${props}` : '',
    events ? `events:${events}` : '',
    children ? `children:${children}` : '',
    slots ? `slots:${slots}` : '',
  ].filter(Boolean)
  return `{${fields.join(',')}}`
}

function generateSlots(
  node: TemplateNode,
  context: GenerateContext,
  isCompiledComponent: boolean,
): string {
  const entries: Array<[string, TemplateSlotNode]> = Object.entries(node.slots)
  if (isCompiledComponent && node.children.length > 0 && !node.slots.default) {
    entries.push(['default', {
      name: 'default',
      children: node.children,
    }])
  }
  if (entries.length === 0) return ''

  const slots = entries.map(([name, slot]) => {
    const scopeDeclaration = slot.scope
      ? `const ${slot.scope} = __slotProps;`
      : ''
    return `${quoteKey(name)}:(__slotProps = {}) => {
${indent(scopeDeclaration, 6)}
      return ${generateNodeSequence(slot.children, context)};
    }`
  })

  return `{${slots.join(',')}}`
}

function generateSlotOutlet(node: TemplateNode, context: GenerateContext): string {
  const name = readAttr(node, 'name') ?? 'default'
  const fallback = node.children.length > 0 ? generateNodeSequence(node.children, context) : '[]'
  const scope = generateSlotOutletScope(node)
  return `this.renderSlot(${JSON.stringify(name)}, ${scope}, ${fallback})`
}

function generateSlotOutletScope(node: TemplateNode): string {
  const entries: Array<string> = []
  for (const [name, value] of Object.entries(node.attrs)) {
    if (
      name === 'name'
      || name === ':name'
      || name === 'key'
      || name === ':key'
      || name.startsWith('v-')
      || name.startsWith('@')
    ) continue

    if (name.startsWith(':')) {
      entries.push(`${quoteKey(name.slice(1))}:${value}`)
      continue
    }
    entries.push(`${quoteKey(name)}:${serializeStaticAttr(value)}`)
  }

  return entries.length > 0 ? `{${entries.join(',')}}` : '{}'
}

function resolveNodeTypeExpression(node: TemplateNode, context: GenerateContext): string {
  if (node.tag === 'Component') {
    const src = readAttr(node, 'src')
    if (!src) return 'undefined'
    return resolveComponentImport(src, context)
  }

  if (context.importedRuntimeSymbols.has(node.tag)) return node.tag
  if (UI_KIT_TAGS.has(node.tag)) return `__NovaUIKit.${node.tag}`
  return JSON.stringify(node.tag)
}

function resolveComponentImport(src: string, context: GenerateContext): string {
  const existing = context.componentImports.get(src)
  if (existing) return existing

  const name = `__NovaComponent${context.componentImports.size}`
  context.componentImports.set(src, name)
  context.generatedImports.push(`import ${name} from ${JSON.stringify(src)};`)
  return name
}

function generateProps(
  node: TemplateNode,
  context: GenerateContext,
  isCompiledComponent: boolean,
  isTopLevelRoot: boolean,
): string {
  const props: Array<string> = []
  const staticClass = readAttr(node, 'class')
  const dynamicClass = readAttr(node, ':class')
  const attrs = readAttr(node, ':attrs') ?? readAttr(node, 'attrs')
  const hasExplicitStyleSheet = readAttr(node, ':styleSheet') || readAttr(node, 'styleSheet')

  if (staticClass || dynamicClass) {
    props.push(`className:[${staticClass ? JSON.stringify(staticClass) : 'null'}, ${dynamicClass ?? 'null'}].filter(Boolean).join(' ')`)
  }
  if (attrs && context.hasScopedStyles) props.push(`attrs:{...(${attrs}), __novaScope: __novaSfcStyle.scopeId}`)
  else if (attrs) props.push(`attrs:${attrs}`)
  else if (context.hasScopedStyles && !isCompiledComponent) props.push('attrs:{__novaScope: __novaSfcStyle.scopeId}')
  if (context.hasScopedStyles && isTopLevelRoot && node.tag === 'Root' && !hasExplicitStyleSheet) {
    props.push('styleSheet:__novaSfcStyle')
  }

  for (const [name, value] of Object.entries(node.attrs)) {
    if (
      name === 'id'
      || name === ':id'
      || name === 'ref'
      || name === 'ref-key'
      || name === ':ref-key'
      || name === 'refKey'
      || name === ':refKey'
      || name === 'key'
      || name === ':key'
      || name === 'class'
      || name === ':class'
      || name === 'attrs'
      || name === ':attrs'
      || name === ':context'
      || name === 'layout'
      || name === ':layout'
      || name === 'src'
      || name === ':src'
      || name.startsWith('v-')
      || name.startsWith('@')
    ) continue

    if (name.startsWith(':')) {
      props.push(`${quoteKey(name.slice(1))}:${value}`)
      continue
    }

    props.push(`${quoteKey(name)}:${serializeStaticAttr(value)}`)
  }

  if (!isCompiledComponent) {
    for (const [name, value] of Object.entries(node.attrs)) {
      if (!name.startsWith('@')) continue
      const eventName = name.slice(1)
      if (eventName === 'press') props.push(`onPress:${generateHandler(value)}`)
      if (eventName === 'change') props.push(`onChange:${generateHandler(value)}`)
    }
  }

  return props.length > 0 ? `{${props.join(',')}}` : ''
}

function generateEvents(node: TemplateNode, isCompiledComponent: boolean): string {
  const events: Array<string> = []
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!name.startsWith('@')) continue
    const eventName = name.slice(1)
    if (!isCompiledComponent && (eventName === 'press' || eventName === 'change')) continue
    events.push(`${quoteKey(eventName)}:${generateHandler(value)}`)
  }
  return events.length > 0 ? `{${events.join(',')}}` : ''
}

function generateHandler(value: string | true): string {
  if (value === true) return 'undefined'
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) return value
  return `(...args) => (${value})`
}

function readAttr(node: TemplateNode, name: string): string | undefined {
  const value = node.attrs[name]
  return typeof value === 'string' ? value : undefined
}

function parseForExpression(source: string): { item: string; index: string; source: string } | null {
  const match = source.match(/^\s*(?:\(([^,\s]+)\s*,\s*([^)]+)\)|([^\s]+))\s+in\s+(.+)\s*$/)
  if (!match) return null
  return {
    item: match[1] ?? match[3],
    index: match[2] ?? 'index',
    source: match[4],
  }
}

function serializeStaticAttr(value: string | true): string {
  if (value === true) return 'true'
  if (value === 'true' || value === 'false') return value
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value
  return JSON.stringify(value)
}

function quoteKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

function generateModule(options: {
  className: string
  setup: ScriptSetupCompileResult
  templateCode: string
  scopeId: string
  scopedStyleAssetCode: string
  globalStyleAssetCode: string
  hasScopedStyles: boolean
  hasGlobalStyles: boolean
  generatedImports: Array<string>
}): string {
  const setupNames = new Set(options.setup.names)
  const topLevelNames = options.setup.topLevelNames
  const implicitTemplateLocals = [
    ['props', 'this.props'],
    ['emit', 'this.emit.bind(this)'],
    ['width', 'this.width'],
    ['height', 'this.height'],
    ['styleSheet', '__novaSfcStyle'],
  ] as const
  const runtimeHelpers = [
    topLevelNames.has('ref') ? '' : 'const ref = value => ({ value });',
    topLevelNames.has('computed') ? '' : 'const computed = fn => ({ get value() { return fn(); } });',
    topLevelNames.has('watch') ? '' : 'const watch = () => () => {};',
  ].filter(Boolean).join('\n')
  const templateLocalDeclarations = [
    ...implicitTemplateLocals
      .filter(([name]) => !setupNames.has(name))
      .map(([name, value]) => `const ${name} = ${value};`),
    ...options.setup.names.map(name => `const ${name} = this.setupState.${name};`),
  ].join('\n')
  const setupReturn = options.setup.names.length > 0
    ? `return { ${options.setup.names.join(', ')} };`
    : 'return {};'
  const globalStylesExpression = options.hasGlobalStyles ? '[__novaSfcGlobalStyle]' : '[]'

  return `import { NovaNode, NovaTemplateRuntime } from '@endge/nova';
import { NovaUIKit as __NovaUIKit, registerNovaUiGlobalStyleSheet } from '@endge/nova-ui-kit';
${options.setup.imports.join('\n')}
${options.generatedImports.join('\n')}

const __novaSfcStyle = ${options.scopedStyleAssetCode};
const __novaSfcGlobalStyle = ${options.globalStyleAssetCode};
const __novaSfcGlobalStyles = ${globalStylesExpression};
${runtimeHelpers}
export const novaScopeId = ${JSON.stringify(options.scopeId)};
export const novaStyleSheet = __novaSfcStyle;
export const novaGlobalStyleSheets = __novaSfcGlobalStyles;

export default class ${options.className} extends NovaNode {
  constructor(app, surface, props = {}, listeners = {}, slots = {}) {
    super(app, surface);
    this.props = props;
    this.listeners = listeners;
    this.slots = slots;
    this.__novaGlobalStyleDisposers = [];
    this.installGlobalStyles();
    this.templateRuntime = new NovaTemplateRuntime(this, { refs: props.novaRefs ?? {} });
    this.setupState = this.setup();
    this.options({
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width ?? app.width,
      height: props.height ?? app.height,
    });
  }

  installGlobalStyles() {
    for (const style of __novaSfcGlobalStyles) {
      if (style.source.trim()) {
        this.__novaGlobalStyleDisposers.push(registerNovaUiGlobalStyleSheet(this.nova, style));
      }
    }
  }

  setup() {
    const __props = this.props;
    const __emit = this.emit.bind(this);
    const provide = (token, value) => this.provide(token, value);
    const inject = (token) => this.inject(token);
    const injectOptional = (token, fallback) => this.injectOptional(token, fallback);
${indent(options.setup.body, 4)}
    ${setupReturn}
  }

  emit(name, ...args) {
    this.listeners?.[name]?.(...args);
  }

  setProps(patch) {
    Object.assign(this.props, patch);
    this.templateRuntime.setScope({ refs: this.props.novaRefs ?? {} });
    if ('x' in patch || 'y' in patch || 'width' in patch || 'height' in patch) {
      this.options({
        x: this.props.x ?? this.x,
        y: this.props.y ?? this.y,
        width: this.props.width ?? this.width,
        height: this.props.height ?? this.height,
      });
    }
    this.dirty({ update: true, render: true });
    return this;
  }

  setListeners(listeners = {}) {
    this.listeners = listeners;
    return this;
  }

  setSlots(slots = {}) {
    this.slots = slots;
    this.dirty({ update: true, render: true });
    return this;
  }

  renderSlot(name = 'default', scope = {}, fallback = []) {
    const slot = this.slots?.[name];
    return typeof slot === 'function' ? slot(scope) : fallback;
  }

  update() {
    this.templateRuntime.reconcile(this.createTemplate());
  }

  render() {}

  getTemplateStats() {
    return this.templateRuntime.getStats();
  }

  createTemplate() {
${indent(templateLocalDeclarations, 4)}
    return ${options.templateCode};
  }

  dispose() {
    this.templateRuntime.dispose();
    for (const dispose of this.__novaGlobalStyleDisposers.splice(0)) dispose();
    super.dispose();
  }
}
`
}

function indent(source: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return source.split('\n').map(line => line ? `${prefix}${line}` : line).join('\n')
}

function createScopeId(input: string): string {
  return `nova-${createHash('sha1').update(input).digest('hex').slice(0, 8)}`
}

function createClassName(filename?: string): string {
  const base = filename?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'NovaSfcComponent'
  const safeBase = base.replace(/[^A-Za-z0-9_$]+/g, ' ')
  const normalized = safeBase.replace(/(^|[-_\s]+)([a-zA-Z0-9_$])/g, (_match, _prefix, char: string) => char.toUpperCase())
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `Nova${normalized}`
}

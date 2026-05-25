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
import { compileNovaCss, serializeStyleAsset, type NovaCssCompileOptions } from '../css/nova-css-compiler'

export interface NovaSfcCompileOptions extends NovaCssCompileOptions {
  filename?: string
  className?: string
}

export interface NovaSfcCompileResult {
  code: string
  diagnostics: Array<NovaUiStyleDiagnostic>
  scopeId: string
  dependencies: Array<string>
  metadata: NovaSfcSourceMetadata
}

export interface NovaSourceRange {
  start: number
  end: number
}

export type NovaDefinitionTargetKind = 'ui-kit' | 'component-src' | 'import' | 'namespaced' | 'unknown'

export interface NovaDefinitionTarget {
  kind: NovaDefinitionTargetKind
  name: string
  source?: string
  symbol?: string
}

export interface NovaTemplateNodeMetadata {
  tag: string
  range: NovaSourceRange
  tagRange: NovaSourceRange
  attrs: Record<string, string | true>
  attrRanges: Record<string, NovaSourceRange>
  target: NovaDefinitionTarget
}

export interface NovaSfcSourceMetadata {
  filename?: string
  nodes: Array<NovaTemplateNodeMetadata>
}

interface TemplateNode {
  tag: string
  filename?: string
  attrs: Record<string, string | true>
  attrRanges: Record<string, NovaSourceRange>
  range: NovaSourceRange
  tagRange: NovaSourceRange
  children: Array<TemplateNode>
  slots: Record<string, TemplateSlotNode>
}

interface TemplateSlotNode {
  name: string
  scope?: string
  children: Array<TemplateNode>
}

interface TemplateParseOptions {
  filename?: string
  resolveImport?: NovaCssCompileOptions['resolveImport']
  dependencies?: Set<string>
  includeStack?: Array<string>
  schemaComponents?: Map<string, ScriptSetupImportBinding>
  schemaComponentLocals?: Set<string>
}

interface ScriptSetupCompileResult {
  imports: Array<string>
  body: string
  names: Array<string>
  importedRuntimeSymbols: Set<string>
  topLevelNames: Set<string>
  importBindings: Map<string, ScriptSetupImportBinding>
  assetImports: Array<NovaAssetImportBinding>
}

interface ScriptSetupImportBinding {
  local: string
  imported: string
  source: string
}

interface NovaAssetImportBinding {
  local: string
  source: string
  kind: NovaAutoAssetKind
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
  assets: NovaAutoAssetRegistry
  filename?: string
  resolveImport?: NovaCssCompileOptions['resolveImport']
  dependencies?: Set<string>
}

type NovaAutoAssetKind = 'icon' | 'image' | 'fill' | 'font'

interface NovaAutoAssetRecord {
  key: string
  name: string
  kind: NovaAutoAssetKind
  request?: string
  importName?: string
  descriptor: string
}

interface NovaAutoAssetRegistry {
  records: Map<string, NovaAutoAssetRecord>
  refsByKey: Map<string, string>
  importRefs: Map<string, string>
  patternRefs: Map<string, string>
  localRefs: Map<string, { kind: NovaAutoAssetKind; ref: string }>
  localKeys: Map<string, string>
  importBindings: Array<{ local: string; ref: string }>
  bundleRefsByKey: Map<string, string>
  bundleExpressions: Array<string>
}

const UI_KIT_TAGS = new Set([
  'Root',
  'Flex',
  'Grid',
  'TextBlock',
  'Surface',
  'Button',
  'Badge',
  'Input',
  'TextInput',
  'PasswordInput',
  'SearchInput',
  'NumberInput',
  'TextArea',
  'InputField',
  'SelectInput',
  'Tag',
  'Image',
  'SplitPane',
  'ScrollArea',
  'Scrollbar',
  'Slider',
  'Checkbox',
  'Toggle',
  'Tooltip',
  'Tooltips',
  'Dialogs',
  'SegmentedControl',
  'Panel',
  'SpeedDial',
  'Dock',
  'Carousel',
  'Galleria',
  'ImagePreview',
  'ImageCompare',
  'Skeleton',
  'ProgressBar',
  'ProgressSpinner',
  'MeterGroup',
  'Knob',
  'ToggleSwitch',
  'RadioButton',
  'Rating',
  'SelectButton',
  'Dialog',
  'Drawer',
  'Popover',
  'ActionList',
  'Toast',
  'Message',
  'BlockUI',
  'Accordion',
  'Fieldset',
  'Tabs',
  'Stepper',
])
const ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.woff', '.woff2', '.ttf', '.otf'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const ASSET_PATH_PROPS = new Set(['src', 'source', 'icon', 'background'])
const ASSET_OPTION_PROPS = new Set(['asset-color', 'assetColor'])
const ASSETS_CONTAINER_TAG = 'Nova.Assets'
const LEGACY_ASSET_DECLARATION_TAGS = new Set(['StripePattern'])
const NOVA_ASSET_DECLARATION_TAGS = new Set([
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
])

function createNovaAutoAssetRegistry(): NovaAutoAssetRegistry {
  return {
    records: new Map(),
    refsByKey: new Map(),
    importRefs: new Map(),
    patternRefs: new Map(),
    localRefs: new Map(),
    localKeys: new Map(),
    importBindings: [],
    bundleRefsByKey: new Map(),
    bundleExpressions: [],
  }
}

function resolveAssetKind(request: string): NovaAutoAssetKind | null {
  const extension = assetExtension(request)
  if (!extension) return null
  if (extension === '.svg') return 'icon'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  return null
}

function assetExtension(request: string): string | null {
  const clean = request.split('?')[0]?.toLowerCase() ?? ''
  const match = clean.match(/\.[a-z0-9]+$/)
  return match?.[0] ?? null
}

function isAssetPath(value: string): boolean {
  const extension = assetExtension(value)
  return Boolean(extension && ASSET_EXTENSIONS.has(extension))
}

function isAssetsContainerTag(tag: string): boolean {
  return tag === ASSETS_CONTAINER_TAG
}

function isAssetDeclarationTag(tag: string): boolean {
  return LEGACY_ASSET_DECLARATION_TAGS.has(tag) || NOVA_ASSET_DECLARATION_TAGS.has(tag)
}

function normalizeAssetDeclarationTag(tag: string): string {
  return tag.startsWith('Nova.') ? tag.slice('Nova.'.length) : tag
}

function safeAssetName(input: string): string {
  const base = input.split('?')[0]?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'asset'
  return base.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^([^A-Za-z_$])/, '_$1') || 'asset'
}

const UI_KIT_SEMANTIC_EVENT_PROPS = new Map([
  ['press', 'onPress'],
  ['change', 'onChange'],
  ['value-change', 'onValueChange'],
  ['input', 'onInput'],
  ['open-change', 'onOpenChange'],
  ['show', 'onShow'],
  ['hide', 'onHide'],
  ['scroll', 'onScroll'],
  ['scroll-start', 'onScrollStart'],
  ['scroll-end', 'onScrollEnd'],
  ['thumb-click', 'onThumbClick'],
  ['track-click', 'onTrackClick'],
  ['scrollbar-click', 'onScrollbarClick'],
  ['resize-start', 'onResizeStart'],
  ['resize', 'onResize'],
  ['resize-end', 'onResizeEnd'],
  ['drag-start', 'onDragStart'],
  ['drag-end', 'onDragEnd'],
  ['step-change', 'onStepChange'],
  ['remove', 'onRemove'],
])

const PRIMITIVE_TAGS = new Set(['rect', 'border', 'line', 'circle', 'polygon', 'text', 'icon'])
const TIMELINE_PROFILE_MARKER_TAGS = new Set([
  'TimelineTaskProfile',
  'TimelineChart.BackgroundProfile',
  'TimelineChart.PointProfile',
  'TimelineChart.LinkProfile',
])
const TIMELINE_PROFILE_PRIMITIVE_TAGS = new Set(['Rect', 'Icon', 'Text', 'TextBlock'])
const TIMELINE_GROUP_MARKER_TAGS = new Set(['TimelineChart.GroupColumn'])
const TIMELINE_MARKER_DSL_TAGS = new Set(['TimelineChart.Markers', 'TimelineChart.Marker'])
const TIMELINE_GRID_TEMPLATE_TAG = 'TimelineChart.GridTemplate'
const TIMELINE_MARQUEE_SELECTION_TAG = 'TimelineChart.MarqueeSelection'
const TIMELINE_GROUP_SCHEMA_TAGS = new Set(['Rect', 'Line', 'Circle', 'Icon', 'Text', 'TextBlock', 'ProgressRing'])
const CORE_DSL_TAGS: Record<string, string> = {
  Scenes: 'nova.scenes',
  Scene: 'nova.scene',
}

export const NOVA_UI_KIT_DEFINITION_TARGETS: Record<string, string> = {
  Root: 'packages/@endge-nova-ui-kit/src/components/Root/Root.ts',
  Flex: 'packages/@endge-nova-ui-kit/src/components/Flex/Flex.ts',
  Grid: 'packages/@endge-nova-ui-kit/src/components/Grid/Grid.ts',
  TextBlock: 'packages/@endge-nova-ui-kit/src/components/TextBlock/TextBlock.ts',
  Surface: 'packages/@endge-nova-ui-kit/src/components/Surface/Surface.ts',
  Button: 'packages/@endge-nova-ui-kit/src/components/Button/Button.ts',
  Badge: 'packages/@endge-nova-ui-kit/src/components/Badge/Badge.ts',
  Input: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  TextInput: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  PasswordInput: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  SearchInput: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  NumberInput: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  TextArea: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  InputField: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  SelectInput: 'packages/@endge-nova-ui-kit/src/components/Input/Input.ts',
  Image: 'packages/@endge-nova-ui-kit/src/components/Image/Image.ts',
  Tag: 'packages/@endge-nova-ui-kit/src/components/Tag/Tag.ts',
  SplitPane: 'packages/@endge-nova-ui-kit/src/components/SplitPane/SplitPane.ts',
  ScrollArea: 'packages/@endge-nova-ui-kit/src/components/ScrollArea/ScrollArea.ts',
  Scrollbar: 'packages/@endge-nova-ui-kit/src/components/Scrollbar/Scrollbar.ts',
  Slider: 'packages/@endge-nova-ui-kit/src/components/Slider/Slider.ts',
  Checkbox: 'packages/@endge-nova-ui-kit/src/components/Checkbox/Checkbox.ts',
  Toggle: 'packages/@endge-nova-ui-kit/src/components/Toggle/Toggle.ts',
  Tooltip: 'packages/@endge-nova-ui-kit/src/components/Tooltip/Tooltip.ts',
  Tooltips: 'packages/@endge-nova-ui-kit/src/components/Tooltip/Tooltips.ts',
  Dialogs: 'packages/@endge-nova-ui-kit/src/components/Dialog/Dialogs.ts',
  SegmentedControl: 'packages/@endge-nova-ui-kit/src/components/SegmentedControl/SegmentedControl.ts',
  Panel: 'packages/@endge-nova-ui-kit/src/components/Panel/Panel.ts',
}

export interface TimelineTaskProfilesCompileResult {
  code: string
  diagnostics: Array<NovaUiStyleDiagnostic>
  dependencies: Array<string>
}

export interface TimelineGroupColumnTemplatesCompileResult {
  code: string
  diagnostics: Array<NovaUiStyleDiagnostic>
  dependencies: Array<string>
}

/**
 * Компилирует декларативные TimelineTaskProfile nodes в plain TimelineTaskProfilesOptions fragment.
 */
export function compileTimelineTaskProfilesSource(
  source: string,
  options: Pick<NovaSfcCompileOptions, 'filename' | 'resolveImport'> = {},
): TimelineTaskProfilesCompileResult {
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const dependencies = new Set<string>()
  const nodes = parseTemplate(source, diagnostics, 0, {
    filename: options.filename,
    resolveImport: options.resolveImport,
    dependencies,
  })
  validateTimelineTaskProfileNodes(nodes, diagnostics)

  const context: GenerateContext = {
    diagnostics,
    importedRuntimeSymbols: new Set(),
    generatedImports: [],
    componentImports: new Map(),
    hasScopedStyles: false,
    assets: createNovaAutoAssetRegistry(),
    filename: options.filename,
    resolveImport: options.resolveImport,
    dependencies,
  }

  return {
    code: generateTimelineTaskProfiles(nodes, context),
    diagnostics,
    dependencies: [...dependencies],
  }
}

/**
 * Компилирует декларативные TimelineChart.GroupColumn nodes в schema factories.
 */
export function compileTimelineGroupColumnTemplatesSource(
  source: string,
  options: Pick<NovaSfcCompileOptions, 'filename' | 'resolveImport'> = {},
): TimelineGroupColumnTemplatesCompileResult {
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const dependencies = new Set<string>()
  const nodes = parseTemplate(source, diagnostics, 0, {
    filename: options.filename,
    resolveImport: options.resolveImport,
    dependencies,
  })
  const columns = collectTimelineGroupColumnNodes(nodes)
  validateTimelineGroupColumnNodes(columns, diagnostics)

  const context: GenerateContext = {
    diagnostics,
    importedRuntimeSymbols: new Set(),
    generatedImports: [],
    componentImports: new Map(),
    hasScopedStyles: false,
    assets: createNovaAutoAssetRegistry(),
    filename: options.filename,
    resolveImport: options.resolveImport,
    dependencies,
  }

  return {
    code: generateTimelineGroupColumnTemplates(columns, context),
    diagnostics,
    dependencies: [...dependencies],
  }
}

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

  const templateOffset = sfc.descriptor.template?.loc.start.offset ?? 0
  const dependencies = new Set<string>()
  const schemaComponentLocals = new Set<string>()
  const templateNodes = sfc.descriptor.template
    ? parseTemplate(sfc.descriptor.template.content, diagnostics, templateOffset, {
        filename,
        resolveImport: options.resolveImport,
        dependencies,
        schemaComponents: setup.importBindings,
        schemaComponentLocals,
      })
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
    assets: createNovaAutoAssetRegistry(),
    filename,
    resolveImport: options.resolveImport,
    dependencies,
  }
  registerScriptAssetImports(setup.assetImports, context)
  registerAssetDeclarations(templateNodes, context)
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
      autoAssetBundleCode: generateAutoAssetBundleCode(context.assets),
      assetBundleExpressions: context.assets.bundleExpressions,
      schemaComponentLocals,
    }),
    diagnostics,
    scopeId,
    dependencies: [...new Set([...context.componentImports.keys(), ...dependencies])],
    metadata: {
      filename,
      nodes: createTemplateMetadata(templateNodes, setup),
    },
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
  const assetImports: Array<NovaAssetImportBinding> = []
  const importedRuntimeSymbols = new Set<string>()
  const topLevelNames = new Set<string>()
  const importBindings = new Map<string, ScriptSetupImportBinding>()

  if (source.trim()) {
    try {
      const ast = parseScript(source, {
        sourceType: 'module',
        plugins: ['typescript'],
      }) as any

      for (const statement of ast.program.body as Array<any>) {
        if (typeof statement.start === 'number' && typeof statement.end === 'number' && statement.type === 'ImportDeclaration') {
          importRanges.push([statement.start, statement.end])
          const importSource = String(statement.source.value)
          const assetKind = resolveAssetKind(importSource)
          if (statement.importKind !== 'type' && assetKind && statement.specifiers.length === 1 && statement.specifiers[0]?.type === 'ImportDefaultSpecifier') {
            assetImports.push({
              local: statement.specifiers[0].local.name,
              source: importSource,
              kind: assetKind,
            })
            topLevelNames.add(statement.specifiers[0].local.name)
            continue
          }
          if (statement.importKind !== 'type') imports.push(source.slice(statement.start, statement.end))
          if (statement.importKind !== 'type') {
            for (const specifier of statement.specifiers) {
              importedRuntimeSymbols.add(specifier.local.name)
              topLevelNames.add(specifier.local.name)
              importBindings.set(specifier.local.name, {
                local: specifier.local.name,
                imported: resolveImportedName(specifier),
                source: importSource,
              })
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
    importBindings,
    assetImports,
  }
}

function resolveImportedName(specifier: any): string {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default'
  if (specifier.type === 'ImportNamespaceSpecifier') return '*'
  const imported = specifier.imported
  return imported?.name ?? imported?.value ?? specifier.local?.name ?? 'default'
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

function parseTemplate(
  source: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset = 0,
  options: TemplateParseOptions = {},
): Array<TemplateNode> {
  const root = baseParse(source)
  return root.children.flatMap(child => convertTemplateChild(child, diagnostics, baseOffset, options)).filter(Boolean)
}

function parseTemplateFragment(
  source: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset = 0,
  options: TemplateParseOptions = {},
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  const root = baseParse(source)
  const children: Array<TemplateNode> = []
  const slots: Record<string, TemplateSlotNode> = {}

  for (const child of root.children) {
    if (child.type === NodeTypes.ELEMENT && isTemplateElement(child as ElementNode)) {
      const template = child as ElementNode
      if (hasTemplateInclude(template) && !isSlotTemplate(template)) {
        const fragment = resolveTemplateIncludeFragment(template, diagnostics, baseOffset, options)
        children.push(...fragment.children)
        for (const [name, slot] of Object.entries(fragment.slots)) slots[name] = slot
        continue
      }

      const slot = convertSlotTemplate(template, diagnostics, baseOffset, options)
      if (slot) {
        slots[slot.name] = slot
        continue
      }
    }

    children.push(...convertTemplateChild(child, diagnostics, baseOffset, options))
  }

  return { children, slots }
}

function convertTemplateChild(
  child: TemplateChildNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
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
  const dynamicSchemaDirective = readDynamicNovaSchemaDirective(element)
  if (dynamicSchemaDirective) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-dynamic',
      message: `${dynamicSchemaDirective} должен быть статической compile-time директивой.`,
    })
    return []
  }

  const schemaDirective = readStaticNovaSchemaDirective(element)
  if (schemaDirective) {
    return resolveNovaSchemaInclude(element, schemaDirective, diagnostics, options)
  }

  if (isTemplateElement(element)) {
    if (hasTemplateInclude(element)) {
      return resolveTemplateInclude(element, diagnostics, options)
    }

    if (isControlTemplateElement(element)) {
      return [convertControlTemplateElement(element, diagnostics, baseOffset, options)]
    }

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
      filename: options.filename,
      attrs: collectElementAttrs(element, diagnostics),
      attrRanges: collectElementAttrRanges(element, baseOffset),
      range: toSourceRange(element, baseOffset),
      tagRange: toTagSourceRange(element, baseOffset),
      children: convertElementChildren(element, diagnostics, baseOffset, options).children,
      slots: {},
    }]
  }

  const nested = convertElementChildren(element, diagnostics, baseOffset, options)

  return [{
    tag: element.tag,
    filename: options.filename,
    attrs: collectElementAttrs(element, diagnostics),
    attrRanges: collectElementAttrRanges(element, baseOffset),
    range: toSourceRange(element, baseOffset),
    tagRange: toTagSourceRange(element, baseOffset),
    children: nested.children,
    slots: nested.slots,
  }]
}

function convertElementChildren(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  const children: Array<TemplateNode> = []
  const slots: Record<string, TemplateSlotNode> = {}

  for (const child of element.children) {
    if (child.type === NodeTypes.ELEMENT && isTemplateElement(child as ElementNode)) {
      const template = child as ElementNode
      if (hasTemplateInclude(template) && !isSlotTemplate(template)) {
        const fragment = resolveTemplateIncludeFragment(template, diagnostics, baseOffset, options)
        children.push(...fragment.children)
        for (const [name, slot] of Object.entries(fragment.slots)) {
          if (slots[name]) {
            diagnostics.push({
              severity: 'error',
              code: 'duplicate-slot',
              message: `Slot "${name}" уже объявлен.`,
            })
          } else {
            slots[name] = slot
          }
        }
        continue
      }

      if (!isSlotTemplate(template) && isControlTemplateElement(template)) {
        children.push(convertControlTemplateElement(template, diagnostics, baseOffset, options))
        continue
      }

      const slot = convertSlotTemplate(template, diagnostics, baseOffset, options)
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

    if (child.type === NodeTypes.ELEMENT) {
      const schemaDirective = readStaticNovaSchemaDirective(child as ElementNode)
      if (schemaDirective) {
        const fragment = resolveNovaSchemaIncludeFragment(child as ElementNode, schemaDirective, diagnostics, baseOffset, options)
        children.push(...fragment.children)
        for (const [name, slot] of Object.entries(fragment.slots)) {
          if (slots[name]) {
            diagnostics.push({
              severity: 'error',
              code: 'duplicate-slot',
              message: `Slot "${name}" уже объявлен.`,
            })
          } else {
            slots[name] = slot
          }
        }
        continue
      }
    }

    children.push(...convertTemplateChild(child, diagnostics, baseOffset, options))
  }

  return { children, slots }
}

function isControlTemplateElement(element: ElementNode): boolean {
  return element.props.some(prop => {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      return isControlFlowAttr(prop.name)
    }

    const directive = prop as DirectiveNode
    const arg = directive.arg && directive.arg.type === NodeTypes.SIMPLE_EXPRESSION
      ? directive.arg.content
      : ''

    return directive.name === 'bind' && isControlFlowAttr(`:${arg}`)
  })
}

function convertControlTemplateElement(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
): TemplateNode {
  const nested = convertElementChildren(element, diagnostics, baseOffset, options)
  return {
    tag: 'template',
    filename: options.filename,
    attrs: collectElementAttrs(element, diagnostics),
    attrRanges: collectElementAttrRanges(element, baseOffset),
    range: toSourceRange(element, baseOffset),
    tagRange: toTagSourceRange(element, baseOffset),
    children: nested.children,
    slots: nested.slots,
  }
}

function convertSlotTemplate(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
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
  const nested = hasTemplateInclude(element)
    ? { children: resolveTemplateInclude(element, diagnostics, options), slots: {} }
    : convertElementChildren(element, diagnostics, baseOffset, options)

  return {
    name,
    scope,
    children: nested.children,
  }
}

function hasTemplateInclude(element: ElementNode): boolean {
  return element.props.some(prop => (
    (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'src')
    || (prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.content === 'src')
  ))
}

function isTemplateElement(element: ElementNode): boolean {
  return element.tag === 'template' || element.tagType === ElementTypes.TEMPLATE
}

function isSlotTemplate(element: ElementNode): boolean {
  return element.props.some(prop => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot')
}

const NOVA_SCHEMA_DIRECTIVES = new Set(['nova:schema', 'nova:inline'])

function isNovaSchemaDirectiveName(name: string): boolean {
  return NOVA_SCHEMA_DIRECTIVES.has(name)
}

function readStaticNovaSchemaDirective(element: ElementNode): string | null {
  const prop = element.props.find(prop => (
    prop.type === NodeTypes.ATTRIBUTE
    && isNovaSchemaDirectiveName(prop.name)
  ))
  return prop?.type === NodeTypes.ATTRIBUTE ? prop.name : null
}

function readDynamicNovaSchemaDirective(element: ElementNode): string | null {
  const prop = element.props.find(prop => (
    prop.type === NodeTypes.DIRECTIVE
    && prop.name === 'bind'
    && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
    && isNovaSchemaDirectiveName(prop.arg.content)
  ))
  return prop?.type === NodeTypes.DIRECTIVE && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
    ? prop.arg.content
    : null
}

function isStaticNovaSchemaDirectiveProp(prop: AttributeNode | DirectiveNode): boolean {
  return prop.type === NodeTypes.ATTRIBUTE && isNovaSchemaDirectiveName(prop.name)
}

function resolveNovaSchemaInclude(
  element: ElementNode,
  directiveName: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  options: TemplateParseOptions,
): Array<TemplateNode> {
  const usage = `<${element.tag} ${directiveName}>`
  const binding = options.schemaComponents?.get(element.tag)
  if (!binding) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-import-missing',
      message: `${usage} требует import из .nova файла.`,
    })
    return []
  }

  if (binding.imported !== 'default') {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-default-import',
      message: `${usage} поддерживает только default import .nova файла.`,
    })
    return []
  }

  if (assetExtension(binding.source) !== '.nova') {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-source',
      message: `${usage} должен ссылаться на .nova файл.`,
    })
    return []
  }

  if (hasNonEmptyTemplateChildren(element)) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-children',
      message: `${usage} не может содержать children.`,
    })
  }

  const extraAttrs = element.props.filter(prop => !isStaticNovaSchemaDirectiveProp(prop))
  if (extraAttrs.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-attrs',
      message: `${usage} пока не поддерживает props, events и slots.`,
    })
  }

  options.schemaComponentLocals?.add(binding.local)

  return resolveTemplateIncludeRequest(binding.source, element.tag, diagnostics, options, {
    missingResolverCode: 'nova-schema-resolver-missing',
    missingResolverMessage: '<*.nova nova:schema> требует resolveImport в настройках компилятора.',
    notFoundCode: 'nova-schema-not-found',
    notFoundMessage: request => `Не удалось найти nova:schema include "${request}".`,
    cycleCode: 'nova-schema-cycle',
    cycleMessage: request => `Обнаружен циклический nova:schema include "${request}".`,
    parseErrorCode: 'nova-schema-parse-error',
    missingTemplateCode: 'nova-schema-missing-template',
    missingTemplateMessage: request => `Nova schema include "${request}" должен содержать <template>.`,
  })
}

function resolveNovaSchemaIncludeFragment(
  element: ElementNode,
  directiveName: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  const usage = `<${element.tag} ${directiveName}>`
  const binding = options.schemaComponents?.get(element.tag)
  if (!binding) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-import-missing',
      message: `${usage} требует import из .nova файла.`,
    })
    return { children: [], slots: {} }
  }

  if (binding.imported !== 'default') {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-default-import',
      message: `${usage} поддерживает только default import .nova файла.`,
    })
    return { children: [], slots: {} }
  }

  if (assetExtension(binding.source) !== '.nova') {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-source',
      message: `${usage} должен ссылаться на .nova файл.`,
    })
    return { children: [], slots: {} }
  }

  if (hasNonEmptyTemplateChildren(element)) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-children',
      message: `${usage} не может содержать children.`,
    })
  }

  const extraAttrs = element.props.filter(prop => !isStaticNovaSchemaDirectiveProp(prop))
  if (extraAttrs.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'nova-schema-attrs',
      message: `${usage} пока не поддерживает props, events и slots.`,
    })
  }

  options.schemaComponentLocals?.add(binding.local)

  return resolveTemplateIncludeRequestFragment(binding.source, element.tag, diagnostics, baseOffset, options, {
    missingResolverCode: 'nova-schema-resolver-missing',
    missingResolverMessage: '<*.nova nova:schema> требует resolveImport в настройках компилятора.',
    notFoundCode: 'nova-schema-not-found',
    notFoundMessage: request => `Не удалось найти nova:schema include "${request}".`,
    cycleCode: 'nova-schema-cycle',
    cycleMessage: request => `Обнаружен циклический nova:schema include "${request}".`,
    parseErrorCode: 'nova-schema-parse-error',
    missingTemplateCode: 'nova-schema-missing-template',
    missingTemplateMessage: request => `Nova schema include "${request}" должен содержать <template>.`,
  })
}

function resolveTemplateInclude(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  options: TemplateParseOptions,
): Array<TemplateNode> {
  if (readElementDynamicAttr(element, 'src')) {
    diagnostics.push({
      severity: 'error',
      code: 'dynamic-template-src',
      message: '<template src> поддерживает только статический src. Динамический :src не поддерживается.',
    })
    return []
  }

  const request = readElementStaticAttr(element, 'src')
  if (!request) {
    diagnostics.push({
      severity: 'error',
      code: 'template-src-required',
      message: '<template src> требует путь к .nova файлу.',
    })
    return []
  }

  if (hasNonEmptyTemplateChildren(element)) {
    diagnostics.push({
      severity: 'error',
      code: 'template-src-inline-children',
      message: '<template src> не может одновременно содержать inline children.',
    })
  }

  return resolveTemplateIncludeRequest(request, request, diagnostics, options, {
    missingResolverCode: 'template-src-resolver-missing',
    missingResolverMessage: '<template src> требует resolveImport в настройках компилятора.',
    notFoundCode: 'template-src-not-found',
    notFoundMessage: request => `Не удалось найти template include "${request}".`,
    cycleCode: 'template-src-cycle',
    cycleMessage: request => `Обнаружен циклический template include "${request}".`,
    parseErrorCode: 'template-src-parse-error',
    missingTemplateCode: 'template-src-missing-template',
    missingTemplateMessage: request => `Template include "${request}" должен содержать <template>.`,
  })
}

function resolveTemplateIncludeFragment(
  element: ElementNode,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  if (readElementDynamicAttr(element, 'src')) {
    diagnostics.push({
      severity: 'error',
      code: 'dynamic-template-src',
      message: '<template src> поддерживает только статический src. Динамический :src не поддерживается.',
    })
    return { children: [], slots: {} }
  }

  const request = readElementStaticAttr(element, 'src')
  if (!request) {
    diagnostics.push({
      severity: 'error',
      code: 'template-src-required',
      message: '<template src> требует путь к .nova файлу.',
    })
    return { children: [], slots: {} }
  }

  if (hasNonEmptyTemplateChildren(element)) {
    diagnostics.push({
      severity: 'error',
      code: 'template-src-inline-children',
      message: '<template src> не может одновременно содержать inline children.',
    })
  }

  return resolveTemplateIncludeRequestFragment(request, request, diagnostics, baseOffset, options, {
    missingResolverCode: 'template-src-resolver-missing',
    missingResolverMessage: '<template src> требует resolveImport в настройках компилятора.',
    notFoundCode: 'template-src-not-found',
    notFoundMessage: request => `Не удалось найти template include "${request}".`,
    cycleCode: 'template-src-cycle',
    cycleMessage: request => `Обнаружен циклический template include "${request}".`,
    parseErrorCode: 'template-src-parse-error',
    missingTemplateCode: 'template-src-missing-template',
    missingTemplateMessage: request => `Template include "${request}" должен содержать <template>.`,
  })
}

function resolveTemplateIncludeRequest(
  request: string,
  displayName: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  options: TemplateParseOptions,
  messages: {
    missingResolverCode: string
    missingResolverMessage: string
    notFoundCode: string
    notFoundMessage: (request: string) => string
    cycleCode: string
    cycleMessage: (request: string) => string
    parseErrorCode: string
    missingTemplateCode: string
    missingTemplateMessage: (request: string) => string
  },
): Array<TemplateNode> {
  const resolver = options.resolveImport
  if (!resolver) {
    diagnostics.push({
      severity: 'error',
      code: messages.missingResolverCode,
      message: messages.missingResolverMessage,
    })
    return []
  }

  const resolved = resolver(request, options.filename)
  if (!resolved) {
    diagnostics.push({
      severity: 'error',
      code: messages.notFoundCode,
      message: messages.notFoundMessage(request),
    })
    return []
  }

  const source = typeof resolved === 'string' ? resolved : resolved.source
  const filename = typeof resolved === 'string' ? request : resolved.filename ?? request
  const includeKey = filename
  if (options.includeStack?.includes(includeKey)) {
    diagnostics.push({
      severity: 'error',
      code: messages.cycleCode,
      message: messages.cycleMessage(displayName),
    })
    return []
  }

  options.dependencies?.add(filename)

  const sfc = parseSfc(source, { filename })
  for (const error of sfc.errors) {
    diagnostics.push({
      severity: 'error',
      code: messages.parseErrorCode,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  if (!sfc.descriptor.template) {
    diagnostics.push({
      severity: 'error',
      code: messages.missingTemplateCode,
      message: messages.missingTemplateMessage(request),
    })
    return []
  }

  return parseTemplate(sfc.descriptor.template.content, diagnostics, 0, {
    ...options,
    filename,
    includeStack: [...(options.includeStack ?? []), includeKey],
  })
}

function resolveTemplateIncludeRequestFragment(
  request: string,
  displayName: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  baseOffset: number,
  options: TemplateParseOptions,
  messages: {
    missingResolverCode: string
    missingResolverMessage: string
    notFoundCode: string
    notFoundMessage: (request: string) => string
    cycleCode: string
    cycleMessage: (request: string) => string
    parseErrorCode: string
    missingTemplateCode: string
    missingTemplateMessage: (request: string) => string
  },
): { children: Array<TemplateNode>; slots: Record<string, TemplateSlotNode> } {
  const resolver = options.resolveImport
  if (!resolver) {
    diagnostics.push({
      severity: 'error',
      code: messages.missingResolverCode,
      message: messages.missingResolverMessage,
    })
    return { children: [], slots: {} }
  }

  const resolved = resolver(request, options.filename)
  if (!resolved) {
    diagnostics.push({
      severity: 'error',
      code: messages.notFoundCode,
      message: messages.notFoundMessage(request),
    })
    return { children: [], slots: {} }
  }

  const source = typeof resolved === 'string' ? resolved : resolved.source
  const filename = typeof resolved === 'string' ? request : resolved.filename ?? request
  const includeKey = filename
  if (options.includeStack?.includes(includeKey)) {
    diagnostics.push({
      severity: 'error',
      code: messages.cycleCode,
      message: messages.cycleMessage(displayName),
    })
    return { children: [], slots: {} }
  }

  options.dependencies?.add(filename)

  const sfc = parseSfc(source, { filename })
  for (const error of sfc.errors) {
    diagnostics.push({
      severity: 'error',
      code: messages.parseErrorCode,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  if (!sfc.descriptor.template) {
    diagnostics.push({
      severity: 'error',
      code: messages.missingTemplateCode,
      message: messages.missingTemplateMessage(request),
    })
    return { children: [], slots: {} }
  }

  return parseTemplateFragment(sfc.descriptor.template.content, diagnostics, baseOffset, {
    ...options,
    filename,
    includeStack: [...(options.includeStack ?? []), includeKey],
  })
}

function hasNonEmptyTemplateChildren(element: ElementNode): boolean {
  return element.children.some(child => {
    if (child.type !== NodeTypes.TEXT) return true
    return !!child.content.trim()
  })
}

function readElementStaticAttr(element: ElementNode, name: string): string | undefined {
  const attr = element.props.find((prop): prop is AttributeNode => prop.type === NodeTypes.ATTRIBUTE && prop.name === name)
  return typeof attr?.value?.content === 'string' ? attr.value.content : undefined
}

function readElementDynamicAttr(element: ElementNode, name: string): string | undefined {
  const directive = element.props.find((prop): prop is DirectiveNode => (
    prop.type === NodeTypes.DIRECTIVE
    && prop.name === 'bind'
    && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
    && prop.arg.content === name
  ))
  return directive?.exp?.type === NodeTypes.SIMPLE_EXPRESSION ? directive.exp.content : undefined
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

    if (directive.name === 'slot' && element.tag === 'TimelineTaskProfile') {
      continue
    }

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

    diagnostics.push({
      severity: 'error',
      code: 'unsupported-directive',
      message: `Директива v-${directive.name} на <${element.tag}> пока не поддерживается.`,
    })
  }
  return attrs
}

function collectElementAttrRanges(element: ElementNode, baseOffset: number): Record<string, NovaSourceRange> {
  const ranges: Record<string, NovaSourceRange> = {}
  for (const prop of element.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      ranges[prop.name] = toSourceRange(prop, baseOffset)
      continue
    }
    const directive = prop as DirectiveNode
    const arg = directive.arg && directive.arg.type === NodeTypes.SIMPLE_EXPRESSION
      ? directive.arg.content
      : ''
    const key = directive.name === 'bind'
      ? arg ? `:${arg}` : 'v-bind'
      : directive.name === 'on'
        ? arg ? `@${arg}` : 'v-on'
        : `v-${directive.name}`
    ranges[key] = toSourceRange(prop, baseOffset)
  }
  return ranges
}

function toSourceRange(node: { loc: { start: { offset: number }; end: { offset: number } } }, baseOffset: number): NovaSourceRange {
  return {
    start: baseOffset + node.loc.start.offset,
    end: baseOffset + node.loc.end.offset,
  }
}

function toTagSourceRange(element: ElementNode, baseOffset: number): NovaSourceRange {
  const start = baseOffset + element.loc.start.offset + 1
  return {
    start,
    end: start + element.tag.length,
  }
}

function registerScriptAssetImports(bindings: Array<NovaAssetImportBinding>, context: GenerateContext): void {
  for (const binding of bindings) {
    const ref = registerPathAsset(context, {
      request: binding.source,
      kind: binding.kind,
    })
    context.assets.importRefs.set(binding.local, ref)
    context.assets.importBindings.push({ local: binding.local, ref })
  }
}

function registerAssetDeclarations(nodes: Array<TemplateNode>, context: GenerateContext): void {
  for (const node of nodes) {
    if (isAssetsContainerTag(node.tag)) {
      registerAssetBundleReferences(node, context)
      registerAssetDeclarations(node.children, context)
      for (const slot of Object.values(node.slots)) registerAssetDeclarations(slot.children, context)
      continue
    }

    if (isAssetDeclarationTag(node.tag)) {
      registerAssetDeclaration(node, context)
    }
    registerAssetDeclarations(node.children, context)
    for (const slot of Object.values(node.slots)) registerAssetDeclarations(slot.children, context)
  }
}

function registerAssetDeclaration(node: TemplateNode, context: GenerateContext): void {
  const id = readAttr(node, 'id')
  if (!id) {
    context.diagnostics.push({
      severity: 'error',
      code: 'asset-id',
      message: `<${node.tag}> требует статический id.`,
    })
    return
  }

  switch (normalizeAssetDeclarationTag(node.tag)) {
    case 'StripePattern':
      registerStripePatternAsset(node, id, context)
      break
    case 'Image':
      registerImageDeclarationAsset(node, id, context)
      break
    case 'Icon':
      registerIconDeclarationAsset(node, id, context)
      break
    case 'CanvasTexture':
      registerCanvasTextureDeclarationAsset(node, id, context)
      break
    case 'LinearGradient':
      registerLinearGradientDeclarationAsset(node, id, context)
      break
    case 'RadialGradient':
      registerRadialGradientDeclarationAsset(node, id, context)
      break
    case 'ConicGradient':
      registerConicGradientDeclarationAsset(node, id, context)
      break
    case 'Pattern':
      registerPatternDeclarationAsset(node, id, context)
      break
    case 'Noise':
      registerNoiseDeclarationAsset(node, id, context)
      break
    case 'MeshGradient':
      registerMeshGradientDeclarationAsset(node, id, context)
      break
    case 'NineSliceImage':
      registerNineSliceImageDeclarationAsset(node, id, context)
      break
    case 'Font':
      registerFontDeclarationAsset(node, id, context)
      break
    default:
      break
  }
}

function registerAssetBundleReferences(node: TemplateNode, context: GenerateContext): void {
  const bundle = readAttr(node, ':bundle') ?? readAttr(node, 'bundle')
  const src = readAttr(node, 'src')

  if (bundle) {
    context.assets.bundleExpressions.push(bundle)
  }
  if (src) {
    context.assets.bundleExpressions.push(registerAssetBundleImport(src, context, node.filename))
  }
}

function registerPathAsset(
  context: GenerateContext,
  input: {
    request: string
    kind?: NovaAutoAssetKind | null
    color?: string
    from?: string
  },
): string {
  const kind = input.kind ?? resolveAssetKind(input.request)
  if (!kind) {
    context.diagnostics.push({
      severity: 'error',
      code: 'unsupported-asset-extension',
      message: `Asset "${input.request}" использует неподдерживаемое расширение.`,
    })
    return 'undefined'
  }

  const resolved = context.resolveImport?.(input.request, input.from ?? context.filename)
  if (context.resolveImport && !resolved) {
    context.diagnostics.push({
      severity: 'error',
      code: 'asset-not-found',
      message: `Не найден asset "${input.request}".`,
    })
  }

  const resolvedFilename = resolved && typeof resolved !== 'string' ? resolved.filename : undefined
  if (resolvedFilename) context.dependencies?.add(resolvedFilename)

  const canonicalRequest = resolvedFilename ?? input.request
  const key = `path:${kind}:${canonicalRequest}:${input.color ?? ''}`
  const existing = context.assets.refsByKey.get(key)
  if (existing) return existing

  const name = `${safeAssetName(input.request)}_${context.assets.records.size.toString(36)}`
  const importName = `__novaAsset${context.assets.records.size}`
  const importRequest = kind === 'icon' ? `${canonicalRequest}?raw` : canonicalRequest
  context.generatedImports.push(`import ${importName} from ${JSON.stringify(importRequest)};`)

  const descriptor = kind === 'icon'
    ? `__NovaRuntime.assets.svg(${importName}, { width: 24, height: 24${input.color ? `, color: ${JSON.stringify(input.color)}` : ''} })`
    : `__NovaRuntime.assets.image(${importName})`

  const record: NovaAutoAssetRecord = {
    key,
    name,
    kind,
    request: input.request,
    importName,
    descriptor,
  }
  context.assets.records.set(key, record)

  const ref = `__novaSfcAssets.${kind === 'fill' ? 'fills' : `${kind}s`}.${name}`
  context.assets.refsByKey.set(key, ref)
  return ref
}

function registerAssetBundleImport(request: string, context: GenerateContext, from?: string): string {
  const resolved = context.resolveImport?.(request, from ?? context.filename)
  if (context.resolveImport && !resolved) {
    context.diagnostics.push({
      severity: 'error',
      code: 'asset-bundle-not-found',
      message: `Не найден asset bundle "${request}".`,
    })
  }

  const resolvedFilename = resolved && typeof resolved !== 'string' ? resolved.filename : undefined
  if (resolvedFilename) context.dependencies?.add(resolvedFilename)

  const canonicalRequest = resolvedFilename ?? request
  const key = `bundle:${canonicalRequest}`
  const existing = context.assets.bundleRefsByKey.get(key)
  if (existing) return existing

  const importName = `__novaAssetBundle${context.assets.bundleRefsByKey.size}`
  context.generatedImports.push(`import ${importName} from ${JSON.stringify(canonicalRequest)};`)
  context.assets.bundleRefsByKey.set(key, importName)
  return importName
}

function registerStripePatternAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const descriptorKey = [
    groupAttr(node, 'bgColor') || groupAttr(node, 'bg-color') || '"transparent"',
    groupAttr(node, 'stripeColor') || groupAttr(node, 'stripe-color') || '"rgba(15, 23, 42, 0.12)"',
    groupAttr(node, 'stripeWidth') || groupAttr(node, 'stripe-width') || '2',
    groupAttr(node, 'angle') || '45',
    groupAttr(node, 'sizeK') || groupAttr(node, 'size-k') || '8',
  ].join('|')
  const key = `stripe:${id}:${descriptorKey}`
  const existingRef = context.assets.patternRefs.get(id)
  if (existingRef) {
    const existingKey = [...context.assets.refsByKey.entries()].find(([, ref]) => ref === existingRef)?.[0]
    if (existingKey && existingKey !== key) {
      context.diagnostics.push({
        severity: 'error',
        code: 'duplicate-stripe-pattern',
        message: `StripePattern "${id}" объявлен повторно с другими параметрами.`,
      })
    }
    return existingRef
  }

  const name = safeAssetName(id)
  const descriptor = `__NovaRuntime.assets.stripe({
      bgColor: ${groupAttr(node, 'bgColor') || groupAttr(node, 'bg-color') || '"transparent"'},
      stripeColor: ${groupAttr(node, 'stripeColor') || groupAttr(node, 'stripe-color') || '"rgba(15, 23, 42, 0.12)"'},
      stripeWidth: ${groupAttr(node, 'stripeWidth') || groupAttr(node, 'stripe-width') || '2'},
      angle: ${groupAttr(node, 'angle') || '45'},
      sizeK: ${groupAttr(node, 'sizeK') || groupAttr(node, 'size-k') || '8'},
    })`
  const record: NovaAutoAssetRecord = {
    key,
    name,
    kind: 'fill',
    descriptor,
  }
  context.assets.records.set(key, record)

  const ref = `__novaSfcAssets.fills.${name}`
  context.assets.refsByKey.set(key, ref)
  context.assets.patternRefs.set(id, ref)
  context.assets.localKeys.set(id, key)
  registerLocalAssetRef(context, id, 'fill', ref)
  return ref
}

function registerImageDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const source = resolveAssetDeclarationSource(node, context, 'image')
  const options = generateAssetDimensionOptions(node)
  const key = `image:${id}:${source.key}:${options}`
  const descriptor = `__NovaRuntime.assets.image(${source.expression}${options ? `, ${options}` : ''})`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'image',
    descriptor,
  })
}

function registerIconDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const source = resolveAssetDeclarationSource(node, context, 'icon')
  const width = groupAttr(node, 'width') || '24'
  const height = groupAttr(node, 'height') || '24'
  const color = groupAttr(node, 'color') || groupAttr(node, 'asset-color') || groupAttr(node, 'assetColor')
  const descriptor = `__NovaRuntime.assets.svg(${source.expression}, { width: ${width}, height: ${height}${color ? `, color: ${color}` : ''} })`
  const key = `icon:${id}:${source.key}:${width}:${height}:${color ?? ''}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'icon',
    descriptor,
  })
}

function registerCanvasTextureDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const source = readAttr(node, ':source') ?? readAttr(node, ':src')
  if (!source) {
    context.diagnostics.push({
      severity: 'error',
      code: 'canvas-texture-source',
      message: `<${node.tag}> требует :source.`,
    })
  }
  const options = generateAssetDimensionOptions(node)
  const descriptor = `__NovaRuntime.assets.canvas(${source || 'undefined'}${options ? `, ${options}` : ''})`
  const key = `canvas:${id}:${source ?? ''}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor,
  })
}

function registerLinearGradientDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const from = groupAttr(node, 'from')
  const to = groupAttr(node, 'to')
  if (!from || !to) {
    context.diagnostics.push({
      severity: 'error',
      code: 'linear-gradient-colors',
      message: `<${node.tag}> требует from и to.`,
    })
  }

  const angle = groupAttr(node, 'angle')
  const stops = groupAttr(node, 'stops')
  const size = groupAttr(node, 'size')
  const descriptor = `__NovaRuntime.assets.linearGradient({
      from: ${from || '"transparent"'},
      to: ${to || '"transparent"'}${angle ? `,
      angle: ${angle}` : ''}${stops ? `,
      stops: ${stops}` : ''}${size ? `,
      size: ${size}` : ''}
    })`
  const key = `linear-gradient:${id}:${from ?? ''}:${to ?? ''}:${angle ?? ''}:${stops ?? ''}:${size ?? ''}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor,
  })
}

function registerRadialGradientDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const inner = groupAttr(node, 'inner')
  const outer = groupAttr(node, 'outer')
  const stops = groupAttr(node, 'stops')
  if ((!inner || !outer) && !stops) {
    context.diagnostics.push({
      severity: 'error',
      code: 'radial-gradient-colors',
      message: `<${node.tag}> требует inner/outer или stops.`,
    })
  }

  const options = buildObjectLiteral([
    `inner: ${inner || '"transparent"'}`,
    `outer: ${outer || '"transparent"'}`,
    optionalObjectEntry(node, 'centerX'),
    optionalObjectEntry(node, 'centerY'),
    optionalObjectEntry(node, 'radiusX'),
    optionalObjectEntry(node, 'radiusY'),
    stops ? `stops: ${stops}` : '',
    optionalObjectEntry(node, 'size'),
  ])
  const key = `radial-gradient:${id}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor: `__NovaRuntime.assets.radialGradient(${options})`,
  })
}

function registerConicGradientDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const from = groupAttr(node, 'from')
  const to = groupAttr(node, 'to')
  const stops = groupAttr(node, 'stops')
  if ((!from || !to) && !stops) {
    context.diagnostics.push({
      severity: 'error',
      code: 'conic-gradient-colors',
      message: `<${node.tag}> требует from/to или stops.`,
    })
  }

  const options = buildObjectLiteral([
    `from: ${from || '"transparent"'}`,
    `to: ${to || '"transparent"'}`,
    optionalObjectEntry(node, 'centerX'),
    optionalObjectEntry(node, 'centerY'),
    optionalObjectEntry(node, 'startAngle'),
    stops ? `stops: ${stops}` : '',
    optionalObjectEntry(node, 'size'),
  ])
  const key = `conic-gradient:${id}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor: `__NovaRuntime.assets.conicGradient(${options})`,
  })
}

function registerPatternDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const source = resolveAssetDeclarationSource(node, context, 'fill')
  const options = buildObjectLiteral([
    optionalObjectEntry(node, 'repeat'),
    optionalObjectEntry(node, 'width'),
    optionalObjectEntry(node, 'height'),
    optionalObjectEntry(node, 'scale'),
    optionalObjectEntry(node, 'offsetX'),
    optionalObjectEntry(node, 'offsetY'),
  ])
  const descriptor = `__NovaRuntime.assets.pattern(${source.expression}${options !== '{}' ? `, ${options}` : ''})`
  const key = `pattern:${id}:${source.key}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor,
  })
}

function registerNoiseDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const options = buildObjectLiteral([
    optionalObjectEntry(node, 'baseColor'),
    optionalObjectEntry(node, 'noiseColor'),
    optionalObjectEntry(node, 'opacity'),
    optionalObjectEntry(node, 'density'),
    optionalObjectEntry(node, 'seed'),
    optionalObjectEntry(node, 'size'),
  ])
  const key = `noise:${id}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor: `__NovaRuntime.assets.noise(${options})`,
  })
}

function registerMeshGradientDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const points = groupAttr(node, 'points')
  if (!points) {
    context.diagnostics.push({
      severity: 'error',
      code: 'mesh-gradient-points',
      message: `<${node.tag}> требует :points.`,
    })
  }

  const options = buildObjectLiteral([
    optionalObjectEntry(node, 'background'),
    `points: ${points || '[]'}`,
    optionalObjectEntry(node, 'size'),
  ])
  const key = `mesh-gradient:${id}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'fill',
    descriptor: `__NovaRuntime.assets.meshGradient(${options})`,
  })
}

function registerNineSliceImageDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const source = resolveAssetDeclarationSource(node, context, 'image')
  const slice = groupAttr(node, 'slice')
  if (!slice) {
    context.diagnostics.push({
      severity: 'error',
      code: 'nine-slice-image-slice',
      message: `<${node.tag}> требует slice или :slice.`,
    })
  }

  const options = buildObjectLiteral([
    `slice: ${slice || '0'}`,
    optionalObjectEntry(node, 'width'),
    optionalObjectEntry(node, 'height'),
    optionalObjectEntry(node, 'centerMode'),
  ])
  const descriptor = `__NovaRuntime.assets.nineSliceImage(${source.expression}, ${options})`
  const key = `nine-slice-image:${id}:${source.key}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'image',
    descriptor,
  })
}

function registerFontDeclarationAsset(node: TemplateNode, id: string, context: GenerateContext): string {
  const family = groupAttr(node, 'family')
  if (!family) {
    context.diagnostics.push({
      severity: 'error',
      code: 'font-family',
      message: `<${node.tag}> требует family.`,
    })
  }
  const source = resolveAssetDeclarationSource(node, context, 'font')
  const options = buildObjectLiteral([
    `family: ${family || JSON.stringify(id)}`,
    `src: ${source.expression}`,
    optionalObjectEntry(node, 'weight'),
    optionalObjectEntry(node, 'style'),
    optionalObjectEntry(node, 'display'),
  ])
  const key = `font:${id}:${source.key}:${options}`
  return registerDeclaredAssetRecord(context, {
    key,
    id,
    kind: 'font',
    descriptor: `__NovaRuntime.assets.font(${options})`,
  })
}

function resolveAssetDeclarationSource(node: TemplateNode, context: GenerateContext, kind: NovaAutoAssetKind): { expression: string; key: string } {
  const dynamicSource = readAttr(node, ':src') ?? readAttr(node, ':source')
  if (dynamicSource) {
    return { expression: dynamicSource, key: `dynamic:${dynamicSource}` }
  }

  const staticSource = readAttr(node, 'src') ?? readAttr(node, 'source')
  if (!staticSource) {
    context.diagnostics.push({
      severity: 'error',
      code: 'asset-source',
      message: `<${node.tag}> требует src или :source.`,
    })
    return { expression: 'undefined', key: 'missing' }
  }

  const importName = `__novaAsset${context.assets.records.size}`
  const importRequest = kind === 'icon' ? `${staticSource}?raw` : staticSource
  const resolved = context.resolveImport?.(staticSource, node.filename ?? context.filename)
  if (context.resolveImport && !resolved) {
    context.diagnostics.push({
      severity: 'error',
      code: 'asset-not-found',
      message: `Не найден asset "${staticSource}".`,
    })
  }
  const resolvedFilename = resolved && typeof resolved !== 'string' ? resolved.filename : undefined
  if (resolvedFilename) context.dependencies?.add(resolvedFilename)
  const canonicalRequest = resolvedFilename ?? staticSource
  context.generatedImports.push(`import ${importName} from ${JSON.stringify(kind === 'icon' ? `${canonicalRequest}?raw` : canonicalRequest)};`)
  return {
    expression: importName,
    key: `static:${importRequest}`,
  }
}

function generateAssetDimensionOptions(node: TemplateNode): string {
  const width = groupAttr(node, 'width')
  const height = groupAttr(node, 'height')
  const entries = [
    width ? `width: ${width}` : '',
    height ? `height: ${height}` : '',
  ].filter(Boolean)
  return entries.length ? `{ ${entries.join(', ')} }` : ''
}

function optionalObjectEntry(node: TemplateNode, name: string, targetName = name): string {
  const value = groupAttr(node, name)
  return value ? `${targetName}: ${value}` : ''
}

function buildObjectLiteral(entries: Array<string>): string {
  const body = entries.filter(Boolean).join(', ')
  return `{ ${body} }`
}

function registerDeclaredAssetRecord(
  context: GenerateContext,
  input: {
    key: string
    id: string
    kind: NovaAutoAssetKind
    descriptor: string
  },
): string {
  const existingRef = context.assets.localRefs.get(input.id)
  const ref = `__novaSfcAssets.${input.kind === 'fill' ? 'fills' : `${input.kind}s`}.${safeAssetName(input.id)}`
  if (existingRef) {
    if (existingRef.kind !== input.kind || existingRef.ref !== ref || context.assets.localKeys.get(input.id) !== input.key) {
      context.diagnostics.push({
        severity: 'error',
        code: 'duplicate-asset-id',
        message: `Asset "${input.id}" объявлен повторно.`,
      })
    }
    return existingRef.ref
  }

  const record: NovaAutoAssetRecord = {
    key: input.key,
    name: safeAssetName(input.id),
    kind: input.kind,
    descriptor: input.descriptor,
  }
  context.assets.records.set(input.key, record)
  context.assets.refsByKey.set(input.key, ref)
  context.assets.localKeys.set(input.id, input.key)
  registerLocalAssetRef(context, input.id, input.kind, ref)
  if (input.kind === 'fill') context.assets.patternRefs.set(input.id, ref)
  return ref
}

function registerLocalAssetRef(context: GenerateContext, id: string, kind: NovaAutoAssetKind, ref: string): void {
  const existing = context.assets.localRefs.get(id)
  if (existing && (existing.kind !== kind || existing.ref !== ref)) {
    context.diagnostics.push({
      severity: 'error',
      code: 'duplicate-asset-id',
      message: `Asset "${id}" объявлен повторно.`,
    })
    return
  }
  context.assets.localRefs.set(id, { kind, ref })
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
      && !CORE_DSL_TAGS[node.tag]
      && !PRIMITIVE_TAGS.has(node.tag)
      && !TIMELINE_PROFILE_MARKER_TAGS.has(node.tag)
      && !TIMELINE_PROFILE_PRIMITIVE_TAGS.has(node.tag)
      && !TIMELINE_GROUP_MARKER_TAGS.has(node.tag)
      && !TIMELINE_MARKER_DSL_TAGS.has(node.tag)
      && node.tag !== TIMELINE_GRID_TEMPLATE_TAG
      && node.tag !== TIMELINE_MARQUEE_SELECTION_TAG
      && !isAssetDeclarationTag(node.tag)
      && !isAssetsContainerTag(node.tag)
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

    if (!isAssetDeclarationTag(node.tag) && !isAssetsContainerTag(node.tag) && readAttr(node, 'for') && !readAttr(node, ':key') && !readAttr(node, 'key')) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-key',
        message: `for на <${node.tag}> должен содержать обязательный :key.`,
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

    const isElseBranch = !!readAttr(node, 'else-if') || hasControlElseAttr(node)
    if (isElseBranch && !previousAcceptsElse) {
      diagnostics.push({
        severity: 'error',
        code: 'orphan-else',
        message: `else/else-if на <${node.tag}> должен идти после if.`,
      })
    }

    if (node.tag === 'TimelineChart.GroupPanel') {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-group-panel-removed',
        message: 'TimelineChart.GroupPanel удален. Описывайте #background, #overlay и TimelineChart.GroupColumn внутри TimelineChart.GroupsPanel.',
      })
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === 'TimelineChart.GroupsPanel') {
      validateTimelineGroupsPanelNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === 'TimelineChart.GroupColumn') {
      validateTimelineGroupColumnNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === 'TimelineChart.Markers') {
      validateTimelineMarkerNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === TIMELINE_GRID_TEMPLATE_TAG) {
      validateTimelineGridTemplateNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === TIMELINE_MARQUEE_SELECTION_TAG) {
      validateTimelineMarqueeSelectionNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (node.tag === 'TimelineChart.Marker') {
      validateTimelineMarkerNodes([node], diagnostics)
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    if (isAssetsContainerTag(node.tag) || isAssetDeclarationTag(node.tag)) {
      previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
      continue
    }

    validateTemplateNodeList(node.children, diagnostics, options)
    for (const slot of Object.values(node.slots)) {
      validateTemplateNodeList(slot.children, diagnostics, options)
    }
    previousAcceptsElse = !!readAttr(node, 'if') || !!readAttr(node, 'else-if')
  }
}

function generateNodeSequence(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const chunks: Array<string> = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (isAssetDeclarationTag(node.tag) || isAssetsContainerTag(node.tag)) continue
    if (readAttr(node, 'else-if') || hasControlElseAttr(node)) continue

    const condition = readAttr(node, 'if')
    if (!condition) {
      chunks.push(generateNodeList(node, context, index === 0))
      continue
    }

    let branch = `(${condition}) ? ${generateNodeArray(node, context, index === 0)}`
    let fallback = '[]'
    let cursor = index + 1
    while (cursor < nodes.length) {
      const next = nodes[cursor]
      const elseIf = readAttr(next, 'else-if')
      const hasElse = hasControlElseAttr(next)
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
  const forSource = readAttr(node, 'for')
  if (forSource) {
    const parsed = parseForExpression(forSource)
    if (parsed) {
      const schema = generateSchema(node, context, isTopLevelRoot)
      return `__novaFor(${parsed.source}).flatMap((${parsed.item}, ${parsed.index}) => [${schema}])`
    }
  }

  return generateSchema(node, context, isTopLevelRoot)
}

function generateNodeArray(node: TemplateNode, context: GenerateContext, isTopLevelRoot: boolean): string {
  const list = generateNodeList(node, context, isTopLevelRoot)
  return list.startsWith('(') || list.startsWith('this.renderSlot(')
    ? list
    : `[${list}]`
}

function generateSchema(
  node: TemplateNode,
  context: GenerateContext,
  isTopLevelRoot: boolean,
): string {
  if (node.tag === 'slot') return generateSlotOutlet(node, context)
  if (node.tag === 'Tooltips') return generateTooltipsSchema(node, context, isTopLevelRoot)
  if (node.tag === 'Dialogs') return generateDialogsSchema(node, context, isTopLevelRoot)

  const type = resolveNodeTypeExpression(node, context)
  const isCompiledComponent = node.tag === 'Component' || context.importedRuntimeSymbols.has(node.tag)
  const childNodes = isTimelineRootTag(node)
    ? node.children.filter(child => !isTimelineProfileNode(child) && !isTimelineRootTemplateNode(child) && !isTimelineMarkerTemplateNode(child) && !isTimelineGridTemplateNode(child) && !isTimelineMarqueeSelectionNode(child) && !isAssetsContainerTag(child.tag) && !isAssetDeclarationTag(child.tag))
    : isTimelineGroupsPanelTag(node)
      ? node.children.filter(child => !isTimelineGroupsPanelTemplateChild(child))
      : node.children
  const timelineTaskProfiles = isTimelineRootTag(node)
    ? generateTimelineTaskProfilesProp(node.children, context)
    : ''
  const timelineVisualProfiles = isTimelineRootTag(node)
    ? generateTimelineVisualProfilesProp(node.children)
    : ''
  const timelineGroupColumnTemplates = isTimelineRootTag(node)
    ? generateTimelineGroupColumnTemplatesProp(node.children, context)
    : ''
  const timelineGroupPanelTemplate = isTimelineRootTag(node)
    ? generateTimelineGroupPanelTemplateProp(node.children, context)
    : ''
  const timelineGroupPanelOverlayTemplate = isTimelineRootTag(node)
    ? generateTimelineGroupPanelOverlayTemplateProp(node.children, context)
    : ''
  const timelineMarkers = isTimelineRootTag(node)
    ? generateTimelineMarkersProp(node.children, context)
    : ''
  const timelineGridTemplate = isTimelineRootTag(node)
    ? generateTimelineGridTemplateProp(node.children, context)
    : ''
  const timelineMarqueeSelection = isTimelineRootTag(node)
    ? generateTimelineMarqueeSelectionProp(node.children, context)
    : ''
  const props = [
    timelineTaskProfiles,
    timelineVisualProfiles,
    timelineGroupColumnTemplates,
    timelineGroupPanelTemplate,
    timelineGroupPanelOverlayTemplate,
    timelineMarkers,
    timelineGridTemplate,
    timelineMarqueeSelection,
  ].reduce(
    (base, extra) => mergePropsCode(base, extra),
    generateProps(node, context, isCompiledComponent, isTopLevelRoot),
  )
  const events = generateEvents(node, isCompiledComponent)
  const children = childNodes.length > 0 && !isCompiledComponent
    ? generateNodeSequence(childNodes, context)
    : ''
  const slots = generateSlots(node, context, isCompiledComponent)
  const key = readAttr(node, ':key') ?? readAttr(node, 'key')
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
  const entries: Array<[string, TemplateSlotNode]> = Object
    .entries(node.slots)
    .filter(([name]) => !isTimelineGroupsPanelTag(node) || (name !== 'background' && name !== 'overlay'))
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
      || isControlFlowAttr(name)
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

function generateAutoAssetBundleCode(registry: NovaAutoAssetRegistry): string {
  const records = [...registry.records.values()]
  if (records.length === 0) return ''

  const byKind = {
    icon: records.filter(record => record.kind === 'icon'),
    image: records.filter(record => record.kind === 'image'),
    fill: records.filter(record => record.kind === 'fill'),
    font: records.filter(record => record.kind === 'font'),
  }
  const objectFor = (items: Array<NovaAutoAssetRecord>): string => {
    if (items.length === 0) return ''
    return items.map(record => `${quoteKey(record.name)}:${record.descriptor}`).join(',')
  }
  const sections = [
    byKind.icon.length ? `icons:{${objectFor(byKind.icon)}}` : '',
    byKind.image.length ? `images:{${objectFor(byKind.image)}}` : '',
    byKind.fill.length ? `fills:{${objectFor(byKind.fill)}}` : '',
    byKind.font.length ? `fonts:{${objectFor(byKind.font)}}` : '',
  ].filter(Boolean)

  return `const __novaSfcAssets = __NovaRuntime.assets.define('nova-sfc-${createHash('sha1').update(records.map(record => record.key).join('|')).digest('hex').slice(0, 10)}', {
  ${sections.join(',\n  ')}
});
${registry.importBindings.map(binding => `const ${binding.local} = ${binding.ref};`).join('\n')}`
}

function isTimelineRootTag(node: TemplateNode): boolean {
  return node.tag === 'TimelineChart.Root'
}

function generateTimelineTaskProfilesProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const profileNodes = nodes.filter(node => node.tag === 'TimelineTaskProfile')
  if (profileNodes.length === 0) return ''
  return `taskProfiles:${generateTimelineTaskProfiles(profileNodes, context)}`
}

function generateTimelineVisualProfilesProp(nodes: Array<TemplateNode>): string {
  const pointProfiles = nodes.filter(node => node.tag === 'TimelineChart.PointProfile')
  const linkProfiles = nodes.filter(node => node.tag === 'TimelineChart.LinkProfile')
  const backgroundProfiles = nodes.filter(node => node.tag === 'TimelineChart.BackgroundProfile')
  if (pointProfiles.length === 0 && linkProfiles.length === 0 && backgroundProfiles.length === 0) return ''

  const sections = [
    pointProfiles.length > 0 ? `pointProfiles:{${pointProfiles.map(generateTimelinePointProfileEntry).join(',')}}` : '',
    linkProfiles.length > 0 ? `linkProfiles:{${linkProfiles.map(generateTimelineLinkProfileEntry).join(',')}}` : '',
    backgroundProfiles.length > 0 ? `backgroundProfiles:{${backgroundProfiles.map(generateTimelineBackgroundProfileEntry).join(',')}}` : '',
  ].filter(Boolean)

  return `visualProfiles:{${sections.join(',')}}`
}

function generateTimelineGroupColumnTemplatesProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const columns = collectTimelineGroupColumnNodes(nodes)
  if (columns.length === 0) return ''
  return `compiledGroupColumnTemplates:${generateTimelineGroupColumnTemplates(columns, context)}`
}

function generateTimelineGroupPanelTemplateProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const panel = collectTimelineGroupPanelNodes(nodes).find(node => node.slots.background)
  if (!panel?.slots.background) return ''
  return `compiledGroupPanelTemplate:${generateTimelineGroupPanelTemplate(panel.slots.background.children, context)}`
}

function generateTimelineGroupPanelOverlayTemplateProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const panel = collectTimelineGroupPanelNodes(nodes).find(node => node.slots.overlay)
  if (!panel?.slots.overlay) return ''
  return `compiledGroupPanelOverlayTemplate:${generateTimelineGroupPanelTemplate(panel.slots.overlay.children, context)}`
}

function generateTimelineMarkersProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const markerRoots = collectTimelineMarkersNodes(nodes)
  if (markerRoots.length === 0) return ''
  return `compiledMarkers:${generateTimelineMarkersConfig(markerRoots, context)}`
}

function generateTimelineGridTemplateProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const gridTemplate = collectTimelineGridTemplateNodes(nodes)[0]
  if (!gridTemplate) return ''
  return `compiledGridTemplate:${generateTimelineGridTemplate(gridTemplate.children, context)}`
}

function generateTimelineMarqueeSelectionProp(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const marqueeSelection = collectTimelineMarqueeSelectionNodes(nodes)[0]
  if (!marqueeSelection) return ''
  return `compiledMarqueeSelection:${generateTimelineMarqueeSelectionConfig(marqueeSelection, context)}`
}

function mergePropsCode(base: string, extra: string): string {
  if (!extra) return base
  if (!base) return `{${extra}}`
  return `${base.slice(0, -1)},${extra}}`
}

function isTimelineProfileNode(node: TemplateNode): boolean {
  return node.tag === 'TimelineTaskProfile'
    || node.tag === 'TimelineChart.BackgroundProfile'
    || node.tag === 'TimelineChart.PointProfile'
    || node.tag === 'TimelineChart.LinkProfile'
}

function isTimelineGroupsPanelTag(node: TemplateNode): boolean {
  return node.tag === 'TimelineChart.GroupsPanel'
}

function isTimelineRootTemplateNode(node: TemplateNode): boolean {
  return node.tag === 'TimelineChart.GroupColumn'
}

function isTimelineGroupsPanelTemplateChild(node: TemplateNode): boolean {
  return node.tag === 'TimelineChart.GroupColumn' || node.tag === 'template'
}

function isTimelineMarkerTemplateNode(node: TemplateNode): boolean {
  return node.tag === 'TimelineChart.Markers' || node.tag === 'TimelineChart.Marker'
}

function isTimelineGridTemplateNode(node: TemplateNode): boolean {
  return node.tag === TIMELINE_GRID_TEMPLATE_TAG
}

function isTimelineMarqueeSelectionNode(node: TemplateNode): boolean {
  return node.tag === TIMELINE_MARQUEE_SELECTION_TAG
}

function collectTimelineGroupColumnNodes(nodes: Array<TemplateNode>): Array<TemplateNode> {
  const result: Array<TemplateNode> = []
  for (const node of nodes) {
    if (node.tag === 'TimelineChart.GroupColumn') {
      result.push(node)
      continue
    }
    result.push(...collectTimelineGroupColumnNodes(node.children))
    for (const slot of Object.values(node.slots)) {
      result.push(...collectTimelineGroupColumnNodes(slot.children))
    }
  }
  return result
}

function collectTimelineGroupPanelNodes(nodes: Array<TemplateNode>): Array<TemplateNode> {
  const result: Array<TemplateNode> = []
  for (const node of nodes) {
    if (node.tag === 'TimelineChart.GroupsPanel') {
      result.push(node)
      continue
    }
    result.push(...collectTimelineGroupPanelNodes(node.children))
    for (const slot of Object.values(node.slots)) {
      result.push(...collectTimelineGroupPanelNodes(slot.children))
    }
  }
  return result
}

function collectTimelineMarkersNodes(nodes: Array<TemplateNode>): Array<TemplateNode> {
  const result: Array<TemplateNode> = []
  for (const node of nodes) {
    if (node.tag === 'TimelineChart.Markers') {
      result.push(node)
      continue
    }
    result.push(...collectTimelineMarkersNodes(node.children))
    for (const slot of Object.values(node.slots)) {
      result.push(...collectTimelineMarkersNodes(slot.children))
    }
  }
  return result
}

function collectTimelineGridTemplateNodes(nodes: Array<TemplateNode>): Array<TemplateNode> {
  const result: Array<TemplateNode> = []
  for (const node of nodes) {
    if (node.tag === TIMELINE_GRID_TEMPLATE_TAG) {
      result.push(node)
      continue
    }
    result.push(...collectTimelineGridTemplateNodes(node.children))
    for (const slot of Object.values(node.slots)) {
      result.push(...collectTimelineGridTemplateNodes(slot.children))
    }
  }
  return result
}

function collectTimelineMarqueeSelectionNodes(nodes: Array<TemplateNode>): Array<TemplateNode> {
  const result: Array<TemplateNode> = []
  for (const node of nodes) {
    if (node.tag === TIMELINE_MARQUEE_SELECTION_TAG) {
      result.push(node)
      continue
    }
    result.push(...collectTimelineMarqueeSelectionNodes(node.children))
    for (const slot of Object.values(node.slots)) {
      result.push(...collectTimelineMarqueeSelectionNodes(slot.children))
    }
  }
  return result
}

function validateTimelineGridTemplateNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (node.children.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-grid-template-empty',
        message: 'TimelineChart.GridTemplate требует schema children.',
      })
    }

    for (const slotName of Object.keys(node.slots)) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-grid-template-slot',
        message: `TimelineChart.GridTemplate пока не поддерживает slot "${slotName}".`,
      })
    }

    validateTimelineGroupColumnSchemaChildren(node.children, diagnostics)
  }
}

function validateTimelineMarqueeSelectionNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-marquee-selection-child',
        message: 'TimelineChart.MarqueeSelection поддерживает только slot #box.',
      })
    }

    for (const slotName of Object.keys(node.slots)) {
      if (slotName !== 'box') {
        diagnostics.push({
          severity: 'error',
          code: 'timeline-marquee-selection-slot',
          message: 'TimelineChart.MarqueeSelection поддерживает только #box.',
        })
      }
    }

    validateTimelineGroupColumnSchemaChildren(node.slots.box?.children ?? [], diagnostics)
  }
}

function validateTimelineMarkerNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (node.tag === 'TimelineChart.Markers') {
      for (const slotName of Object.keys(node.slots)) {
        if (slotName !== 'body' && slotName !== 'label') {
          diagnostics.push({
            severity: 'error',
            code: 'timeline-markers-slot',
            message: 'TimelineChart.Markers поддерживает только #body и #label.',
          })
        }
      }
      for (const child of node.children) {
        if (child.tag !== 'TimelineChart.Marker' && child.tag !== 'template') {
          diagnostics.push({
            severity: 'error',
            code: 'timeline-markers-child',
            message: 'TimelineChart.Markers поддерживает только вложенные TimelineChart.Marker и <template src>.',
          })
        }
      }
      validateTimelineGroupColumnSchemaChildren(node.slots.body?.children ?? [], diagnostics)
      validateTimelineGroupColumnSchemaChildren(node.slots.label?.children ?? [], diagnostics)
      validateTimelineMarkerNodes(node.children.filter(child => child.tag === 'TimelineChart.Marker'), diagnostics)
      continue
    }

    if (node.tag !== 'TimelineChart.Marker') continue

    if (!readTimelineMarkerAttr(node, 'kind')) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-marker-kind',
        message: '<TimelineChart.Marker> требует kind.',
      })
    }

    for (const slotName of Object.keys(node.slots)) {
      if (slotName !== 'default' && slotName !== 'body' && slotName !== 'label') {
        diagnostics.push({
          severity: 'error',
          code: 'timeline-marker-slot',
          message: 'TimelineChart.Marker поддерживает только #default, #body и #label.',
        })
      }
    }

    validateTimelineGroupColumnSchemaChildren(node.slots.default?.children ?? [], diagnostics)
    validateTimelineGroupColumnSchemaChildren(node.slots.body?.children ?? [], diagnostics)
    validateTimelineGroupColumnSchemaChildren(node.slots.label?.children ?? [], diagnostics)
  }
}

function validateTimelineGroupsPanelNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    const slotNames = Object.keys(node.slots)
    for (const slotName of slotNames) {
      if (slotName !== 'background' && slotName !== 'overlay') {
        diagnostics.push({
          severity: 'error',
          code: 'timeline-groups-panel-slot',
          message: 'TimelineChart.GroupsPanel поддерживает только #background, #overlay и вложенные TimelineChart.GroupColumn.',
        })
      }
    }

    for (const child of node.children) {
      if (child.tag !== 'TimelineChart.GroupColumn' && child.tag !== 'template') {
        diagnostics.push({
          severity: 'error',
          code: 'timeline-groups-panel-child',
          message: 'TimelineChart.GroupsPanel поддерживает только #background, #overlay, <template src> и TimelineChart.GroupColumn.',
        })
      }
    }

    validateTimelineGroupColumnSchemaChildren(node.slots.background?.children ?? [], diagnostics)
    validateTimelineGroupColumnSchemaChildren(node.slots.overlay?.children ?? [], diagnostics)
    validateTimelineGroupColumnNodes(collectTimelineGroupColumnNodes(node.children), diagnostics)
  }
}

function validateTimelineGroupColumnNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (!readAttr(node, 'id')) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-group-column-id',
        message: '<TimelineChart.GroupColumn> требует статический id.',
      })
    }

    const slotNames = Object.keys(node.slots)
    for (const slotName of slotNames) {
      if (slotName !== 'cell' && slotName !== 'header') {
        diagnostics.push({
          severity: 'error',
          code: 'timeline-group-column-slot',
          message: 'TimelineChart.GroupColumn поддерживает только #cell и #header.',
        })
      }
    }

    validateTimelineGroupColumnSchemaChildren(node.slots.cell?.children ?? [], diagnostics)
    validateTimelineGroupColumnSchemaChildren(node.slots.header?.children ?? [], diagnostics)
  }
}

function validateTimelineGroupColumnSchemaChildren(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (node.tag === 'template') {
      validateTimelineGroupColumnSchemaChildren(node.children, diagnostics)
      continue
    }

    if (!TIMELINE_GROUP_SCHEMA_TAGS.has(node.tag)) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-group-column-unsupported-node',
        message: `TimelineChart.GroupColumn schema slots поддерживают только Rect, Line, Circle, Icon, Text, TextBlock и ProgressRing. Получен <${node.tag}>.`,
      })
      continue
    }
    validateTimelineGroupColumnSchemaChildren(node.children, diagnostics)
  }
}

function generateTimelineGroupColumnTemplates(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const entries = nodes.map(node => {
    const id = readAttr(node, 'id') ?? ''
    const cellSlot = node.slots.cell
    const headerSlot = node.slots.header
    const cell = cellSlot
      ? `cell:(__timelineGroupColumn) => {
          const ctx = __timelineGroupColumn;
          const group = ctx.group;
          const column = ctx.column;
          const data = ctx.data;
          const x = ctx.x;
          const y = ctx.y;
          const width = ctx.width;
          const height = ctx.height;
          const treeDisclosureColumn = ctx.treeDisclosureColumn;
          const treeIndent = ctx.treeIndent;
          const api = ctx.api;
          const chart = ctx.chart;
          return ${generateTimelineGroupColumnSchemaSequence(cellSlot.children, context)};
        }`
      : ''
    const header = headerSlot
      ? `header:(__timelineGroupColumnHeader) => {
          const ctx = __timelineGroupColumnHeader;
          const column = ctx.column;
          const x = ctx.x;
          const y = ctx.y;
          const width = ctx.width;
          const height = ctx.height;
          const api = ctx.api;
          const chart = ctx.chart;
          return ${generateTimelineGroupColumnSchemaSequence(headerSlot.children, context)};
        }`
      : ''
    return `${quoteKey(id)}:{${[cell, header].filter(Boolean).join(',')}}`
  })

  return `{${entries.join(',')}}`
}

function generateTimelineGroupPanelTemplate(nodes: Array<TemplateNode>, context: GenerateContext): string {
  return `(__timelineGroupPanel) => {
    const ctx = __timelineGroupPanel;
    const x = ctx.x;
    const y = ctx.y;
    const width = ctx.width;
    const height = ctx.height;
    const headerHeight = ctx.headerHeight;
    const bodyY = ctx.bodyY;
    const bodyHeight = ctx.bodyHeight;
    const columns = ctx.columns;
    const columnRects = ctx.columnRects;
    const visibleGroups = ctx.visibleGroups;
    const api = ctx.api;
    const chart = ctx.chart;
    return ${generateTimelineGroupColumnSchemaSequence(nodes, context)};
  }`
}

function generateTimelineGridTemplate(nodes: Array<TemplateNode>, context: GenerateContext): string {
  return `(__timelineGrid) => {
    const ctx = __timelineGrid;
    const x = ctx.x;
    const y = ctx.y;
    const width = ctx.width;
    const height = ctx.height;
    const verticalLines = ctx.verticalLines;
    const horizontalLines = ctx.horizontalLines;
    const api = ctx.api;
    const chart = ctx.chart;
    const store = ctx.store;
    return ${generateTimelineGroupColumnSchemaSequence(nodes, context)};
  }`
}

function generateTimelineMarqueeSelectionConfig(node: TemplateNode, context: GenerateContext): string {
  const entries: Array<string> = []

  for (const [attr, target] of [
    ['id', 'id'],
    ['enabled', 'enabled'],
    ['controller', 'controller'],
    ['mode', 'mode'],
    ['hitMode', 'hitMode'],
    ['hit-mode', 'hitMode'],
    ['minDragPx', 'minDragPx'],
    ['min-drag-px', 'minDragPx'],
    ['style', 'style'],
    ['layer', 'layer'],
    ['once', 'once'],
  ] as const) {
    const value = readTimelineMarkerAttr(node, attr)
    if (value && !entries.some(entry => entry.startsWith(`${target}:`) || entry.startsWith(`${quoteKey(target)}:`))) {
      entries.push(`${target}:${value}`)
    }
  }

  const renderBox = generateTimelineMarqueeSelectionSlotRenderer(node, context)
  if (renderBox) entries.push(renderBox)

  return `{${entries.join(',')}}`
}

function generateTimelineMarqueeSelectionSlotRenderer(node: TemplateNode, context: GenerateContext): string {
  const slot = node.slots.box
  if (!slot) return ''

  return `renderBox:(__timelineMarqueeSelection) => {
    const ctx = __timelineMarqueeSelection;
    const rect = ctx.rect;
    const style = ctx.style;
    const defaultRender = ctx.defaultRender;
    const api = ctx.api;
    const chart = ctx.chart;
    const store = ctx.store;
    return ${generateTimelineGroupColumnSchemaSequence(slot.children, context)};
  }`
}

function generateTimelineMarkersConfig(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const entries: Array<string> = []
  const markerEntries: Array<string> = []

  for (const node of nodes) {
    markerEntries.push(...node.children
      .filter(child => child.tag === 'TimelineChart.Marker')
      .map(child => generateTimelineMarkerConfig(child, context)))

    const items = readTimelineMarkerAttr(node, 'items')
    if (items) entries.push(`value:${items}`)

    const controller = readTimelineMarkerAttr(node, 'controller')
    if (controller) entries.push(`controller:${controller}`)

    const defaults = readTimelineMarkerAttr(node, 'defaults')
    if (defaults) entries.push(`placement:${generateTimelineMarkerPlacementFromDefaults(defaults)}`)

    const markerLevelProps = new Set<string>()
    for (const [attr, target] of [
      ['create', 'create'],
      ['labels', 'labels'],
      ['today', 'today'],
      ['color', 'color'],
      ['intervalColor', 'intervalColor'],
      ['interval-color', 'intervalColor'],
      ['lineWidth', 'lineWidth'],
      ['line-width', 'lineWidth'],
      ['bodyLayer', 'bodyLayer'],
      ['body-layer', 'bodyLayer'],
      ['labelLayer', 'labelLayer'],
      ['label-layer', 'labelLayer'],
    ] as const) {
      const value = readTimelineMarkerAttr(node, attr)
      if (value && !markerLevelProps.has(target)) {
        markerLevelProps.add(target)
        entries.push(`${target}:${value}`)
      }
    }

    const placement = generateTimelineMarkerPlacementEntry(node)
    if (placement) entries.push(placement)

    const bodyRenderer = generateTimelineMarkerSlotRenderer(node, context, 'body', 'renderBody')
    if (bodyRenderer) entries.push(bodyRenderer)

    const labelRenderer = generateTimelineMarkerSlotRenderer(node, context, 'label', 'renderLabel')
    if (labelRenderer) entries.push(labelRenderer)
  }

  if (markerEntries.length > 0) entries.push(`defaultValue:[${markerEntries.join(',')}]`)
  return `{${entries.join(',')}}`
}

function generateTimelineMarkerConfig(node: TemplateNode, context: GenerateContext): string {
  const entries = [
    timelineMarkerEntry(node, 'id'),
    timelineMarkerEntry(node, 'kind'),
    timelineMarkerEntry(node, 'time'),
    timelineMarkerEntry(node, 'startTime') || timelineMarkerEntry(node, 'start-time', 'startTime'),
    timelineMarkerEntry(node, 'endTime') || timelineMarkerEntry(node, 'end-time', 'endTime'),
    timelineMarkerEntry(node, 'hours'),
    timelineMarkerEntry(node, 'label'),
    timelineMarkerEntry(node, 'color'),
    timelineMarkerEntry(node, 'enabled'),
    timelineMarkerEntry(node, 'lineWidth') || timelineMarkerEntry(node, 'line-width', 'lineWidth'),
    generateTimelineMarkerPlacementEntry(node),
    generateTimelineMarkerSlotRenderer(node, context, 'default', 'renderMarker'),
    generateTimelineMarkerSlotRenderer(node, context, 'body', 'renderBody'),
    generateTimelineMarkerSlotRenderer(node, context, 'label', 'renderLabel'),
  ].filter(Boolean)

  return `{${entries.join(',')}}`
}

function generateTimelineMarkerPlacementEntry(node: TemplateNode): string {
  const placement = readTimelineMarkerAttr(node, 'placement')
  const line = readTimelineMarkerAttr(node, 'line')
  const label = readTimelineMarkerAttr(node, 'labelPlacement') ?? readTimelineMarkerAttr(node, 'label-placement')
  const range = readTimelineMarkerAttr(node, 'range')

  if (!placement && !line && !label && !range) return ''

  const entries = [
    placement ? `...(${placement})` : '',
    line ? `line:${line}` : '',
    label ? `label:${label}` : '',
    range ? `range:${range}` : '',
  ].filter(Boolean)

  return `placement:{${entries.join(',')}}`
}

function generateTimelineMarkerPlacementFromDefaults(defaults: string): string {
  return `(() => {
    const __timelineMarkerDefaults = ${defaults};
    return {
      ...(__timelineMarkerDefaults.placement ?? {}),
      ...(__timelineMarkerDefaults.line ? { line: __timelineMarkerDefaults.line } : {}),
      ...(__timelineMarkerDefaults.label ? { label: __timelineMarkerDefaults.label } : {}),
      ...(__timelineMarkerDefaults.labelPlacement ? { label: __timelineMarkerDefaults.labelPlacement } : {}),
      ...(__timelineMarkerDefaults.range ? { range: __timelineMarkerDefaults.range } : {}),
    };
  })()`
}

function generateTimelineMarkerSlotRenderer(
  node: TemplateNode,
  context: GenerateContext,
  slotName: 'default' | 'body' | 'label',
  targetName: 'renderMarker' | 'renderBody' | 'renderLabel',
): string {
  const slot = node.slots[slotName]
  if (!slot) return ''

  return `${targetName}:(__timelineMarker) => {
    const ctx = __timelineMarker;
    const marker = ctx.marker;
    const rects = ctx.rects;
    const timeToPx = ctx.timeToPx;
    const pxToTime = ctx.pxToTime;
    const api = ctx.api;
    const state = ctx.state;
    const defaultRender = ctx.defaultRender;
    return ${generateTimelineGroupColumnSchemaSequence(slot.children, context)};
  }`
}

function timelineMarkerEntry(node: TemplateNode, name: string, targetName = normalizeDslPropName(name)): string {
  const value = readTimelineMarkerAttr(node, name)
  return value ? `${quoteKey(targetName)}:${value}` : ''
}

function readTimelineMarkerAttr(node: TemplateNode, name: string): string | undefined {
  const normalizedName = normalizeDslPropName(name)
  const dynamic = readAttr(node, `:${name}`) ?? readAttr(node, `:${normalizedName}`)
  if (dynamic !== undefined) return dynamic
  const staticValue = readAttr(node, name) ?? readAttr(node, normalizedName)
  if (staticValue !== undefined) return serializeStaticAttr(staticValue)
  if (Object.prototype.hasOwnProperty.call(node.attrs, name) || Object.prototype.hasOwnProperty.call(node.attrs, normalizedName)) {
    return 'true'
  }
  return undefined
}

function generateTimelineGroupColumnSchemaSequence(nodes: Array<TemplateNode>, context: GenerateContext): string {
  return `[${nodes.map(node => generateTimelineGroupColumnSchemaNode(node, context)).join(',')}].flat().filter(Boolean)`
}

function generateTimelineGroupColumnSchemaNode(node: TemplateNode, context: GenerateContext): string {
  const loop = readAttr(node, 'for')
  if (loop) {
    const parsed = parseForExpression(loop)
    if (!parsed) {
      context.diagnostics.push({
        severity: 'error',
        code: 'invalid-for',
        message: `Некорректное выражение for на <${node.tag}>.`,
      })
      return 'null'
    }

    const attrs = { ...node.attrs }
    delete attrs.for
    delete attrs[':for']

    return `__novaFor(${parsed.source}).flatMap((${parsed.item}, ${parsed.index}) => [${generateTimelineGroupColumnSchemaNode({ ...node, attrs }, context)}])`
  }

  const condition = readAttr(node, 'if')
  if (node.tag === 'template') {
    const schema = generateTimelineGroupColumnSchemaSequence(node.children, context)
    return condition ? `((${condition}) ? ${schema} : [])` : schema
  }

  const schema = generateTimelineGroupColumnSchema(node, context)
  return condition ? `((${condition}) ? ${schema} : null)` : schema
}

function generateTimelineGroupColumnSchema(node: TemplateNode, context: GenerateContext): string {
  if (node.tag === 'Rect') return generateTimelineGroupRectSchema(node, context)
  if (node.tag === 'Line') return generateTimelineGroupLineSchema(node)
  if (node.tag === 'Circle') return generateTimelineGroupCircleSchema(node)
  if (node.tag === 'Icon') return generateTimelineGroupIconSchema(node, context)
  if (node.tag === 'Text' || node.tag === 'TextBlock') return generateTimelineGroupTextSchema(node)
  if (node.tag === 'ProgressRing') return generateTimelineGroupProgressRingSchema(node)

  context.diagnostics.push({
    severity: 'error',
    code: 'timeline-group-column-unsupported-node',
    message: `TimelineChart.GroupColumn schema slots поддерживают только Rect, Line, Circle, Icon, Text, TextBlock и ProgressRing. Получен <${node.tag}>.`,
  })
  return 'null'
}

function generateTimelineGroupRectSchema(node: TemplateNode, context: GenerateContext): string {
  const styleEntries = [
    groupBackgroundStyleEntry(node, context),
    groupStyleEntry(node, 'radius'),
    groupStyleEntry(node, 'border'),
    groupStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'rect\'',
    `x:${groupAttr(node, 'x', 'x')}`,
    `y:${groupAttr(node, 'y', 'y')}`,
    `width:${groupAttr(node, 'width', 'width')}`,
    `height:${groupAttr(node, 'height', 'height')}`,
    ...groupCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineGroupLineSchema(node: TemplateNode): string {
  const styleEntries = [
    groupStyleEntry(node, 'color'),
    groupStyleEntry(node, 'width'),
    groupStyleEntry(node, 'dashPattern'),
    groupStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'line\'',
    `x1:${groupAttr(node, 'x1', 'x')}`,
    `y1:${groupAttr(node, 'y1', 'y')}`,
    `x2:${groupAttr(node, 'x2', 'x + width')}`,
    `y2:${groupAttr(node, 'y2', 'y')}`,
    ...groupCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineGroupCircleSchema(node: TemplateNode): string {
  const styleEntries = [
    groupStyleEntry(node, 'background'),
    groupStyleEntry(node, 'border'),
    groupStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'circle\'',
    `x:${groupAttr(node, 'x', 'x')}`,
    `y:${groupAttr(node, 'y', 'y')}`,
    `radius:${groupAttr(node, 'radius', '4')}`,
    ...groupCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineGroupIconSchema(node: TemplateNode, context: GenerateContext): string {
  const styleEntries = [
    groupStyleEntry(node, 'opacity'),
    groupStyleEntry(node, 'quality'),
  ].filter(Boolean)
  const entries = [
    'type:\'icon\'',
    `icon:${groupIconAttr(node, context)}`,
    `x:${groupAttr(node, 'x', 'x')}`,
    `y:${groupAttr(node, 'y', 'y')}`,
    `width:${groupAttr(node, 'width', 'width')}`,
    `height:${groupAttr(node, 'height', 'height')}`,
    ...groupCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineGroupTextSchema(node: TemplateNode): string {
  const styleEntries = [
    groupStyleEntry(node, 'color'),
    groupStyleEntry(node, 'font'),
    groupStyleEntry(node, 'lineHeight'),
    groupStyleEntry(node, 'padding'),
    groupStyleEntry(node, 'align'),
    groupStyleEntry(node, 'ellipsis'),
    groupStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'text\'',
    `text:${groupAttr(node, 'text', "''")}`,
    `x:${groupAttr(node, 'x', 'x')}`,
    `y:${groupAttr(node, 'y', 'y')}`,
    `width:${groupAttr(node, 'width', 'width')}`,
    `height:${groupAttr(node, 'height', 'height')}`,
    ...groupCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineGroupProgressRingSchema(node: TemplateNode): string {
  const entries = [
    `x:${groupAttr(node, 'x', 'x')}`,
    `y:${groupAttr(node, 'y', 'y')}`,
    `value:${groupAttr(node, 'value', '0')}`,
    groupEntry(node, 'size'),
    groupEntry(node, 'strokeWidth') || groupEntry(node, 'stroke-width', 'strokeWidth'),
    groupEntry(node, 'color'),
    groupEntry(node, 'trackColor') || groupEntry(node, 'track-color', 'trackColor'),
    groupEntry(node, 'opacity'),
    groupEntry(node, 'lineCap') || groupEntry(node, 'line-cap', 'lineCap'),
  ].filter(Boolean)
  return `__NovaUIKit.progressRingSchema({${entries.join(',')}})`
}

function groupCommonEntries(node: TemplateNode): Array<string> {
  return [
    groupEntry(node, 'active'),
    groupEntry(node, 'clip'),
    groupEntry(node, 'class'),
    groupEntry(node, 'className') || groupEntry(node, 'class-name', 'className'),
    groupEntry(node, 'attrs'),
    groupEntry(node, 'style'),
    groupEntry(node, 'meta'),
  ].filter(Boolean)
}

function groupStyleEntry(node: TemplateNode, name: string): string {
  const staticThemeToken = groupStaticThemeTokenAttr(node, name)
  if (staticThemeToken) return `${quoteKey(name)}:${staticThemeToken}`

  const value = groupAttr(node, name)
  return value ? `${quoteKey(name)}:${value}` : ''
}

function groupBackgroundStyleEntry(node: TemplateNode, context: GenerateContext): string {
  const dynamicFillPattern = readAttr(node, ':fill-pattern') ?? readAttr(node, ':fillPattern')
  if (dynamicFillPattern) {
    return `background:${generateDynamicLocalAssetRef(context, dynamicFillPattern, ['fill'])}`
  }

  const fillPattern = readAttr(node, 'fill-pattern') ?? readAttr(node, 'fillPattern')
  if (fillPattern) {
    const ref = resolveLocalAssetRef(context, fillPattern, ['fill'])
    if (!ref) {
      context.diagnostics.push({
        severity: 'error',
        code: 'unknown-fill-pattern',
        message: `Fill pattern "${fillPattern}" не объявлен через <Nova.Assets>.`,
      })
      return ''
    }
    return `background:${ref}`
  }

  const background = readAttr(node, 'background')
  if (background && isAssetPath(background)) {
    return `background:${registerPathAsset(context, { request: background, from: node.filename })}`
  }
  const themeTokenBackground = groupStaticThemeTokenAttr(node, 'background')
  if (themeTokenBackground) return `background:${themeTokenBackground}`

  return groupStyleEntry(node, 'background')
}

function groupStaticThemeTokenAttr(node: TemplateNode, name: string): string {
  const normalizedName = normalizeDslPropName(name)
  if (readAttr(node, `:${name}`) !== undefined || readAttr(node, `:${normalizedName}`) !== undefined) return ''

  const staticValue = readAttr(node, name) ?? readAttr(node, normalizedName)
  return staticValue ? generateThemeTokenResolver(staticValue) : ''
}

function groupIconAttr(node: TemplateNode, context: GenerateContext): string {
  const icon = groupAttr(node, 'icon')
  if (icon) return icon

  const source = readAttr(node, 'src') ?? readAttr(node, 'source')
  if (source && isAssetPath(source)) {
    const color = readAttr(node, 'asset-color') ?? readAttr(node, 'assetColor')
    return registerPathAsset(context, { request: source, color, from: node.filename })
  }

  return "''"
}

function groupEntry(node: TemplateNode, name: string, targetName = name): string {
  const value = groupAttr(node, name)
  return value ? `${quoteKey(targetName)}:${value}` : ''
}

function groupAttr(node: TemplateNode, name: string, fallback?: string): string {
  const normalizedName = normalizeDslPropName(name)
  const dynamic = readAttr(node, `:${name}`) ?? readAttr(node, `:${normalizedName}`)
  if (dynamic !== undefined) return dynamic
  const staticValue = readAttr(node, name) ?? readAttr(node, normalizedName)
  if (staticValue !== undefined) return serializeStaticAttr(staticValue)
  if (Object.prototype.hasOwnProperty.call(node.attrs, name) || Object.prototype.hasOwnProperty.call(node.attrs, normalizedName)) {
    return 'true'
  }
  return fallback ?? ''
}

function generateTimelinePointProfileEntry(node: TemplateNode): string {
  const id = readAttr(node, 'id') ?? 'default'
  const recipeEntries = [
    timelineRecipeEntry(node, 'shape', ['shape']),
    timelineRecipeEntry(node, 'size', ['size']),
    timelineRecipeEntry(node, 'fill', ['fill']),
    timelineRecipeEntry(node, 'stroke', ['stroke']),
    timelineRecipeEntry(node, 'strokeWidth', ['stroke-width', 'strokeWidth']),
    timelineRecipeEntry(node, 'selectedFill', ['selected-fill', 'selectedFill']),
    timelineRecipeEntry(node, 'selectedStroke', ['selected-stroke', 'selectedStroke']),
    timelineRecipeEntry(node, 'selectedStrokeWidth', ['selected-stroke-width', 'selectedStrokeWidth']),
    timelineRecipeEntry(node, 'hoveredFill', ['hovered-fill', 'hoveredFill']),
    timelineRecipeEntry(node, 'hoveredStroke', ['hovered-stroke', 'hoveredStroke']),
    timelineRecipeEntry(node, 'hoveredStrokeWidth', ['hovered-stroke-width', 'hoveredStrokeWidth']),
    timelineRecipeEntry(node, 'handleFill', ['handle-fill', 'handleFill']),
    timelineRecipeEntry(node, 'handleStroke', ['handle-stroke', 'handleStroke']),
    timelineRecipeEntry(node, 'handleSize', ['handle-size', 'handleSize']),
    timelineRecipeEntry(node, 'selectable', ['selectable']),
    timelineRecipeEntry(node, 'editable', ['editable']),
    timelineRecipeEntry(node, 'ports', ['ports']),
    timelineRecipeEntry(node, 'icon', ['icon']),
    timelineRecipeEntry(node, 'interaction', ['interaction']),
    timelineHitAreaEntry(node),
    timelinePointLabelEntry(node),
  ].filter(Boolean)

  return `${quoteKey(id)}:{recipe:{${recipeEntries.join(',')}}}`
}

function generateTimelineLinkProfileEntry(node: TemplateNode): string {
  const id = readAttr(node, 'id') ?? 'default'
  const recipeEntries = [
    timelineRecipeEntry(node, 'stroke', ['stroke']),
    timelineRecipeEntry(node, 'width', ['width']),
    timelineRecipeEntry(node, 'selectedStroke', ['selected-stroke', 'selectedStroke']),
    timelineRecipeEntry(node, 'selectedWidth', ['selected-width', 'selectedWidth']),
    timelineRecipeEntry(node, 'hoveredStroke', ['hovered-stroke', 'hoveredStroke']),
    timelineRecipeEntry(node, 'hoveredWidth', ['hovered-width', 'hoveredWidth']),
    timelineRecipeEntry(node, 'handleFill', ['handle-fill', 'handleFill']),
    timelineRecipeEntry(node, 'handleStroke', ['handle-stroke', 'handleStroke']),
    timelineRecipeEntry(node, 'handleSize', ['handle-size', 'handleSize']),
    timelineRecipeEntry(node, 'routeHandleFill', ['route-handle-fill', 'routeHandleFill']),
    timelineRecipeEntry(node, 'routeHandleStroke', ['route-handle-stroke', 'routeHandleStroke']),
    timelineRecipeEntry(node, 'routeHandleSize', ['route-handle-size', 'routeHandleSize']),
    timelineRecipeEntry(node, 'selectable', ['selectable']),
    timelineRecipeEntry(node, 'editable', ['editable']),
    timelineRecipeEntry(node, 'ports', ['ports']),
    timelineRecipeEntry(node, 'pattern', ['pattern']),
    timelineRecipeEntry(node, 'dash', ['dash']),
    timelineRecipeEntry(node, 'dotSpacing', ['dot-spacing', 'dotSpacing']),
    timelineRecipeEntry(node, 'cap', ['cap']),
    timelineRecipeEntry(node, 'markerStart', ['marker-start', 'markerStart']),
    timelineRecipeEntry(node, 'markerEnd', ['marker-end', 'markerEnd']),
    timelineRecipeEntry(node, 'interaction', ['interaction']),
    timelineLinkRoutingEntry(node),
    timelineLinkLabelEntry(node),
  ].filter(Boolean)

  return `${quoteKey(id)}:{recipe:{${recipeEntries.join(',')}}}`
}

function generateTimelineBackgroundProfileEntry(node: TemplateNode): string {
  const id = readAttr(node, 'id') ?? 'default'
  const fill = timelineRecipeValue(node, ['fill', 'background'])
  const radius = timelineRecipeValue(node, ['radius'])
  const borderColor = timelineRecipeValue(node, ['stroke', 'border-color', 'borderColor'])
  const borderWidth = timelineRecipeValue(node, ['stroke-width', 'strokeWidth', 'border-width', 'borderWidth'])
  const borderDash = timelineRecipeValue(node, ['dash', 'border-dash', 'borderDash'])
  const recipeEntries = [
    fill ? `body:{rect:{background:${fill}${radius ? `,radius:${radius}` : ''}}}` : '',
    borderColor || borderWidth || borderDash
      ? `border:{rect:{border:{${[
          borderColor ? `color:${borderColor}` : '',
          borderWidth ? `width:${borderWidth}` : '',
          borderDash ? `dash:${borderDash}` : '',
        ].filter(Boolean).join(',')}}}}`
      : '',
  ].filter(Boolean)

  return `${quoteKey(id)}:{recipe:{${recipeEntries.join(',')}}}`
}

function timelinePointLabelEntry(node: TemplateNode): string {
  const text = timelineRecipeValue(node, ['label-text', 'labelText']) ?? 'point => point.label'
  const entries = [
    `text:${text}`,
    timelineRecipeEntry(node, 'position', ['label-position', 'labelPosition']),
    timelineRecipeEntry(node, 'offset', ['label-offset', 'labelOffset']),
    timelineRecipeEntry(node, 'color', ['label-color', 'labelColor']),
    timelineRecipeEntry(node, 'width', ['label-width', 'labelWidth']),
    timelineRecipeEntry(node, 'height', ['label-height', 'labelHeight']),
    timelineRecipeEntry(node, 'interaction', ['label-interaction', 'labelInteraction']),
  ].filter(Boolean)

  return entries.length > 1 ? `label:{${entries.join(',')}}` : ''
}

function timelineLinkLabelEntry(node: TemplateNode): string {
  const text = timelineRecipeValue(node, ['label-text', 'labelText'])
  if (!text) return ''
  const entries = [
    `text:${text}`,
    timelineRecipeEntry(node, 'position', ['label-position', 'labelPosition']),
    timelineRecipeEntry(node, 'offset', ['label-offset', 'labelOffset']),
    timelineRecipeEntry(node, 'color', ['label-color', 'labelColor']),
    timelineRecipeEntry(node, 'width', ['label-width', 'labelWidth']),
    timelineRecipeEntry(node, 'height', ['label-height', 'labelHeight']),
    timelineRecipeEntry(node, 'interaction', ['label-interaction', 'labelInteraction']),
  ].filter(Boolean)

  return `label:{${entries.join(',')}}`
}

function timelineHitAreaEntry(node: TemplateNode): string {
  const padding = timelineRecipeValue(node, ['hit-padding', 'hitPadding'])
  return padding ? `hitArea:{padding:${padding}}` : ''
}

function timelineLinkRoutingEntry(node: TemplateNode): string {
  const dynamicRouting = readAnyDynamicTimelineAttr(node, ['routing'])
  if (dynamicRouting) return `routing:${dynamicRouting}`

  const routingType = readAnyStaticTimelineAttr(node, ['routing', 'routing-type', 'routingType', 'type'])
  const entries = [
    routingType ? `type:${serializeStaticAttr(routingType)}` : '',
    timelineRecipeEntry(node, 'fromPort', ['from-port', 'fromPort']),
    timelineRecipeEntry(node, 'toPort', ['to-port', 'toPort']),
    timelineRecipeEntry(node, 'elbow', ['elbow']),
    timelineRecipeEntry(node, 'curvature', ['curvature']),
    timelineRecipeEntry(node, 'controlOffset', ['control-offset', 'controlOffset']),
    timelineRecipeEntry(node, 'cornerRadius', ['corner-radius', 'cornerRadius']),
    timelineRecipeEntry(node, 'avoid', ['avoid']),
    timelineRecipeEntry(node, 'bundle', ['bundle']),
  ].filter(Boolean)

  return entries.length > 0 ? `routing:{${entries.join(',')}}` : ''
}

function timelineRecipeEntry(node: TemplateNode, key: string, names: Array<string>): string {
  const value = timelineRecipeValue(node, names)
  return value ? `${key}:${value}` : ''
}

function timelineRecipeValue(node: TemplateNode, names: Array<string>): string | null {
  const dynamicValue = readAnyDynamicTimelineAttr(node, names)
  if (dynamicValue) return dynamicValue
  const staticValue = readAnyStaticTimelineAttr(node, names)
  return staticValue ? serializeStaticAttr(staticValue) : null
}

function readAnyDynamicTimelineAttr(node: TemplateNode, names: Array<string>): string | undefined {
  for (const name of names) {
    const value = readAttr(node, `:${name}`)
    if (value) return value
  }
  return undefined
}

function readAnyStaticTimelineAttr(node: TemplateNode, names: Array<string>): string | undefined {
  for (const name of names) {
    const value = readAttr(node, name)
    if (value) return value
  }
  return undefined
}

function validateTimelineTaskProfileNodes(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (node.tag !== 'TimelineTaskProfile') {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-profile-root',
        message: 'Timeline profile DSL поддерживает только top-level <TimelineTaskProfile>.',
      })
      continue
    }

    if (!readAttr(node, 'name')) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-profile-name',
        message: '<TimelineTaskProfile> требует статический name.',
      })
    }

    if (Object.keys(node.slots).some(name => name !== 'default')) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-profile-slot',
        message: 'TimelineTaskProfile поддерживает только default slot для внешнего template body.',
      })
    }

    validateTimelineTaskProfileChildren(resolveTimelineTaskProfileChildren(node), diagnostics)
  }
}

function validateTimelineTaskProfileChildren(
  nodes: Array<TemplateNode>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): void {
  for (const node of nodes) {
    if (!TIMELINE_PROFILE_PRIMITIVE_TAGS.has(node.tag)) {
      diagnostics.push({
        severity: 'error',
        code: 'timeline-profile-unsupported-node',
        message: `TimelineTaskProfile пока поддерживает только Rect, Icon, Text и TextBlock. Получен <${node.tag}>.`,
      })
      continue
    }
    validateTimelineTaskProfileChildren(node.children, diagnostics)
  }
}

function generateTimelineTaskProfiles(nodes: Array<TemplateNode>, context: GenerateContext): string {
  const entries = nodes
    .filter(node => node.tag === 'TimelineTaskProfile')
    .map(node => {
      const name = readAttr(node, 'name') ?? 'default'
      const contract = readAttr(node, ':contract')
        ? `,contract:${readAttr(node, ':contract')}`
        : readAttr(node, 'contract')
          ? `,contract:${serializeStaticAttr(readAttr(node, 'contract')!)}`
          : ''
      const selectionHighlight = readAttr(node, ':selection-highlight')
        ? `,selectionHighlight:${readAttr(node, ':selection-highlight')}`
        : readAttr(node, ':selectionHighlight')
          ? `,selectionHighlight:${readAttr(node, ':selectionHighlight')}`
          : readAttr(node, 'selection-highlight')
            ? `,selectionHighlight:${serializeStaticAttr(readAttr(node, 'selection-highlight')!)}`
            : readAttr(node, 'selectionHighlight')
              ? `,selectionHighlight:${serializeStaticAttr(readAttr(node, 'selectionHighlight')!)}`
              : ''

      return `${quoteKey(name)}:{
        schema:(__timelineTask) => {
          const runtimeTask = __timelineTask;
          const task = runtimeTask.item;
          const group = runtimeTask.group?.item ?? null;
          const width = runtimeTask.width;
          const height = runtimeTask.height;
          const x = runtimeTask.x;
          const y = runtimeTask.y;
          const selected = runtimeTask.isSelected;
          const ctx = runtimeTask;
          return ${generateTimelineProfileNodeSequence(resolveTimelineTaskProfileChildren(node), context)};
        }${contract}${selectionHighlight}
      }`
    })

  return `{defaultProfileId:'default',profiles:{${entries.join(',')}}}`
}

function resolveTimelineTaskProfileChildren(node: TemplateNode): Array<TemplateNode> {
  return node.children.length > 0 ? node.children : node.slots.default?.children ?? []
}

function generateTimelineProfileNodeSequence(nodes: Array<TemplateNode>, context: GenerateContext): string {
  return `[${nodes.map(node => generateTimelineProfileNode(node, context)).join(',')}].flat().filter(Boolean)`
}

function generateTimelineProfileNode(node: TemplateNode, context: GenerateContext): string {
  const condition = readAttr(node, 'if')
  const schema = generateTimelineProfileSchema(node, context)
  return condition ? `((${condition}) ? ${schema} : null)` : schema
}

function generateTimelineProfileSchema(node: TemplateNode, context: GenerateContext): string {
  if (node.tag === 'Rect') {
    return generateTimelineRectSchema(node, context)
  }
  if (node.tag === 'Icon') {
    return generateTimelineIconSchema(node, context)
  }
  if (node.tag === 'Text' || node.tag === 'TextBlock') {
    return generateTimelineTextSchema(node)
  }

  context.diagnostics.push({
    severity: 'error',
    code: 'timeline-profile-unsupported-node',
    message: `TimelineTaskProfile пока поддерживает только Rect, Icon, Text и TextBlock. Получен <${node.tag}>.`,
  })
  return 'null'
}

function generateTimelineRectSchema(node: TemplateNode, context: GenerateContext): string {
  const styleEntries = [
    profileBackgroundStyleEntry(node, context),
    profileStyleEntry(node, 'radius'),
    profileStyleEntry(node, 'border'),
    profileStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'rect\'',
    `x:x + (${profileAttr(node, 'x', '0')})`,
    `y:y + (${profileAttr(node, 'y', '0')})`,
    `width:${profileAttr(node, 'width', 'width')}`,
    `height:${profileAttr(node, 'height', 'height')}`,
    ...profileCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]

  return `{${entries.join(',')}}`
}

function generateTimelineIconSchema(node: TemplateNode, context: GenerateContext): string {
  const styleEntries = [
    profileStyleEntry(node, 'opacity'),
    profileStyleEntry(node, 'quality'),
  ].filter(Boolean)
  const entries = [
    'type:\'icon\'',
    `icon:${profileIconAttr(node, context)}`,
    `x:x + (${profileAttr(node, 'x', '0')})`,
    `y:y + (${profileAttr(node, 'y', '0')})`,
    `width:${profileAttr(node, 'width', 'width')}`,
    `height:${profileAttr(node, 'height', 'height')}`,
    ...profileCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]
  return `{${entries.join(',')}}`
}

function generateTimelineTextSchema(node: TemplateNode): string {
  const styleEntries = [
    profileStyleEntry(node, 'color'),
    profileStyleEntry(node, 'font'),
    profileStyleEntry(node, 'lineHeight'),
    profileStyleEntry(node, 'padding'),
    profileStyleEntry(node, 'align'),
    profileStyleEntry(node, 'ellipsis'),
    profileStyleEntry(node, 'opacity'),
  ].filter(Boolean)
  const entries = [
    'type:\'text\'',
    `text:${profileAttr(node, 'text', "''")}`,
    `x:x + (${profileAttr(node, 'x', '0')})`,
    `y:y + (${profileAttr(node, 'y', '0')})`,
    `width:${profileAttr(node, 'width', 'width')}`,
    `height:${profileAttr(node, 'height', 'height')}`,
    ...profileCommonEntries(node),
    `styles:{${styleEntries.join(',')}}`,
  ]

  return `{${entries.join(',')}}`
}

function profileCommonEntries(node: TemplateNode): Array<string> {
  return [
    profileEntry(node, 'active'),
    profileEntry(node, 'clip'),
    profileEntry(node, 'class'),
    profileEntry(node, 'className') || profileEntry(node, 'class-name', 'className'),
    profileEntry(node, 'attrs'),
    profileEntry(node, 'style'),
    profileEntry(node, 'meta'),
  ].filter(Boolean)
}

function profileStyleEntry(node: TemplateNode, name: string): string {
  const value = profileAttr(node, name)
  return value ? `${quoteKey(name)}:${value}` : ''
}

function profileBackgroundStyleEntry(node: TemplateNode, context: GenerateContext): string {
  const fillPattern = readAttr(node, 'fill-pattern') ?? readAttr(node, 'fillPattern')
  if (fillPattern) {
    const ref = resolveLocalAssetRef(context, fillPattern, ['fill'])
    if (!ref) {
      context.diagnostics.push({
        severity: 'error',
        code: 'unknown-fill-pattern',
        message: `Fill pattern "${fillPattern}" не объявлен через <Nova.Assets>.`,
      })
      return ''
    }
    return `background:${ref}`
  }

  const background = readAttr(node, 'background')
  if (background && isAssetPath(background)) {
    return `background:${registerPathAsset(context, { request: background, from: node.filename })}`
  }

  return profileStyleEntry(node, 'background')
}

function profileIconAttr(node: TemplateNode, context: GenerateContext): string {
  const icon = profileAttr(node, 'icon')
  if (icon) return icon

  const source = readAttr(node, 'src') ?? readAttr(node, 'source')
  if (source && isAssetPath(source)) {
    const color = readAttr(node, 'asset-color') ?? readAttr(node, 'assetColor')
    return registerPathAsset(context, { request: source, color, from: node.filename })
  }

  return "''"
}

function profileEntry(node: TemplateNode, name: string, targetName = name): string {
  const value = profileAttr(node, name)
  return value ? `${quoteKey(targetName)}:${value}` : ''
}

function profileAttr(node: TemplateNode, name: string, fallback?: string): string {
  const dynamic = readAttr(node, `:${name}`)
  if (dynamic !== undefined) return dynamic
  const staticValue = readAttr(node, name)
  if (staticValue !== undefined) return serializeStaticAttr(staticValue)
  if (Object.prototype.hasOwnProperty.call(node.attrs, name)) return 'true'
  return fallback ?? ''
}

function generateTooltipsSchema(
  node: TemplateNode,
  context: GenerateContext,
  isTopLevelRoot: boolean,
): string {
  const definitions = node.children
    .filter(child => child.tag === 'Tooltip')
    .map(child => generateTooltipDefinition(child, context))
  const props = mergePropsCode(
    generateProps(node, context, false, isTopLevelRoot),
    `definitions:[${definitions.join(',')}]`,
  )
  const id = readAttr(node, ':id')
    ? `id:${readAttr(node, ':id')}`
    : readAttr(node, 'id')
      ? `id:${JSON.stringify(readAttr(node, 'id'))}`
      : ''
  return `{type:__NovaUIKit.Tooltips,${id ? `${id},` : ''}props:${props}}`
}

function generateTooltipDefinition(node: TemplateNode, context: GenerateContext): string {
  const typeExpression = readAttr(node, ':type')
    ?? (readAttr(node, 'type') ? JSON.stringify(readAttr(node, 'type')) : JSON.stringify('default'))
  const props = generateProps(node, context, false, false) || '{}'
  const slot = node.children.length > 0
    ? `,slot:(slot = {}) => { return ${generateNodeSequence(node.children, context)}; }`
    : ''
  return `{type:${typeExpression},props:${props}${slot}}`
}

function generateDialogsSchema(
  node: TemplateNode,
  context: GenerateContext,
  isTopLevelRoot: boolean,
): string {
  const definitions = node.children
    .filter(child => child.tag === 'Dialog')
    .map(child => generateDialogDefinition(child, context))
  const props = mergePropsCode(
    generateProps(node, context, false, isTopLevelRoot),
    `definitions:[${definitions.join(',')}]`,
  )
  const id = readAttr(node, ':id')
    ? `id:${readAttr(node, ':id')}`
    : readAttr(node, 'id')
      ? `id:${JSON.stringify(readAttr(node, 'id'))}`
      : ''
  return `{type:__NovaUIKit.Dialogs,${id ? `${id},` : ''}props:${props}}`
}

function generateDialogDefinition(node: TemplateNode, context: GenerateContext): string {
  const typeExpression = readAttr(node, ':type')
    ?? (readAttr(node, 'type') ? JSON.stringify(readAttr(node, 'type')) : JSON.stringify('default'))
  const props = generateProps(node, context, false, false) || '{}'
  const slot = node.children.length > 0
    ? `,slot:(slot = {}) => { return ${generateNodeSequence(node.children, context)}; }`
    : ''
  return `{type:${typeExpression},props:${props}${slot}}`
}

function resolveNodeTypeExpression(node: TemplateNode, context: GenerateContext): string {
  if (node.tag === 'Component') {
    const src = readAttr(node, 'src')
    if (!src) return 'undefined'
    return resolveComponentImport(src, context)
  }

  if (context.importedRuntimeSymbols.has(node.tag)) return node.tag
  if (CORE_DSL_TAGS[node.tag]) return JSON.stringify(CORE_DSL_TAGS[node.tag])
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
  const hasExplicitStyleSheet = readAttr(node, ':styleSheet')
    || readAttr(node, 'styleSheet')
    || readAttr(node, ':style-sheet')
    || readAttr(node, 'style-sheet')

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
      || (node.tag === 'Component' && name === 'src')
      || name === ':src'
      || ASSET_OPTION_PROPS.has(name)
      || isControlFlowAttr(name)
      || name.startsWith('@')
    ) continue

    if (name.startsWith(':')) {
      const propName = normalizeDslPropName(name.slice(1))
      if (hasConflictingPropAlias(node, name, propName, context)) continue
      props.push(`${quoteKey(propName)}:${value}`)
      continue
    }

    const propName = normalizeDslPropName(name)
    if (hasConflictingPropAlias(node, name, propName, context)) continue
    const assetProp = generateStaticAssetProp(node, propName, value, context)
    if (assetProp) {
      props.push(assetProp)
      continue
    }
    props.push(`${quoteKey(propName)}:${serializeStaticAttr(value)}`)
  }

  if (!isCompiledComponent) {
    for (const [name, value] of Object.entries(node.attrs)) {
      if (!name.startsWith('@')) continue
      const eventName = name.slice(1)
      const propName = resolveUiKitSemanticEventProp(node.tag, eventName)
      if (propName) props.push(`${propName}:${generateHandler(value)}`)
    }
  }

  return props.length > 0 ? `{${props.join(',')}}` : ''
}

function generateEvents(node: TemplateNode, isCompiledComponent: boolean): string {
  const events: Array<string> = []
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!name.startsWith('@')) continue
    const eventName = name.slice(1)
    if (!isCompiledComponent && resolveUiKitSemanticEventProp(node.tag, eventName)) continue
    events.push(`${quoteKey(eventName)}:${generateHandler(value)}`)
  }
  return events.length > 0 ? `{${events.join(',')}}` : ''
}

function resolveUiKitSemanticEventProp(tag: string, eventName: string): string | null {
  if (!UI_KIT_TAGS.has(tag)) return null
  return UI_KIT_SEMANTIC_EVENT_PROPS.get(eventName) ?? null
}

function normalizeDslPropName(name: string): string {
  return name.includes('-')
    ? name.replace(/-([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase())
    : name
}

function hasConflictingPropAlias(
  node: TemplateNode,
  rawName: string,
  propName: string,
  context: GenerateContext,
): boolean {
  const rawBaseName = rawName.startsWith(':') ? rawName.slice(1) : rawName

  for (const existingName of Object.keys(node.attrs)) {
    if (existingName === rawName) break
    const existingBaseName = existingName.startsWith(':') ? existingName.slice(1) : existingName
    if (normalizeDslPropName(existingBaseName) !== propName) continue
    if (existingBaseName === rawBaseName) continue

    context.diagnostics.push({
      severity: 'error',
      code: 'duplicate-prop-alias',
      message: `Prop "${rawBaseName}" конфликтует с "${existingBaseName}". Используйте только одну форму имени.`,
    })
    return true
  }

  return false
}

function generateStaticAssetProp(
  node: TemplateNode,
  propName: string,
  value: string | true,
  context: GenerateContext,
): string {
  if (typeof value !== 'string') return ''
  if (propName === 'fillPattern') {
    const ref = resolveLocalAssetRef(context, value, ['fill'])
    if (!ref) {
      context.diagnostics.push({
        severity: 'error',
        code: 'unknown-fill-pattern',
        message: `Fill pattern "${value}" не объявлен через <Nova.Assets>.`,
      })
      return ''
    }
    return `background:${ref}`
  }

  const localRef = resolveStaticLocalAssetProp(node.tag, propName, value, context)
  if (localRef) return localRef

  if (!ASSET_PATH_PROPS.has(propName) || !isAssetPath(value)) return ''
  const color = readAttr(node, 'asset-color') ?? readAttr(node, 'assetColor')
  const ref = registerPathAsset(context, {
    request: value,
    color,
    from: node.filename,
  })
  return `${quoteKey(resolveStaticAssetPropTarget(node.tag, propName))}:${ref}`
}

function resolveStaticLocalAssetProp(tag: string, propName: string, value: string, context: GenerateContext): string {
  if (propName === 'background') {
    const ref = resolveLocalAssetRef(context, value, ['fill', 'image'])
    return ref ? `background:${ref}` : ''
  }

  if (propName === 'icon') {
    const ref = resolveLocalAssetRef(context, value, ['icon', 'image'])
    return ref ? `icon:${ref}` : ''
  }

  if (propName === 'src' || propName === 'source') {
    if (tag === 'Image') {
      const ref = resolveLocalAssetRef(context, value, ['image'])
      return ref ? `${quoteKey(propName)}:${ref}` : ''
    }
    const ref = resolveLocalAssetRef(context, value, ['icon', 'image'])
    return ref ? `icon:${ref}` : ''
  }

  return ''
}

function resolveLocalAssetRef(context: GenerateContext, name: string, kinds: Array<NovaAutoAssetKind>): string {
  const local = context.assets.localRefs.get(name)
  if (!local || !kinds.includes(local.kind)) return ''
  return local.ref
}

function generateDynamicLocalAssetRef(context: GenerateContext, expression: string, kinds: Array<NovaAutoAssetKind>): string {
  const entries = [...context.assets.localRefs.entries()]
    .filter(([, local]) => kinds.includes(local.kind))
    .map(([id, local]) => `${JSON.stringify(id)}:${local.ref}`)

  return `({${entries.join(',')}}[${expression}] ?? undefined)`
}

function generateThemeTokenResolver(value: string): string {
  const parsed = parseThemeTokenValue(value)
  if (!parsed) return ''
  const fallback = parsed.fallback ? `, ${JSON.stringify(parsed.fallback)}` : ''
  return `api.resolveThemeToken(${JSON.stringify(parsed.name)}${fallback})`
}

function parseThemeTokenValue(value: string): { name: string; fallback: string } | null {
  const match = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,(.*))?\)$/s)
  if (!match) return null
  return {
    name: match[1],
    fallback: (match[2] ?? '').trim(),
  }
}

function resolveStaticAssetPropTarget(tag: string, propName: string): string {
  if (tag === 'Image' && (propName === 'src' || propName === 'source')) return propName
  if (propName === 'src' || propName === 'source') return 'icon'
  return propName
}

function generateHandler(value: string | true): string {
  if (value === true) return 'undefined'
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) return value
  return `(...args) => (${value})`
}

function readAttr(node: TemplateNode, name: string): string | undefined {
  if (name === 'if' || name === 'else-if' || name === 'for') {
    const dynamicValue = node.attrs[`:${name}`]
    if (typeof dynamicValue === 'string') return dynamicValue
  }

  const value = node.attrs[name]
  return typeof value === 'string' ? value : undefined
}

function parseForExpression(source: string): { item: string; index: string; source: string } | null {
  const match = source.match(/^\s*(?:\(([^,\s]+)\s*,\s*([^)]+)\)|([^\s]+))\s+(?:in|of)\s+(.+)\s*$/)
  if (!match) return null
  return {
    item: (match[1] ?? match[3]).trim(),
    index: (match[2] ?? 'index').trim(),
    source: match[4].trim(),
  }
}

function isControlFlowAttr(name: string): boolean {
  return name === 'if'
    || name === ':if'
    || name === 'else-if'
    || name === ':else-if'
    || name === 'else'
    || name === 'for'
    || name === ':for'
}

function hasControlElseAttr(node: TemplateNode): boolean {
  return Object.prototype.hasOwnProperty.call(node.attrs, 'else')
}

function createTemplateMetadata(
  nodes: Array<TemplateNode>,
  setup: ScriptSetupCompileResult,
): Array<NovaTemplateNodeMetadata> {
  const result: Array<NovaTemplateNodeMetadata> = []
  collectTemplateMetadata(nodes, setup, result)
  return result
}

function collectTemplateMetadata(
  nodes: Array<TemplateNode>,
  setup: ScriptSetupCompileResult,
  result: Array<NovaTemplateNodeMetadata>,
): void {
  for (const node of nodes) {
    result.push({
      tag: node.tag,
      range: node.range,
      tagRange: node.tagRange,
      attrs: node.attrs,
      attrRanges: node.attrRanges,
      target: resolveTemplateNodeTarget(node, setup),
    })
    collectTemplateMetadata(node.children, setup, result)
    for (const slot of Object.values(node.slots)) collectTemplateMetadata(slot.children, setup, result)
  }
}

function resolveTemplateNodeTarget(node: TemplateNode, setup: ScriptSetupCompileResult): NovaDefinitionTarget {
  if (NOVA_UI_KIT_DEFINITION_TARGETS[node.tag]) {
    return {
      kind: 'ui-kit',
      name: node.tag,
      source: NOVA_UI_KIT_DEFINITION_TARGETS[node.tag],
      symbol: node.tag,
    }
  }

  if (node.tag === 'Component') {
    const src = readAttr(node, 'src')
    return src
      ? { kind: 'component-src', name: src, source: src }
      : { kind: 'unknown', name: node.tag }
  }

  const imported = setup.importBindings.get(node.tag) ?? setup.importBindings.get(node.tag.split('.')[0] ?? '')
  if (imported) {
    return {
      kind: 'import',
      name: node.tag,
      source: imported.source,
      symbol: imported.imported,
    }
  }

  if (node.tag.includes('.')) {
    return {
      kind: 'namespaced',
      name: node.tag,
      symbol: node.tag,
    }
  }

  return {
    kind: 'unknown',
    name: node.tag,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function filterRuntimeImports(imports: Array<string>, schemaComponentLocals?: Set<string>): Array<string> {
  if (!schemaComponentLocals?.size) return imports
  return imports.filter(source => {
    const trimmed = source.trim()
    for (const local of schemaComponentLocals) {
      const pattern = new RegExp(`^import\\s+${escapeRegExp(local)}\\s+from\\s+['"]`)
      if (pattern.test(trimmed)) return false
    }
    return true
  })
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
  autoAssetBundleCode: string
  assetBundleExpressions: Array<string>
  schemaComponentLocals?: Set<string>
}): string {
  const setupImports = filterRuntimeImports(options.setup.imports, options.schemaComponentLocals)
  const setupNames = new Set(options.setup.names)
  const topLevelNames = options.setup.topLevelNames
  const implicitTemplateLocals = [
    ['canvas', '{ width: this.width, height: this.height }'],
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
  const useAutoAssets = options.autoAssetBundleCode
    ? 'this.nova.assets.use(__novaSfcAssets);'
    : ''
  const unuseAutoAssets = options.autoAssetBundleCode
    ? 'this.nova.assets.unuse(__novaSfcAssets);'
    : ''
  const refreshAssetBundles = options.assetBundleExpressions.length > 0
    ? 'this.refreshAssetBundles();'
    : ''
  const refreshAssetBundlesMethod = options.assetBundleExpressions.length > 0
    ? `
  refreshAssetBundles() {
    for (const bundle of this.__novaAssetBundles.splice(0)) {
      if (bundle) this.nova.assets.unuse(bundle);
    }
${indent(templateLocalDeclarations, 4)}
    const bundles = [${options.assetBundleExpressions.join(', ')}].filter(Boolean);
    for (const bundle of bundles) {
      this.nova.assets.use(bundle);
      this.__novaAssetBundles.push(bundle);
    }
  }
`
    : ''
  const unuseAssetBundles = options.assetBundleExpressions.length > 0
    ? `for (const bundle of this.__novaAssetBundles.splice(0)) {
      if (bundle) this.nova.assets.unuse(bundle);
    }`
    : ''

  return `import { Nova as __NovaRuntime, NovaNode, NovaTemplateRuntime } from '@endge/nova';
import { EMPTY_STYLE_CONTEXT, NOVA_UI_STYLE_TARGET, NovaUiStyleMask, NovaUIKit as __NovaUIKit, findNovaUiRoot, isNovaUiStyleTarget, mergeStyleReceiveResult, registerNovaUIKit, registerNovaUiGlobalStyleSheet } from '@endge/nova-ui-kit';
${setupImports.join('\n')}
${options.generatedImports.join('\n')}

const __novaSfcStyle = ${options.scopedStyleAssetCode};
const __novaSfcGlobalStyle = ${options.globalStyleAssetCode};
const __novaSfcGlobalStyles = ${globalStylesExpression};
${options.autoAssetBundleCode}
const __novaUiKitRegisteredApps = new WeakSet();
const __ensureNovaUiKit = app => {
  if (__novaUiKitRegisteredApps.has(app)) return;
  registerNovaUIKit(app.schema);
  __novaUiKitRegisteredApps.add(app);
};
const __novaFor = source => {
  if (typeof source === 'number') {
    const count = Math.max(0, Math.floor(source));
    return Array.from({ length: count }, (_item, index) => index + 1);
  }
  if (Array.isArray(source)) return source;
  if (source && typeof source[Symbol.iterator] === 'function') return Array.from(source);
  if (source && typeof source === 'object') return Object.values(source);
  return [];
};
${runtimeHelpers}
export const novaScopeId = ${JSON.stringify(options.scopeId)};
export const novaStyleSheet = __novaSfcStyle;
export const novaGlobalStyleSheets = __novaSfcGlobalStyles;

export default class ${options.className} extends NovaNode {
  constructor(app, surface, props = {}, listeners = {}, slots = {}) {
    super(app, surface);
    this[NOVA_UI_STYLE_TARGET] = true;
    __ensureNovaUiKit(app);
    this.props = props;
    this.listeners = listeners;
    this.slots = slots;
    this.__novaAssetBundles = [];
    this.__novaGlobalStyleDisposers = [];
    this.__novaInheritedStyleContext = EMPTY_STYLE_CONTEXT;
${indent(useAutoAssets, 4)}
    this.installGlobalStyles();
    this.templateRuntime = new NovaTemplateRuntime(this, { refs: props.novaRefs ?? {} });
    this.setupState = this.setup();
${indent(refreshAssetBundles, 4)}
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
${refreshAssetBundlesMethod}

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
${indent(refreshAssetBundles, 4)}
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

  receiveStyleContext(context, changedMask) {
    this.__novaInheritedStyleContext = context;
    return this.__novaPropagateStyleContext(changedMask);
  }

  getSubtreeStyleMask() {
    let mask = NovaUiStyleMask.AllText;
    for (const child of this.children) {
      if (!isNovaUiStyleTarget(child)) continue;
      mask |= child.getSubtreeStyleMask();
    }
    return mask;
  }

  __novaPropagateStyleContext(changedMask) {
    const result = { update: false, render: false, layout: false };
    if (changedMask === NovaUiStyleMask.None) return result;
    for (const child of this.children) {
      if (!isNovaUiStyleTarget(child)) continue;
      const childMask = child.getSubtreeStyleMask();
      if ((changedMask & childMask) === 0) continue;
      mergeStyleReceiveResult(
        result,
        child.receiveStyleContext(this.__novaInheritedStyleContext, changedMask & childMask),
      );
    }
    return result;
  }

  __novaRefreshParentStyleCascade() {
    const root = findNovaUiRoot(this);
    if (root && typeof root.refreshStyleCascade === 'function') {
      root.refreshStyleCascade();
    }
  }

  update() {
    __NovaRuntime.trackNode(this, () => {
      const result = this.templateRuntime.reconcile(this.createTemplate());
      if (result.created > 0 || result.removed > 0) this.__novaRefreshParentStyleCascade();
      this.__novaPropagateStyleContext(NovaUiStyleMask.AllText);
    });
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
${indent(unuseAssetBundles, 4)}
${indent(unuseAutoAssets, 4)}
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

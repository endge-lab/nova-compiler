import { createHash } from 'node:crypto'
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
}

interface SfcBlock {
  type: 'template' | 'script' | 'style'
  attrs: Record<string, string | true>
  content: string
}

interface TemplateNode {
  tag: string
  attrs: Record<string, string | true>
  children: Array<TemplateNode>
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
  const blocks = parseSfcBlocks(source)
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const template = blocks.find(block => block.type === 'template')
  const script = blocks.find(block => block.type === 'script')
  const styles = blocks.filter(block => block.type === 'style')
  const scopeId = createScopeId(options.filename ?? source)
  const className = options.className ?? createClassName(options.filename)

  if (!template) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-template',
      message: 'Файл .nova должен содержать <template>.',
    })
  }

  const duplicateTypes = ['template', 'script'] as const
  for (const type of duplicateTypes) {
    if (blocks.filter(block => block.type === type).length > 1) {
      diagnostics.push({
        severity: 'error',
        code: `duplicate-${type}`,
        message: `Файл .nova содержит несколько <${type}> блоков.`,
      })
    }
  }

  const scoped = styles.some(block => Object.prototype.hasOwnProperty.call(block.attrs, 'scoped'))
  const styleAsset = compileSfcStyles(styles, scopeId, options)
  diagnostics.push(...styleAsset.diagnostics)

  const templateNodes = template ? parseTemplate(template.content, diagnostics) : []
  validateTemplateNodes(templateNodes, diagnostics)
  const setup = compileScriptSetup(script?.content ?? '')
  const templateCode = generateNodeSequence(templateNodes, scoped)

  return {
    code: generateModule({
      className,
      setup,
      templateCode,
      styleAssetCode: serializeStyleAsset(styleAsset),
    }),
    diagnostics,
    scopeId,
  }
}

function parseSfcBlocks(source: string): Array<SfcBlock> {
  const blocks: Array<SfcBlock> = []
  const pattern = /<(template|script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    blocks.push({
      type: match[1] as SfcBlock['type'],
      attrs: parseAttrs(match[2]),
      content: match[3].trim(),
    })
  }

  return blocks
}

function compileSfcStyles(
  styles: Array<SfcBlock>,
  scopeId: string,
  options: NovaSfcCompileOptions,
) {
  const source = styles.map(block => {
    if (typeof block.attrs.src === 'string') {
      const imported = options.resolveImport?.(block.attrs.src, options.filename)
      return imported ?? ''
    }
    return block.content
  }).join('\n')

  return compileNovaCss(source, {
    ...options,
    scopeId,
  })
}

function parseTemplate(source: string, diagnostics: Array<NovaUiStyleDiagnostic>): Array<TemplateNode> {
  const root: TemplateNode = { tag: 'root', attrs: {}, children: [] }
  const stack = [root]
  const tagPattern = /<\/?([\w.-]+)([^>]*)>/g
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(source)) !== null) {
    const raw = match[0]
    const tag = match[1]
    if (raw.startsWith('</')) {
      if (stack.length > 1) stack.pop()
      continue
    }

    if (!UI_KIT_TAGS.has(tag) && !PRIMITIVE_TAGS.has(tag) && !tag.includes('.')) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-tag',
        message: `Неизвестный Nova tag "${tag}".`,
      })
    }

    const node: TemplateNode = {
      tag,
      attrs: parseAttrs(match[2]),
      children: [],
    }
    stack[stack.length - 1].children.push(node)
    if (!raw.endsWith('/>')) stack.push(node)
  }

  return root.children
}

function validateTemplateNodes(nodes: Array<TemplateNode>, diagnostics: Array<NovaUiStyleDiagnostic>): void {
  let previousAcceptsElse = false

  for (const node of nodes) {
    if (
      readAttr(node, 'v-for')
      && !readAttr(node, ':key')
      && !readAttr(node, 'key')
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-key',
        message: `v-for на <${node.tag}> должен содержать обязательный :key.`,
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

    validateTemplateNodes(node.children, diagnostics)
    previousAcceptsElse = !!readAttr(node, 'v-if') || !!readAttr(node, 'v-else-if')
  }
}

function parseAttrs(source: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {}
  const pattern = /([:@.\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? true
  }

  return attrs
}

function compileScriptSetup(source: string): { body: string; names: Array<string> } {
  const transformed = source
    .replace(/defineProps\s*<[^>]+>\s*\(\s*\)/g, '__props')
    .replace(/defineProps\s*\([^)]*\)/g, '__props')
    .replace(/defineEmits\s*<[^>]+>\s*\(\s*\)/g, '__emit')
    .replace(/defineEmits\s*\([^)]*\)/g, '__emit')

  const names = new Set<string>()
  for (const match of transformed.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  for (const match of transformed.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])

  return {
    body: transformed,
    names: [...names],
  }
}

function generateNodeSequence(nodes: Array<TemplateNode>, scoped: boolean): string {
  const chunks: Array<string> = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (readAttr(node, 'v-else-if') || Object.prototype.hasOwnProperty.call(node.attrs, 'v-else')) continue

    const condition = readAttr(node, 'v-if')
    if (!condition) {
      chunks.push(generateNodeList(node, scoped))
      continue
    }

    let branch = `(${condition}) ? [${generateSchema(node, false, scoped)}]`
    let fallback = '[]'
    let cursor = index + 1
    while (cursor < nodes.length) {
      const next = nodes[cursor]
      const elseIf = readAttr(next, 'v-else-if')
      const hasElse = Object.prototype.hasOwnProperty.call(next.attrs, 'v-else')
      if (!elseIf && !hasElse) break

      if (elseIf) {
        branch += ` : (${elseIf}) ? [${generateSchema(next, false, scoped)}]`
      } else {
        fallback = `[${generateSchema(next, false, scoped)}]`
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

function generateNodeList(node: TemplateNode, scoped: boolean): string {
  const forSource = readAttr(node, 'v-for')
  if (forSource) {
    const parsed = parseForExpression(forSource)
    if (parsed) {
      const schema = generateSchema(node, true, scoped)
      return `(${parsed.source} ?? []).flatMap((${parsed.item}, ${parsed.index}) => [${schema}])`
    }
  }

  return generateSchema(node, false, scoped)
}

function generateSchema(node: TemplateNode, fromFor = false, scoped = false): string {
  const type = UI_KIT_TAGS.has(node.tag) ? `NovaUIKit.${node.tag}` : JSON.stringify(node.tag)
  const props = generateProps(node, scoped)
  const events = generateEvents(node)
  const children = node.children.length > 0 ? generateNodeSequence(node.children, scoped) : ''
  const key = readAttr(node, ':key') ?? readAttr(node, 'key') ?? (fromFor ? 'index' : undefined)
  const context = readAttr(node, ':context')
  const layout = readAttr(node, ':layout') ?? readAttr(node, 'layout')
  const fields = [
    `type:${type}`,
    readAttr(node, 'id') ? `id:${JSON.stringify(readAttr(node, 'id'))}` : '',
    key ? `key:${key}` : '',
    context ? `context:${context}` : '',
    layout ? `layout:${layout}` : '',
    props ? `props:${props}` : '',
    events ? `events:${events}` : '',
    children ? `children:${children}` : '',
  ].filter(Boolean)
  return `{${fields.join(',')}}`
}

function generateProps(node: TemplateNode, scoped: boolean): string {
  const props: Array<string> = []
  const staticClass = readAttr(node, 'class')
  const dynamicClass = readAttr(node, ':class')
  const attrs = readAttr(node, ':attrs') ?? readAttr(node, 'attrs')

  if (staticClass || dynamicClass) {
    props.push(`className:[${staticClass ? JSON.stringify(staticClass) : 'null'}, ${dynamicClass ?? 'null'}].filter(Boolean).join(' ')`)
  }
  if (attrs && scoped) props.push(`attrs:{...(${attrs}), __novaScope: __novaSfcStyle.scopeId}`)
  else if (attrs) props.push(`attrs:${attrs}`)
  else if (scoped) props.push('attrs:{__novaScope: __novaSfcStyle.scopeId}')

  for (const [name, value] of Object.entries(node.attrs)) {
    if (
      name === 'id'
      || name === 'key'
      || name === ':key'
      || name === 'class'
      || name === ':class'
      || name === 'attrs'
      || name === ':attrs'
      || name === ':context'
      || name === 'layout'
      || name === ':layout'
      || name.startsWith('v-')
      || name.startsWith('@')
    ) continue

    if (name.startsWith(':')) {
      props.push(`${quoteKey(name.slice(1))}:${value}`)
      continue
    }

    props.push(`${quoteKey(name)}:${serializeStaticAttr(value)}`)
  }

  for (const [name, value] of Object.entries(node.attrs)) {
    if (!name.startsWith('@')) continue
    const eventName = name.slice(1)
    if (eventName === 'press') props.push(`onPress:${generateHandler(value)}`)
    if (eventName === 'change') props.push(`onChange:${generateHandler(value)}`)
  }

  return props.length > 0 ? `{${props.join(',')}}` : ''
}

function generateEvents(node: TemplateNode): string {
  const events: Array<string> = []
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!name.startsWith('@')) continue
    const eventName = name.slice(1)
    if (eventName === 'press' || eventName === 'change') continue
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
  setup: { body: string; names: Array<string> }
  templateCode: string
  styleAssetCode: string
}): string {
  const setupNames = new Set(options.setup.names)
  const implicitTemplateLocals = [
    ['props', 'this.props'],
    ['emit', 'this.emit.bind(this)'],
    ['width', 'this.width'],
    ['height', 'this.height'],
    ['styleSheet', '__novaSfcStyle'],
  ] as const
  const templateLocalDeclarations = [
    ...implicitTemplateLocals
      .filter(([name]) => !setupNames.has(name))
      .map(([name, value]) => `const ${name} = ${value};`),
    ...options.setup.names.map(name => `const ${name} = this.setupState.${name};`),
  ].join('\n')

  return `import { NovaNode, NovaTemplateRuntime } from '@endge/nova';
import { NovaUIKit } from '@endge/nova-ui-kit';

const __novaSfcStyle = ${options.styleAssetCode};
const ref = value => ({ value });
const computed = fn => ({ get value() { return fn(); } });
const watch = () => () => {};
export const novaScopeId = __novaSfcStyle.scopeId;
export const novaStyleSheet = __novaSfcStyle;

export default class ${options.className} extends NovaNode {
  constructor(app, surface, props = {}, listeners = {}) {
    super(app, surface);
    this.props = props;
    this.listeners = listeners;
    this.templateRuntime = new NovaTemplateRuntime(this);
    this.setupState = this.setup();
    this.options({
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width ?? app.width,
      height: props.height ?? app.height,
    });
  }

  setup() {
    const __props = this.props;
    const __emit = this.emit.bind(this);
    const provide = (token, value) => this.provide(token, value);
    const inject = (token) => this.inject(token);
    const injectOptional = (token, fallback) => this.injectOptional(token, fallback);
${indent(options.setup.body, 4)}
    return { ${options.setup.names.join(', ')} };
  }

  emit(name, ...args) {
    this.listeners?.[name]?.(...args);
  }

  setProps(patch) {
    Object.assign(this.props, patch);
    this.dirty({ update: true, render: true });
    return this;
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

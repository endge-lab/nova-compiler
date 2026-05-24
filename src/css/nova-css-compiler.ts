import {
  extractNovaUiStyleTokenDependencies,
  validateNovaUiStyleSheetSource,
  type NovaUiStyleDiagnostic,
  type NovaUiStyleSheetAsset,
  type NovaUiStyleThemeDefinition,
} from '@endge/nova-ui-kit'

export interface NovaCssCompileOptions {
  filename?: string
  scopeId?: string
  resolveImport?: (
    request: string,
    from: string | undefined,
  ) => string | { source: string; filename?: string } | null | undefined
}

export interface NovaCssCompileResult extends NovaUiStyleSheetAsset {
  imports: Array<string>
  flattenedSource: string
}

export interface NovaCssGenerateModuleOptions {
  sideEffect?: boolean
}

/** Компилирует `.novacss` в precompiled Nova stylesheet asset. */
export function compileNovaCss(source: string, options: NovaCssCompileOptions = {}): NovaCssCompileResult {
  const imports: Array<string> = []
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const flattenedSource = resolveImports(source, options, imports, diagnostics)
  const themeExtraction = extractNovaCssThemes(flattenedSource, diagnostics)
  const scopedSource = options.scopeId ? scopeNovaCss(themeExtraction.source, options.scopeId) : themeExtraction.source
  const validation = validateNovaUiStyleSheetSource(scopedSource)
  const themes = compileNovaCssThemes(themeExtraction.themes, {
    scopeId: options.scopeId,
    diagnostics,
  })
  const tokenDependencies = extractNovaUiStyleTokenDependencies(`${scopedSource}\n${themes.map(theme => theme.styleSheet?.source ?? '').join('\n')}`)

  return {
    ok: validation.ok && !diagnostics.some(item => item.severity === 'error'),
    source: scopedSource,
    flattenedSource,
    styleSheet: validation.styleSheet,
    themes,
    diagnostics: [...diagnostics, ...validation.diagnostics],
    tokenDependencies,
    scopeId: options.scopeId,
    imports,
  }
}

/** Создает JS module для Vite import `.novacss`. */
export function generateNovaCssModule(result: NovaCssCompileResult, options: NovaCssGenerateModuleOptions = {}): string {
  const registration = options.sideEffect
    ? 'import { Nova } from \'@endge/nova\';\n'
    : ''
  const sideEffect = options.sideEffect
    ? 'Nova.import(asset);\n'
    : ''

  return `${registration}const asset = ${serializeStyleAsset(result)};
${sideEffect}export const source = asset.source;
export const diagnostics = asset.diagnostics;
export const tokenDependencies = asset.tokenDependencies;
export const themes = asset.themes ?? [];
export default asset;
`
}

/** Сериализует style asset вместе с Map индексами. */
export function serializeStyleAsset(asset: NovaUiStyleSheetAsset): string {
  return serializeValue(asset)
}

function resolveImports(
  source: string,
  options: NovaCssCompileOptions,
  imports: Array<string>,
  diagnostics: Array<NovaUiStyleDiagnostic>,
  seen = new Set<string>(),
): string {
  return source.replace(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g, (_raw, request: string) => {
    imports.push(request)
    const resolved = options.resolveImport?.(request, options.filename)
    if (!resolved) {
      diagnostics.push({
        severity: 'error',
        code: 'import-not-found',
        message: `Не найден import "${request}".`,
      })
      return ''
    }

    const key = `${options.filename ?? '<inline>'}:${request}`
    if (seen.has(key)) return ''
    seen.add(key)

    const importedSource = typeof resolved === 'string' ? resolved : resolved.source
    const importedFilename = typeof resolved === 'string' ? request : resolved.filename ?? request

    return resolveImports(importedSource, { ...options, filename: importedFilename }, imports, diagnostics, seen)
  })
}

function scopeNovaCss(source: string, scopeId: string): string {
  return scopeNovaCssBlock(source, scopeId)
}

interface ExtractedNovaCssTheme {
  id: string
  body: string
}

interface NovaCssThemeExtraction {
  source: string
  themes: Array<ExtractedNovaCssTheme>
}

function extractNovaCssThemes(
  source: string,
  diagnostics: Array<NovaUiStyleDiagnostic>,
): NovaCssThemeExtraction {
  const themes: Array<ExtractedNovaCssTheme> = []
  let output = ''
  let cursor = 0

  while (cursor < source.length) {
    const themeIndex = findThemeAtRule(source, cursor)
    if (themeIndex < 0) {
      output += source.slice(cursor)
      break
    }

    output += source.slice(cursor, themeIndex)
    const preludeStart = themeIndex + '@theme'.length
    const blockStart = findNextBrace(source, preludeStart)
    if (blockStart < 0) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-theme-rule',
        message: 'Невалидный @theme: ожидается блок `{ ... }`.',
      })
      cursor = source.length
      break
    }

    const id = source.slice(preludeStart, blockStart).trim()
    if (!/^[A-Za-z_][\w-]*$/.test(id)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-theme-id',
        message: `Невалидный идентификатор @theme "${id}".`,
      })
    }

    const blockEnd = findMatchingBrace(source, blockStart)
    if (blockEnd < 0) {
      diagnostics.push({
        severity: 'error',
        code: 'unclosed-theme-rule',
        message: `Незакрытый @theme "${id || '<empty>'}".`,
      })
      cursor = source.length
      break
    }

    if (id) {
      themes.push({
        id,
        body: source.slice(blockStart + 1, blockEnd),
      })
    }
    cursor = blockEnd + 1
  }

  return {
    source: output,
    themes,
  }
}

function compileNovaCssThemes(
  themes: Array<ExtractedNovaCssTheme>,
  options: {
    scopeId?: string
    diagnostics: Array<NovaUiStyleDiagnostic>
  },
): Array<NovaUiStyleThemeDefinition> {
  return themes.map(theme => {
    const body = splitThemeBody(theme.body)
    const selectorSource = options.scopeId ? scopeNovaCss(body.rules, options.scopeId) : body.rules
    const validation = validateNovaUiStyleSheetSource(selectorSource)
    options.diagnostics.push(...validation.diagnostics)

    return {
      id: theme.id,
      tokens: body.tokens,
      styleSheet: validation.styleSheet,
    }
  })
}

function splitThemeBody(source: string): {
  tokens: Record<`--${string}`, string>
  rules: string
} {
  const tokens: Record<`--${string}`, string> = {}
  let rules = ''
  let declarations = ''
  let cursor = 0

  while (cursor < source.length) {
    const next = findNextTopLevel(source, cursor, ['{', ';'])
    if (next < 0) {
      declarations += source.slice(cursor)
      break
    }

    if (source[next] === ';') {
      declarations += source.slice(cursor, next + 1)
      cursor = next + 1
      continue
    }

    const end = findMatchingBrace(source, next)
    if (end < 0) {
      rules += source.slice(cursor)
      break
    }

    rules += source.slice(cursor, end + 1)
    cursor = end + 1
  }

  for (const match of declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+)\s*;/g)) {
    tokens[match[1] as `--${string}`] = stripQuotes(match[2].trim())
  }

  return {
    tokens,
    rules,
  }
}

function findThemeAtRule(source: string, cursor: number): number {
  let quote = ''

  for (let index = cursor; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (source.startsWith('@theme', index) && !/[\w-]/.test(source[index + '@theme'.length] ?? '')) {
      return index
    }
  }

  return -1
}

function scopeNovaCssBlock(source: string, scopeId: string): string {
  let output = ''
  let cursor = 0

  while (cursor < source.length) {
    const openIndex = findNextBrace(source, cursor)
    if (openIndex < 0) {
      output += source.slice(cursor)
      break
    }

    const prelude = source.slice(cursor, openIndex)
    const blockEnd = findMatchingBrace(source, openIndex)
    if (blockEnd < 0) {
      output += source.slice(cursor)
      break
    }

    const trimmedPrelude = prelude.trim()
    const body = source.slice(openIndex + 1, blockEnd)
    if (trimmedPrelude.startsWith('@')) {
      output += `${prelude}{${scopeNovaCssBlock(body, scopeId)}}`
    } else {
      output += `${scopeSelectorPrelude(prelude, scopeId)}{${scopeNovaCssBlock(body, scopeId)}}`
    }
    cursor = blockEnd + 1
  }

  return output
}

function scopeSelectorPrelude(prelude: string, scopeId: string): string {
  const leading = prelude.match(/^\s*/)?.[0] ?? ''
  const trailing = prelude.match(/\s*$/)?.[0] ?? ''
  const selectorSource = prelude.trim()
  if (!selectorSource) return prelude

  const selectors = selectorSource
    .split(',')
    .map(selector => selector.trim())
    .filter(Boolean)
    .map(selector => selector.includes(`[__novaScope="${scopeId}"]`)
      ? selector
      : `${selector}[__novaScope="${scopeId}"]`)

  return `${leading}${selectors.join(', ')}${trailing}`
}

function findNextBrace(source: string, cursor: number): number {
  let quote = ''

  for (let index = cursor; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === '{') return index
  }

  return -1
}

function findNextTopLevel(source: string, cursor: number, chars: Array<string>): number {
  let depth = 0
  let quote = ''

  for (let index = cursor; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (depth === 0 && chars.includes(char)) return index
  }

  return -1
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0
  let quote = ''

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function serializeValue(value: unknown): string {
  if (value instanceof Map) {
    return `new Map(${serializeValue([...value.entries()])})`
  }
  if (Array.isArray(value)) return `[${value.map(item => serializeValue(item)).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)

  const entries = Object.entries(value)
    .filter(([_key, child]) => typeof child !== 'function')
    .map(([key, child]) => `${JSON.stringify(key)}:${serializeValue(child)}`)
  return `{${entries.join(',')}}`
}

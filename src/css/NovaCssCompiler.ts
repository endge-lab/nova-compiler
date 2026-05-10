import {
  extractNovaUiStyleTokenDependencies,
  validateNovaUiStyleSheetSource,
  type NovaUiStyleDiagnostic,
  type NovaUiStyleSheetAsset,
} from '@endge/nova-ui-kit'

export interface NovaCssCompileOptions {
  filename?: string
  scopeId?: string
  resolveImport?: (request: string, from: string | undefined) => string | null | undefined
}

export interface NovaCssCompileResult extends NovaUiStyleSheetAsset {
  imports: string[]
  flattenedSource: string
}

/** Компилирует `.novacss` в precompiled Nova stylesheet asset. */
export function compileNovaCss(source: string, options: NovaCssCompileOptions = {}): NovaCssCompileResult {
  const imports: string[] = []
  const diagnostics: NovaUiStyleDiagnostic[] = []
  const flattenedSource = resolveImports(source, options, imports, diagnostics)
  const scopedSource = options.scopeId ? scopeNovaCss(flattenedSource, options.scopeId) : flattenedSource
  const validation = validateNovaUiStyleSheetSource(scopedSource)
  const tokenDependencies = extractNovaUiStyleTokenDependencies(scopedSource)

  return {
    ok: validation.ok && !diagnostics.some(item => item.severity === 'error'),
    source: scopedSource,
    flattenedSource,
    styleSheet: validation.styleSheet,
    diagnostics: [...diagnostics, ...validation.diagnostics],
    tokenDependencies,
    scopeId: options.scopeId,
    imports,
  }
}

/** Создает JS module для Vite import `.novacss`. */
export function generateNovaCssModule(result: NovaCssCompileResult): string {
  return `const asset = ${serializeStyleAsset(result)};
export const source = asset.source;
export const diagnostics = asset.diagnostics;
export const tokenDependencies = asset.tokenDependencies;
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
  imports: string[],
  diagnostics: NovaUiStyleDiagnostic[],
  seen = new Set<string>(),
): string {
  return source.replace(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g, (raw, request: string) => {
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

    return resolveImports(resolved, { ...options, filename: request }, imports, diagnostics, seen)
  })
}

function scopeNovaCss(source: string, scopeId: string): string {
  return source.replace(/([^{}@]+)\{/g, (raw, selectorSource: string) => {
    const selectors = selectorSource
      .split(',')
      .map(selector => selector.trim())
      .filter(Boolean)
      .map(selector => selector.includes(`[__novaScope="${scopeId}"]`)
        ? selector
        : `${selector}[__novaScope="${scopeId}"]`)
    return `${selectors.join(', ')} {`
  })
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

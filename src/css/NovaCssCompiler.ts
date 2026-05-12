import {
  extractNovaUiStyleTokenDependencies,
  validateNovaUiStyleSheetSource,
  type NovaUiStyleDiagnostic,
  type NovaUiStyleSheetAsset,
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

/** Компилирует `.novacss` в precompiled Nova stylesheet asset. */
export function compileNovaCss(source: string, options: NovaCssCompileOptions = {}): NovaCssCompileResult {
  const imports: Array<string> = []
  const diagnostics: Array<NovaUiStyleDiagnostic> = []
  const flattenedSource = resolveImports(source, options, imports, diagnostics)
  const scopedSource = options.scopeId ? scopeNovaCss(flattenedSource, options.scopeId) : flattenedSource
  const validation = validateNovaUiStyleSheetSource(scopedSource)
  const tokenDependencies = validation.styleSheet?.tokenDependencies
    ?? extractNovaUiStyleTokenDependencies(scopedSource)

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
  return source.replace(/([^{}@]+)\{/g, (_raw, selectorSource: string) => {
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

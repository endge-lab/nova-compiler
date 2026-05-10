import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { compileNovaCss, generateNovaCssModule } from '@/css/NovaCssCompiler'
import { compileNovaSfc } from '@/sfc/NovaSfcCompiler'

export interface NovaVitePluginOptions {
  includeDiagnostics?: boolean
}

/** Vite plugin для `.nova` и `.novacss`. */
export function novaVitePlugin(options: NovaVitePluginOptions = {}): Plugin {
  return {
    name: 'endge-nova-compiler',
    enforce: 'pre',
    transform(source, id) {
      const resolveCssImport = (request: string, from: string | undefined): string | null => {
        const baseDir = from ? path.dirname(from) : process.cwd()
        const resolved = path.resolve(baseDir, request)
        if (!fs.existsSync(resolved)) return null
        this.addWatchFile(resolved)
        return fs.readFileSync(resolved, 'utf8')
      }

      if (id.endsWith('.novacss')) {
        const result = compileNovaCss(source, {
          filename: id,
          resolveImport: resolveCssImport,
        })
        emitDiagnostics(id, result.diagnostics, options.includeDiagnostics ?? true)
        throwOnErrors(result.diagnostics)
        return {
          code: generateNovaCssModule(result),
          map: null,
        }
      }

      if (id.endsWith('.nova')) {
        const result = compileNovaSfc(source, {
          filename: id,
          resolveImport: resolveCssImport,
        })
        emitDiagnostics(id, result.diagnostics, options.includeDiagnostics ?? true)
        throwOnErrors(result.diagnostics)
        return {
          code: result.code,
          map: null,
        }
      }

      return null
    },
  }
}

function throwOnErrors(
  diagnostics: Array<{ severity: string; code: string; message: string; line?: number; column?: number }>,
): void {
  const error = diagnostics.find(item => item.severity === 'error')
  if (!error) return
  throw new Error(`${error.code}: ${error.message}`)
}

function emitDiagnostics(
  id: string,
  diagnostics: Array<{ severity: string; code: string; message: string; line?: number; column?: number }>,
  enabled: boolean,
): void {
  if (!enabled) return
  for (const diagnostic of diagnostics) {
    const location = diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 1}` : '0:0'
    const message = `[${id}:${location}] ${diagnostic.code}: ${diagnostic.message}`
    if (diagnostic.severity === 'error') {
      console.error(message)
    } else {
      console.warn(message)
    }
  }
}

declare module '*.novacss' {
  import type { NovaUiStyleSheetAsset } from '@endge/nova-ui-kit'

  const asset: NovaUiStyleSheetAsset
  export const source: string
  export const diagnostics: NovaUiStyleSheetAsset['diagnostics']
  export const tokenDependencies: Array<string>
  export const themes: NonNullable<NovaUiStyleSheetAsset['themes']>
  export default asset
}

declare module '*.novacss?asset' {
  import type { NovaUiStyleSheetAsset } from '@endge/nova-ui-kit'

  const asset: NovaUiStyleSheetAsset
  export const source: string
  export const diagnostics: NovaUiStyleSheetAsset['diagnostics']
  export const tokenDependencies: Array<string>
  export const themes: NonNullable<NovaUiStyleSheetAsset['themes']>
  export default asset
}

declare module '*.nova' {
  import type { NovaApp, NovaNode, NovaSurface } from '@endge/nova'
  import type { NovaUiStyleSheetAsset } from '@endge/nova-ui-kit'

  export const novaScopeId: string
  export const novaStyleSheet: NovaUiStyleSheetAsset
  export const novaGlobalStyleSheets: Array<NovaUiStyleSheetAsset>
  export default class NovaSfcComponent extends NovaNode<Record<string, any>> {
    constructor(
      app: NovaApp<Record<string, any>>,
      surface: NovaSurface<Record<string, any>>,
      props?: Record<string, any>,
      listeners?: Record<string, (...args: Array<any>) => void>,
    )
    setProps(patch: Record<string, unknown>): this
    setListeners(listeners?: Record<string, (...args: Array<any>) => void>): this
    getTemplateStats(): Readonly<{
      created: number
      reused: number
      removed: number
      patched: number
    }>
  }
}

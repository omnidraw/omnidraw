import {
  fnAssertValidCanvasDocument,
  fnStringifyCanonicalCanvasJson,
} from '@omnidraw/canvas-contract'
import {
  CANVAS_CONFORMANCE_DOCUMENT,
} from '@omnidraw/canvas-contract/conformance'
import {
  WidgetManifestValidator,
  fnCanonicalizeWidgetManifestV1,
} from '@omnidraw/sdk/manifest'
import {
  WIDGET_SDK_CONFORMANCE_FIXTURE,
} from '@omnidraw/sdk/conformance'
import {
  DEFAULT_THEME_ID,
} from '@omnidraw/theme'
import {
  MANAGED_PUBLIC_PACKAGE_NAMES,
} from './managed-composition'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function runPackedPublicComposition(): Readonly<{
  canvasBytes: number
  packageCount: number
  themeId: string
  widgetBytes: number
}> {
  fnAssertValidCanvasDocument(CANVAS_CONFORMANCE_DOCUMENT)
  const canvasCanonical = fnStringifyCanonicalCanvasJson(CANVAS_CONFORMANCE_DOCUMENT)
  const widget = WidgetManifestValidator.parse(WIDGET_SDK_CONFORMANCE_FIXTURE.manifest)
  const widgetCanonical = fnCanonicalizeWidgetManifestV1(widget)
  assert(canvasCanonical === fnStringifyCanonicalCanvasJson(CANVAS_CONFORMANCE_DOCUMENT), 'Canvas canonicalization drifted.')
  assert(widgetCanonical === fnCanonicalizeWidgetManifestV1(widget), 'Widget canonicalization drifted.')
  assert(MANAGED_PUBLIC_PACKAGE_NAMES.length === 5, 'Managed composition does not use the exact public set.')
  return Object.freeze({
    canvasBytes: new TextEncoder().encode(canvasCanonical).byteLength,
    packageCount: MANAGED_PUBLIC_PACKAGE_NAMES.length,
    themeId: DEFAULT_THEME_ID,
    widgetBytes: new TextEncoder().encode(widgetCanonical).byteLength,
  })
}

if (import.meta.main) {
  const evidence = runPackedPublicComposition()
  console.log(`[packed-public-composition] ${evidence.packageCount} public packages passed`)
}

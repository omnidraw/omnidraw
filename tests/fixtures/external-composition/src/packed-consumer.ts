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
} from '@omnidraw/sdk/contract'
import {
  WIDGET_SDK_MODULE_ADMISSION_VECTORS,
  WIDGET_SDK_CONFORMANCE_FIXTURE,
  WIDGET_SDK_SERVER_MODULE_VECTOR,
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
  widgetAdmissionVectorCount: number
  widgetBytes: number
  widgetModuleBytes: number
  widgetModuleDigestSha256: string
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
    widgetAdmissionVectorCount: WIDGET_SDK_MODULE_ADMISSION_VECTORS.length,
    widgetBytes: new TextEncoder().encode(widgetCanonical).byteLength,
    widgetModuleBytes: WIDGET_SDK_SERVER_MODULE_VECTOR.moduleBytes.length,
    widgetModuleDigestSha256: WIDGET_SDK_SERVER_MODULE_VECTOR.moduleDigestSha256,
  })
}

if (import.meta.main) {
  const evidence = runPackedPublicComposition()
  console.log(`[packed-public-composition] ${evidence.packageCount} public packages passed`)
}

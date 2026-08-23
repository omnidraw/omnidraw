import type { TCanvasDependencies } from '@omnidraw/canvas'
import type { TCanvasDocumentTransport } from '@omnidraw/canvas-contract'
import type { IAiChatPort } from '@omnidraw/component-ai-chat'
import type {
  IWidgetFunctionHostPort,
  IWidgetResourceHostPort,
} from '@omnidraw/sdk/host'
import type { TWidgetManifestV1 } from '@omnidraw/sdk/contract'
import type { IThemeService } from '@omnidraw/theme'

/**
 * Type-only managed composition proof. Implementations remain private while
 * every injected boundary comes from one of the five published packages.
 */
export type TManagedPublicComposition = Readonly<{
  aiChat: IAiChatPort
  canvas: TCanvasDocumentTransport
  canvasDependencies: Omit<TCanvasDependencies, 'transport' | 'themeService'>
  theme: IThemeService
  widget: Readonly<{
    functions: IWidgetFunctionHostPort
    manifest: TWidgetManifestV1
    resources: IWidgetResourceHostPort
  }>
}>

export function defineManagedPublicComposition<T extends TManagedPublicComposition>(
  composition: T,
): T {
  return composition
}

export const MANAGED_PUBLIC_PACKAGE_NAMES = Object.freeze([
  '@omnidraw/canvas-contract',
  '@omnidraw/canvas',
  '@omnidraw/sdk',
  '@omnidraw/component-ai-chat',
  '@omnidraw/theme',
] as const)

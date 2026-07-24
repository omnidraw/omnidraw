/**
 * @file Public widget manifest and immutable artifact contract surface.
 */

export type * from './interface';
export type * from './types';
export {
  ZWidgetBrowserFunctionDescriptor,
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetServerFunctionDescriptor,
  ZWidgetServerFunctionDescriptors,
} from './function-descriptor-schema';
export {
  ZWidgetCapsuleBudgetRequest,
  ZWidgetCapsuleBudgets,
  ZWidgetCapsuleCapabilityRequest,
  ZWidgetCapsuleChannelContract,
  ZWidgetCapsuleParkability,
  ZWidgetCapsuleSchemaReference,
  ZWidgetCapsuleTarget,
  ZWidgetManifestV3,
} from './manifest-schema';
export { ZWidgetCapsuleRuntimeDescriptor } from './runtime-descriptor-schema';
export {
  LUCIDE_STATIC_ICON_KEYS,
  LUCIDE_STATIC_ICON_KEY_SET,
  RECOMMENDED_LUCIDE_STATIC_ICON_KEYS,
  ZVibecanvasToolIcon,
  isLucideStaticIconKey,
} from './tool-icon';
export {
  WIDGET_FRAME_FALLBACK,
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
} from './CONSTANTS';
export { fnCanonicalizeWidgetContractPayload } from './core/fn.contract';
export { fnValidateWidgetBuildIntegrity } from './core/fn.build-integrity';
export type {
  TWidgetBuildIntegrityArgs,
  TWidgetBuildIntegrityValidation,
} from './core/fn.build-integrity';
export {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetCapsuleRuntimeDescriptor,
  fnNormalizeWidgetCapsuleBudgetRequest,
  fnNormalizeWidgetCapsuleBudgets,
  fnNormalizeWidgetCapsuleCapabilityRequests,
  fnNormalizeWidgetCapsuleChannelContract,
  fnNormalizeWidgetCapsuleRuntimeDescriptor,
  fnNormalizeWidgetCapsuleTarget,
} from './core/fn.capsule';
export {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetBrowserFunctionDescriptor,
  fnNormalizeWidgetBrowserFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
  fnNormalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetServerFunctionCapabilityRequestMatches,
} from './core/fn.function-descriptor';
export { fnGenerateWidgetServerFunctionClientModule } from './core/fn.server-function-client-module';
export {
  fnNormalizeWidgetFrame,
  fnWidgetPlacementRefKey,
  fnWidgetPlacementToolId,
} from './core/fn.widget-frame';
export {
  fnCanonicalizeWidgetManifest,
  fnNormalizeWidgetManifest,
  fnNormalizeWidgetRelativePath,
  fnValidateWidgetResourceBindings,
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
} from './core/fn.manifest';

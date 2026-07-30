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
  ZWidgetCapsuleAllowedApis,
  ZWidgetCapsuleApis,
  ZWidgetCapsuleCapabilityRequest,
  ZWidgetCapsuleChannelContract,
  ZWidgetCapsuleParkability,
  ZWidgetCapsuleSchemaReference,
  ZWidgetManifestV3,
} from './manifest-schema';
export { ZWidgetCapsuleRuntimeDescriptor } from './runtime-descriptor-schema';
export {
  WIDGET_DIAGNOSTIC_FORMAT_VERSION,
  ZWidgetDiagnostic,
} from './diagnostic-schema';
export type {
  TWidgetDiagnostic,
  TWidgetDiagnosticFingerprintInput,
} from './diagnostic-schema';
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
export {
  fnCanonicalizeWidgetConstructionContractPayload,
} from './core/fn.construction-contract';
export {
  fnCanonicalizeWidgetDiagnosticFingerprint,
  fnWidgetDiagnosticFingerprint,
} from './core/fn.diagnostic';
export {
  fnNormalizeWidgetBuildError,
  fnNormalizeWidgetBuildDiagnostics,
} from './core/fn.normalize-build-diagnostic';
export {
  fnCanonicalizeWidgetPreviewBuildKey,
  fnCanonicalizeWidgetPreviewConstructionKey,
  fnWidgetPreviewBuildKey,
  fnWidgetPreviewConstructionKey,
  fnWidgetPreviewWorkspaceKey,
} from './core/fn.preview-build-key';
export type {
  TWidgetPreviewBuildEnvironment,
  TWidgetPreviewBuildKeyInput,
  TWidgetPreviewConstructionKeyInput,
  TWidgetPreviewWorkspaceKeyInput,
} from './core/fn.preview-build-key';
export {
  fnCanonicalizeWidgetPreviewBindingPlan,
  fnWidgetPreviewBindingPlanDigest,
} from './core/fn.preview-binding-plan';
export {
  fnCanonicalizeWidgetPreviewPublicationIdentity,
  fnWidgetPreviewConstructionMatchesPublication,
  fnWidgetPreviewPublicationFingerprint,
} from './core/fn.preview-publication';
export {
  fnValidateWidgetBuildIntegrity,
  fnWidgetBuildIntegrityDiagnostic,
  fnWidgetSourceSnapshotIdentityMatches,
} from './core/fn.build-integrity';
export type {
  TWidgetBuildIntegrityArgs,
  TWidgetBuildIntegrityValidation,
} from './core/fn.build-integrity';
export {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetCapsuleRuntimeDescriptor,
  fnNormalizeWidgetCapsuleBudgetRequest,
  fnNormalizeWidgetCapsuleApiContract,
  fnNormalizeWidgetCapsuleApis,
  fnNormalizeWidgetCapsuleCapabilityRequests,
  fnNormalizeWidgetCapsuleChannelContract,
  fnNormalizeWidgetCapsuleRuntimeDescriptor,
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

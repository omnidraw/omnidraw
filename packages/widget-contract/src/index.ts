/**
 * @file Public widget manifest and immutable artifact contract surface.
 */

export type * from './interface';
export type * from './types';
export type * from './filesystem/typed';
export {
  ZWidgetManifestV4,
  ZWidgetReleaseDescriptor,
  ZWidgetUnsignedReleaseDescriptor,
  parseWidgetManifestV4Json,
  parseWidgetReleaseJson,
} from './filesystem/schema';
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
  ZWidgetResourceRequirement,
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
  ZOmnidrawToolIcon,
  isLucideStaticIconKey,
} from './tool-icon';
export {
  WIDGET_FRAME_FALLBACK,
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
  WIDGET_DESCRIPTION_MAX_CHARACTERS,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
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
} from './core/fn.manifest';
export {
  fnCanonicalizeWidgetExecutableManifest,
  fnCanonicalizeWidgetManifestV4,
  fnCanonicalizeWidgetPresentation,
  fnNormalizeWidgetManifestV4,
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
  fnWidgetExecutableManifestDigest,
  fnWidgetManifestV4Digest,
} from './core/fn.filesystem-manifest';
export {
  fnNormalizeWidgetFilesystemRelativePath,
  fnUtf8ByteLength,
  fnWidgetToolIconTextError,
} from './core/fn.filesystem-path';
export {
  fnCanonicalizeWidgetExecutableInput,
  fnWidgetExecutableInputDigest,
} from './core/fn.filesystem-input';
export { fnClassifyWidgetChange } from './core/fn.filesystem-change';
export {
  fnCanonicalizeWidgetReleaseDirectoryFiles,
  fnCanonicalizeWidgetReleaseDescriptor,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnCreateWidgetReleaseDescriptor,
  fnCreateWidgetUnsignedReleaseDescriptor,
  fnValidateWidgetRelease,
  fnWidgetReleaseDirectoryDigest,
} from './core/fn.filesystem-release';

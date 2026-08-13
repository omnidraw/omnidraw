/**
 * @file Public widget manifest and immutable artifact contract surface.
 */

export type * from './types';
export type * from './filesystem/typed';
export {
  ZWidgetExecutableManifest,
  ZWidgetBuildReceipt,
  ZWidgetManifestV1,
  ZWidgetReleaseDescriptor,
  ZWidgetUnsignedReleaseDescriptor,
  parseWidgetManifestV1Json,
  parseWidgetBuildReceiptJson,
  parseWidgetReleaseJson,
} from './filesystem/schema';
export {
  fnCanonicalizeWidgetBuildReceipt,
  fnCanonicalizeWidgetBuildReceiptEvidence,
  fnCanonicalizeWidgetPortableExecutableInput,
  fnCanonicalizeWidgetPortableSource,
  fnCreateWidgetBuildReceipt,
  fnNormalizeWidgetBuildReceiptOutputs,
  fnWidgetBuildReceiptIdentityMatches,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
} from './fn.portable-build-receipt';
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
  ZWidgetExecutableResourceRequirement,
  ZWidgetResourceId,
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
  WIDGET_BUILD_RECEIPT_FORMAT,
  WIDGET_BUILD_RECEIPT_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_OUTPUT_COUNT_MAX,
  WIDGET_BUILD_RECEIPT_PATH,
  WIDGET_MANIFEST_V1_SCHEMA_URL,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
} from './CONSTANTS';
export { fnCanonicalizeWidgetContractPayload } from './fn.contract';
export {
  fnCanonicalizeWidgetConstructionContractPayload,
} from './fn.construction-contract';
export {
  fnCanonicalizeWidgetDiagnosticFingerprint,
  fnWidgetDiagnosticFingerprint,
} from './fn.diagnostic';
export {
  fnNormalizeWidgetBuildError,
  fnNormalizeWidgetBuildDiagnostics,
} from './fn.normalize-build-diagnostic';
export {
  fnValidateWidgetBuildIntegrity,
  fnWidgetBuildIntegrityDiagnostic,
  fnWidgetSourceSnapshotIdentityMatches,
} from './fn.build-integrity';
export type {
  TWidgetBuildIntegrityArgs,
  TWidgetBuildIntegrityValidation,
} from './fn.build-integrity';
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
} from './fn.capsule';
export {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetBrowserFunctionDescriptor,
  fnNormalizeWidgetBrowserFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
  fnNormalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetBrowserFunctionCapabilityRequestMatches,
  fnWidgetServerFunctionCapabilityRequestMatches,
} from './fn.function-descriptor';
export { fnGenerateWidgetServerFunctionClientModule } from './fn.server-function-client-module';
export {
  fnNormalizeWidgetFrame,
  fnWidgetPlacementRefKey,
  fnWidgetPlacementToolId,
} from './fn.widget-frame';
export {
  fnNormalizeWidgetRelativePath,
} from './fn.manifest';
export {
  fnCanonicalizeWidgetExecutableManifest,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnCanonicalizeWidgetPresentation,
  fnNormalizeWidgetExecutableProjection,
  fnNormalizeWidgetManifestV1,
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
  fnWidgetExecutableManifestDigest,
  fnWidgetManifestV1Digest,
} from './fn.filesystem-manifest';
export {
  fnNormalizeWidgetFilesystemRelativePath,
  fnUtf8ByteLength,
  fnWidgetToolIconTextError,
} from './fn.filesystem-path';
export {
  fnCanonicalizeWidgetExecutableInput,
  fnWidgetExecutableInputDigest,
} from './fn.filesystem-input';
export { fnClassifyWidgetChange } from './fn.filesystem-change';
export {
  fnCanonicalizeWidgetReleaseDirectoryFiles,
  fnCanonicalizeWidgetReleaseDescriptor,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnCreateWidgetReleaseDescriptor,
  fnCreateWidgetUnsignedReleaseDescriptor,
  fnValidateWidgetRelease,
  fnWidgetReleaseDirectoryDigest,
} from './fn.filesystem-release';

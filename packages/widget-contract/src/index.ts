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
export { ZWidgetManifestV2 } from './manifest-schema';
export { fnCanonicalizeWidgetContractPayload } from './core/fn.contract';
export {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
  fnNormalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
} from './core/fn.function-descriptor';
export { fnGenerateWidgetServerFunctionClientModule } from './core/fn.server-function-client-module';
export {
  fnCanonicalizeWidgetManifest,
  fnNormalizeWidgetManifest,
  fnNormalizeWidgetRelativePath,
  fnValidateWidgetResourceBindings,
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
} from './core/fn.manifest';

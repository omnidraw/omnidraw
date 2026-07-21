/**
 * @file Public widget manifest and immutable artifact contract surface.
 */

export type * from './interface';
export type * from './types';
export { ZWidgetManifestV2 } from './manifest-schema';
export { fnCanonicalizeWidgetContractPayload } from './core/fn.contract';
export {
  fnCanonicalizeWidgetManifest,
  fnNormalizeWidgetManifest,
  fnNormalizeWidgetRelativePath,
  fnValidateWidgetResourceBindings,
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
} from './core/fn.manifest';

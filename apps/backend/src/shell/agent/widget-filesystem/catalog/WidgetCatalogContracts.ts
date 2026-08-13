import {
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '#backend/core/widget-domain';
import {
  fnCanonicalizeWidgetPresentation,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnNormalizeWidgetFilesystemRelativePath,
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
  fnValidateWidgetRelease,
  fnWidgetExecutableManifestDigest,
  fnWidgetManifestV1Digest,
  fnWidgetReleaseDirectoryDigest,
  parseWidgetManifestV1Json,
  parseWidgetReleaseJson,
} from '#backend/core/widget-domain/filesystem';
import type { TWidgetCatalogContractEffects } from './typed';

/** A109's edge adapter over the pure A108 contract surface. */
export const WIDGET_CATALOG_CONTRACTS: TWidgetCatalogContractEffects = Object.freeze({
  normalizeRelativePath: fnNormalizeWidgetFilesystemRelativePath,
  parseManifestJson: parseWidgetManifestV1Json,
  parseReleaseJson: parseWidgetReleaseJson,
  parseFunctionsJson(value) {
    const envelope = JSON.parse(value) as unknown;
    if (
      envelope === null
      || typeof envelope !== 'object'
      || Array.isArray(envelope)
      || !Object.hasOwn(envelope, 'functions')
    ) throw new TypeError('Generated server functions must use the canonical envelope.');
    const functions = ZWidgetServerFunctionDescriptors.parse(
      (envelope as Readonly<{ functions: unknown }>).functions,
    );
    if (value !== fnCanonicalizeWidgetServerFunctionDescriptors(functions)) {
      throw new TypeError('Generated server functions are not canonical.');
    }
    return functions;
  },
  projectPresentation: fnProjectWidgetPresentation,
  projectExecutable: fnProjectWidgetExecutableManifest,
  canonicalizePresentation: fnCanonicalizeWidgetPresentation,
  manifestDigest: fnWidgetManifestV1Digest,
  executableManifestDigest: fnWidgetExecutableManifestDigest,
  releaseDirectoryDigest: fnWidgetReleaseDirectoryDigest,
  canonicalizeUnsignedRelease: fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  validateRelease: fnValidateWidgetRelease,
});

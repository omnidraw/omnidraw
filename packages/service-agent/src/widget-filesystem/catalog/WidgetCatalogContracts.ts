import {
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '@omnidraw/widget-contract';
import {
  fnCanonicalizeWidgetPresentation,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnNormalizeWidgetFilesystemRelativePath,
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
  fnValidateWidgetRelease,
  fnWidgetExecutableManifestDigest,
  fnWidgetManifestV4Digest,
  fnWidgetReleaseDirectoryDigest,
  parseWidgetManifestV4Json,
  parseWidgetReleaseJson,
} from '@omnidraw/widget-contract/filesystem';
import type { TWidgetCatalogContractPortal } from './typed';

/** A109's edge adapter over the pure A108 contract surface. */
export const WIDGET_CATALOG_CONTRACTS: TWidgetCatalogContractPortal = Object.freeze({
  normalizeRelativePath: fnNormalizeWidgetFilesystemRelativePath,
  parseManifestJson: parseWidgetManifestV4Json,
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
  manifestDigest: fnWidgetManifestV4Digest,
  executableManifestDigest: fnWidgetExecutableManifestDigest,
  releaseDirectoryDigest: fnWidgetReleaseDirectoryDigest,
  canonicalizeUnsignedRelease: fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  validateRelease: fnValidateWidgetRelease,
});

import type { TWidgetContractPayloadInput } from '../types';

/** Stable payload used to hash and independently verify a published widget contract. */
export function fnCanonicalizeWidgetContractPayload(
  input: TWidgetContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'vibecanvas.widget-contract.v1',
    canonicalManifestJson: input.canonicalManifestJson,
    uiDigestSha256: input.uiDigestSha256,
    serverDigestSha256: input.serverDigestSha256,
    runtimeAbi: input.runtimeAbi,
  });
}

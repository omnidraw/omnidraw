import type {
  TWidgetArtifactCodecPort,
  TVerifiedWidgetUiArtifact,
} from './interface';
import { WIDGET_UI_ARTIFACT_ENVELOPE_DECODER } from './CONSTANTS';

export type TPortal = Readonly<{
  codec: TWidgetArtifactCodecPort;
}>;

export type TArgs = Readonly<{
  expectedDigestSha256: string;
  bytesBase64: string;
}>;

export async function fxDecodeAndVerifyUiArtifact(
  portal: TPortal,
  args: TArgs,
): Promise<TVerifiedWidgetUiArtifact> {
  const artifactBytes = portal.codec.decodeBase64(args.bytesBase64);
  const digestSha256 = await portal.codec.digestSha256(artifactBytes);
  if (digestSha256 !== args.expectedDigestSha256) {
    throw new Error('Widget UI artifact digest mismatch.');
  }
  const envelope = WIDGET_UI_ARTIFACT_ENVELOPE_DECODER(
    portal.codec.decodeUtf8(artifactBytes),
  );
  const outputs = await Promise.all(envelope.outputs.map(async (descriptor) => {
    const bytes = portal.codec.decodeBase64(descriptor.bytesBase64);
    if (await portal.codec.digestSha256(bytes) !== descriptor.digestSha256) {
      throw new Error('Widget UI artifact output digest mismatch.');
    }
    return Object.freeze({
      descriptor,
      bytes,
      text: descriptor.loader === 'js'
        || descriptor.loader === 'css'
        || descriptor.loader === 'json'
        ? portal.codec.decodeUtf8(bytes)
        : null,
    });
  }));
  const retainedByteSize = outputs.reduce((size, output) => {
    return size
      + output.bytes.byteLength
      + output.descriptor.bytesBase64.length
      + (output.text?.length ?? 0) * 2;
  }, 0);
  return Object.freeze({
    digestSha256,
    envelope,
    outputs: Object.freeze(outputs),
    retainedByteSize,
  });
}

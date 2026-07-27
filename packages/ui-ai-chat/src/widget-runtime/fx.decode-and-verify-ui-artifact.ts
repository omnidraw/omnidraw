import type {
  TWidgetArtifactCodecPort,
  TVerifiedWidgetUiArtifact,
} from './interface';
import type { TWidgetCapsuleRuntimeDescriptor } from '@vibecanvas/widget-contract';

export type TPortal = Readonly<{
  codec: TWidgetArtifactCodecPort;
}>;

export type TArgs = Readonly<{
  expectedDigestSha256: string;
  expectedCapsuleArtifactHash: `sha256:${string}`;
  bytesBase64: string;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
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
  if (
    args.runtimeDescriptor.capsuleArtifactHash !== args.expectedCapsuleArtifactHash
  ) {
    throw new Error('Widget Capsule artifact hash metadata mismatch.');
  }
  return Object.freeze({
    digestSha256,
    bytes: Uint8Array.from(artifactBytes),
    capsuleArtifactHash: args.expectedCapsuleArtifactHash,
    runtimeDescriptor: args.runtimeDescriptor,
    retainedByteSize: artifactBytes.byteLength,
  });
}

import type {
  CapsuleArtifactSigningKey,
} from '@omnidraw/capsule/sign';
import type {
  TWidgetArtifactSigningPurpose,
  TWidgetArtifactHash,
} from '@omnidraw/sdk/contract';

export type TEffects = Readonly<{
  loadKeys(purpose: TWidgetArtifactSigningPurpose):
  Promise<readonly CapsuleArtifactSigningKey[]>;
  sign(
    bytes: Uint8Array,
    keys: readonly CapsuleArtifactSigningKey[],
  ): Promise<Uint8Array>;
}>;

export type TArgs = Readonly<{
  bytes: Uint8Array;
  capsuleArtifactHash: TWidgetArtifactHash;
  purpose: TWidgetArtifactSigningPurpose;
}>;

export async function signOmnidrawCapsuleArtifact(
  effects: TEffects,
  args: TArgs,
): Promise<Readonly<{
  signedBytes: Uint8Array;
  signatureKeyIds: readonly string[];
}>> {
  const keys = await effects.loadKeys(args.purpose);
  if (keys.length === 0) {
    throw new Error('Capsule signing requires at least one trusted key.');
  }
  const keyIds = keys.map((key) => key.keyId).sort();
  if (new Set(keyIds).size !== keyIds.length) {
    throw new Error('Capsule signing key IDs must be unique.');
  }
  const signedBytes = await effects.sign(args.bytes, keys);
  return Object.freeze({
    signedBytes: new Uint8Array(signedBytes),
    signatureKeyIds: Object.freeze(keyIds),
  });
}

import type {
  CapsuleArtifactSigningKey,
} from '@omnidraw/capsule/sign';
import type {
  TWidgetCapsuleArtifactSigningPurpose,
  TWidgetCapsuleHash,
} from '@omnidraw/widget-contract';

export type TPortal = Readonly<{
  loadKeys(purpose: TWidgetCapsuleArtifactSigningPurpose):
  Promise<readonly CapsuleArtifactSigningKey[]>;
  sign(
    bytes: Uint8Array,
    keys: readonly CapsuleArtifactSigningKey[],
  ): Promise<Uint8Array>;
}>;

export type TArgs = Readonly<{
  bytes: Uint8Array;
  capsuleArtifactHash: TWidgetCapsuleHash;
  purpose: TWidgetCapsuleArtifactSigningPurpose;
}>;

export async function txSignOmnidrawCapsuleArtifact(
  portal: TPortal,
  args: TArgs,
): Promise<Readonly<{
  signedBytes: Uint8Array;
  signatureKeyIds: readonly string[];
}>> {
  const keys = await portal.loadKeys(args.purpose);
  if (keys.length === 0) {
    throw new Error('Capsule signing requires at least one trusted key.');
  }
  const keyIds = keys.map((key) => key.keyId).sort();
  if (new Set(keyIds).size !== keyIds.length) {
    throw new Error('Capsule signing key IDs must be unique.');
  }
  const signedBytes = await portal.sign(args.bytes, keys);
  return Object.freeze({
    signedBytes: new Uint8Array(signedBytes),
    signatureKeyIds: Object.freeze(keyIds),
  });
}

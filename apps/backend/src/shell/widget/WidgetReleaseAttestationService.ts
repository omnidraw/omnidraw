import { createHash, webcrypto } from 'node:crypto';
import {
  OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST,
  OMNIDRAW_CAPSULE_API_CONTRACT_FORMAT,
  fnMapCapsuleApis,
} from '#backend/shell/widget-runtime/contract';
import type {
  TWidgetCatalogCapsuleInspectionEffects,
} from '#backend/shell/agent';
import type {
  IWidgetCapsuleHostConfigurationReader,
} from '#backend/shell/widget';
import type {
  TWidgetReleaseAttestation,
} from '@omnidraw/sdk/contract';
import {
  WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from './CONSTANTS';
import type { WidgetCapsuleSigningKeyStore } from './WidgetCapsuleSigningKeyStore';

const RELEASE_ATTESTATION_DOMAIN = new TextEncoder().encode(
  'omnidraw-widget-release-attestation-v1\0',
);

function attestationMessage(canonicalUnsignedReleaseJson: string): Uint8Array {
  const body = new TextEncoder().encode(canonicalUnsignedReleaseJson);
  const message = new Uint8Array(RELEASE_ATTESTATION_DOMAIN.byteLength + body.byteLength);
  message.set(RELEASE_ATTESTATION_DOMAIN);
  message.set(body, RELEASE_ATTESTATION_DOMAIN.byteLength);
  return message;
}

function canonicalBase64Bytes(value: string): Uint8Array | null {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  return Buffer.from(bytes).toString('base64') === value ? bytes : null;
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/**
 * Deployment-local release attestation authority. This never parses or runs
 * guest bytes. The canonical release file hashes bind the final signed Capsule
 * envelope while Capsule itself independently verifies its embedded signature
 * at the browser mount boundary.
 */
export class WidgetReleaseAttestationService
implements TWidgetCatalogCapsuleInspectionEffects {
  constructor(
    readonly keys: WidgetCapsuleSigningKeyStore,
    readonly hostConfiguration: IWidgetCapsuleHostConfigurationReader,
  ) {}

  async attest(
    canonicalUnsignedReleaseJson: string,
  ): Promise<TWidgetReleaseAttestation> {
    const signing = (await this.keys.loadSigningKeys('release')).find(
      (key) => key.keyId === WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
    );
    if (signing?.keyId !== WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID) {
      throw new Error('The current widget release signing key is unavailable.');
    }
    const signature = await webcrypto.subtle.sign(
      'Ed25519',
      signing.privateKey,
      copiedArrayBuffer(attestationMessage(canonicalUnsignedReleaseJson)),
    );
    return Object.freeze({
      algorithm: 'Ed25519' as const,
      keyId: signing.keyId,
      signatureBase64: Buffer.from(signature).toString('base64'),
    });
  }

  async inspectCapsuleArtifact(
    args: Parameters<TWidgetCatalogCapsuleInspectionEffects['inspectCapsuleArtifact']>[0],
  ): Promise<Awaited<ReturnType<TWidgetCatalogCapsuleInspectionEffects['inspectCapsuleArtifact']>>> {
    const exactByteDigest = createHash('sha256').update(args.bytes).digest('hex');
    const hostConfiguration = await this.hostConfiguration.read();
    const normalizedApis = fnMapCapsuleApis(args.expectedRuntime.apiContract.groups);
    const requestedBudgets = args.expectedRuntime.budgets as Readonly<Record<string, number>>;
    const hostLimits = hostConfiguration.limits as Readonly<Record<string, number>>;
    const budgetOutsidePolicy = Object.entries(requestedBudgets).some(([dimension, value]) => (
      !Number.isFinite(value)
      || value < 0
      || (hostLimits[dimension] !== undefined && value > hostLimits[dimension]!)
    ));
    if (
      args.expectedCapsuleFile.path !== 'capsule.artifact'
      || args.bytes.byteLength !== args.expectedCapsuleFile.byteSize
      || exactByteDigest !== args.expectedCapsuleFile.sha256
      || args.releaseAttestation.algorithm !== 'Ed25519'
      || args.releaseAttestation.keyId !== WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID
      || args.expectedRuntime.apiContract.format !== OMNIDRAW_CAPSULE_API_CONTRACT_FORMAT
      || args.expectedRuntime.apiContract.bundleDigest !== OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST
      || !sameStrings(normalizedApis, args.expectedRuntime.apiContract.groups)
      || !sameStrings(args.expectedRuntime.apiContract.groups, args.expectedApis)
      || !args.expectedRuntime.apiContract.groups.every((api) => (
        hostConfiguration.allowedApis.includes(api)
      ))
      || budgetOutsidePolicy
      || !args.expectedRuntime.signatureKeyIds.includes(
        WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
      )
    ) throw new Error('Widget release attestation policy does not match the current host.');

    const signature = canonicalBase64Bytes(args.releaseAttestation.signatureBase64);
    if (signature === null || signature.byteLength !== 64) {
      throw new Error('Widget release attestation signature is malformed.');
    }
    const publicDescriptor = (await this.keys.publicSigningKeys()).find(
      (key) => key.keyId === WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
    );
    if (publicDescriptor === undefined) {
      throw new Error('The current widget release verification key is unavailable.');
    }
    const publicBytes = canonicalBase64Bytes(publicDescriptor.publicKeyBase64);
    if (publicBytes === null || publicBytes.byteLength !== 32) {
      throw new Error('The current widget release verification key is malformed.');
    }
    const publicKey = await webcrypto.subtle.importKey(
      'raw',
      copiedArrayBuffer(publicBytes),
      'Ed25519',
      false,
      ['verify'],
    );
    const valid = await webcrypto.subtle.verify(
      'Ed25519',
      publicKey,
      copiedArrayBuffer(signature),
      copiedArrayBuffer(attestationMessage(args.canonicalUnsignedReleaseJson)),
    );
    if (!valid) throw new Error('Widget release attestation is not trusted.');
    return Object.freeze({
      artifactHash: args.expectedRuntime.artifactHash,
      runtime: args.expectedRuntime,
    });
  }
}

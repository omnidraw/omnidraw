/** @file Process-local, single-use resource write capabilities. */

import { Buffer } from 'node:buffer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  IResourceWriteCapabilityVerifier,
  IResourceWritePermitCoordinator,
  TResourceWriteCapabilityClaims,
  TResourceWritePermitScope,
} from '@omnidraw/resource-runtime';
import { ResourceError } from '@omnidraw/resource-runtime';
import type { TEphemeralResourceWritePermit } from '../types';

type TPermitRecord = {
  permit: TEphemeralResourceWritePermit;
  nonce: string;
  status: 'active' | 'in_use';
};

export type TEphemeralResourceWritePermitAuthorityConfig = Readonly<{
  secret: Uint8Array;
  audience?: string;
  nowMs?: () => number;
  createId?: () => string;
  createNonce?: () => string;
}>;

type TIssueWritePermitArgs = Readonly<{
  resourceId: string;
  invocationId: string;
  operation: string;
  operationId: string;
  operationFingerprintSha256: string;
  expiresAtMs: number;
}>;

function encoded(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url');
}

function decoded(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function claims(value: unknown): (TResourceWriteCapabilityClaims & { audience: string }) | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.permitId !== 'string'
    || typeof item.resourceId !== 'string'
    || typeof item.invocationId !== 'string'
    || typeof item.operation !== 'string'
    || typeof item.operationId !== 'string'
    || typeof item.operationFingerprintSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(item.operationFingerprintSha256)
    || !Number.isSafeInteger(item.expiresAtMs)
    || typeof item.nonce !== 'string'
    || typeof item.audience !== 'string'
  ) return null;
  return item as TResourceWriteCapabilityClaims & { audience: string };
}

function samePermit(
  record: TPermitRecord,
  item: TResourceWriteCapabilityClaims,
): boolean {
  const permit = record.permit;
  return record.nonce === item.nonce
    && permit.id === item.permitId
    && permit.resourceId === item.resourceId
    && permit.invocationId === item.invocationId
    && permit.operation === item.operation
    && permit.operationId === item.operationId
    && permit.operationFingerprintSha256 === item.operationFingerprintSha256
    && permit.expiresAtMs === item.expiresAtMs;
}

/**
 * Issues a capability once, moves it to in-use around one provider callback,
 * then deletes it regardless of success. Nothing can be recovered on restart.
 */
export class EphemeralResourceWritePermitAuthority implements
  IResourceWriteCapabilityVerifier,
  IResourceWritePermitCoordinator {
  readonly #secret: Uint8Array;
  readonly #audience: string;
  readonly #nowMs: () => number;
  readonly #createId: () => string;
  readonly #createNonce: () => string;
  readonly #permits = new Map<string, TPermitRecord>();

  constructor(config: TEphemeralResourceWritePermitAuthorityConfig) {
    if (config.secret.byteLength < 32) {
      throw new TypeError('Resource write capability secret must contain at least 32 bytes.');
    }
    this.#secret = config.secret.slice();
    this.#audience = config.audience ?? 'omnidraw.resource-store';
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createId = config.createId ?? randomUUID;
    this.#createNonce = config.createNonce ?? randomUUID;
  }

  issueWriteCapability(args: TIssueWritePermitArgs): Readonly<{
    permit: TEphemeralResourceWritePermit;
    capability: string;
  }> {
    const nowMs = this.#nowMs();
    if (
      args.expiresAtMs <= nowMs
      || args.expiresAtMs > nowMs + 30_000
      || !/^[0-9a-f]{64}$/.test(args.operationFingerprintSha256)
    ) throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'Write permit request is invalid.');
    const id = this.#createId();
    if (this.#permits.has(id)) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'Write permit identity collided.');
    }
    const nonce = this.#createNonce();
    const permit = Object.freeze({
      id,
      resourceId: args.resourceId,
      invocationId: args.invocationId,
      operation: args.operation,
      operationId: args.operationId,
      operationFingerprintSha256: args.operationFingerprintSha256,
      expiresAtMs: args.expiresAtMs,
    });
    const value = {
      permitId: id,
      resourceId: permit.resourceId,
      invocationId: permit.invocationId,
      operation: permit.operation,
      operationId: permit.operationId,
      operationFingerprintSha256: permit.operationFingerprintSha256,
      expiresAtMs: permit.expiresAtMs,
      nonce,
      audience: this.#audience,
    };
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    const signature = createHmac('sha256', this.#secret).update(payload).digest();
    this.#permits.set(id, { permit, nonce, status: 'active' });
    return Object.freeze({
      permit,
      capability: `${encoded(payload)}.${encoded(signature)}`,
    });
  }

  async verifyWriteCapability(
    capability: string,
  ): Promise<TResourceWriteCapabilityClaims | null> {
    const [payloadValue, signatureValue, extra] = capability.split('.');
    if (!payloadValue || !signatureValue || extra !== undefined) return null;
    let payload: Buffer;
    let supplied: Buffer;
    let item: ReturnType<typeof claims>;
    try {
      payload = decoded(payloadValue);
      supplied = decoded(signatureValue);
      item = claims(JSON.parse(payload.toString('utf8')));
    } catch {
      return null;
    }
    const expected = createHmac('sha256', this.#secret).update(payload).digest();
    if (
      supplied.byteLength !== expected.byteLength
      || !timingSafeEqual(supplied, expected)
      || item === null
      || item.audience !== this.#audience
      || item.expiresAtMs <= this.#nowMs()
    ) return null;
    const record = this.#permits.get(item.permitId);
    if (record === undefined || record.status !== 'active' || !samePermit(record, item)) return null;
    const { audience: _audience, ...publicClaims } = item;
    return Object.freeze(publicClaims);
  }

  async runWithWritePermit<T>(
    scope: TResourceWritePermitScope,
    operation: (guard: Readonly<{ assertCanCommit(): Promise<void> }>) => Promise<T>,
  ): Promise<T> {
    const record = this.#permits.get(scope.claims.permitId);
    if (
      record === undefined
      || record.status !== 'active'
      || !samePermit(record, scope.claims)
      || record.permit.resourceId !== scope.resourceId
      || record.permit.operation !== scope.operation
      || record.permit.operationId !== scope.operationId
      || record.permit.operationFingerprintSha256 !== scope.operationFingerprintSha256
      || record.permit.expiresAtMs <= this.#nowMs()
    ) throw new ResourceError('RESOURCE_WRITE_CAPABILITY_STALE', 'Write permit is no longer live.');
    record.status = 'in_use';
    const guard = Object.freeze({
      assertCanCommit: async () => {
        const current = this.#permits.get(record.permit.id);
        if (
          current !== record
          || current.status !== 'in_use'
          || current.permit.expiresAtMs <= this.#nowMs()
        ) throw new ResourceError('RESOURCE_WRITE_CAPABILITY_STALE', 'Write permit expired before commit.');
      },
    });
    try {
      return await operation(guard);
    } finally {
      this.#permits.delete(record.permit.id);
    }
  }

  activePermitCount(): number {
    return this.#permits.size;
  }

  revokeWritePermit(permitId: string): void {
    this.#permits.delete(permitId);
  }
}

/**
 * @file HMAC capability bridge between the function lease store and Resource Store.
 */

import { Buffer } from 'node:buffer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  IResourceWriteCapabilityVerifier,
  TResourceWriteCapabilityClaims,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { IResourceWritePermitAuthority } from '../interface';
import type { TResourceWritePermit } from '../types';

export interface IResourceWriteCapabilityIssuer {
  issueWriteCapability(
    tenant: TTenantContext,
    permit: TResourceWritePermit,
  ): Promise<string>;
}

export type TResourceWriteCapabilityAuthorityConfig = Readonly<{
  secret: Uint8Array;
  permits: IResourceWritePermitAuthority;
  audience?: string;
  nowMs?: () => number;
  createNonce?: () => string;
}>;

function encoded(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url');
}

function decoded(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function isClaims(value: unknown): value is TResourceWriteCapabilityClaims & { audience: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return typeof claims.orgId === 'string'
    && typeof claims.permitId === 'string'
    && typeof claims.resourceId === 'string'
    && typeof claims.invocationId === 'string'
    && typeof claims.operation === 'string'
    && typeof claims.operationId === 'string'
    && typeof claims.operationFingerprintSha256 === 'string'
    && /^[0-9a-f]{64}$/.test(claims.operationFingerprintSha256)
    && typeof claims.attemptId === 'string'
    && Number.isInteger(claims.leaseEpoch)
    && Number.isInteger(claims.expiresAtMs)
    && typeof claims.nonce === 'string'
    && typeof claims.audience === 'string';
}

/** Capabilities are short-lived and rechecked against the authoritative permit row. */
export class ResourceWriteCapabilityAuthority implements
  IResourceWriteCapabilityIssuer,
  IResourceWriteCapabilityVerifier {
  readonly #secret: Uint8Array;
  readonly #permits: IResourceWritePermitAuthority;
  readonly #audience: string;
  readonly #nowMs: () => number;
  readonly #createNonce: () => string;

  constructor(config: TResourceWriteCapabilityAuthorityConfig) {
    if (config.secret.byteLength < 32) {
      throw new TypeError('Resource write capability secret must contain at least 32 bytes.');
    }
    this.#secret = config.secret.slice();
    this.#permits = config.permits;
    this.#audience = config.audience ?? 'vibecanvas.resource-store';
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createNonce = config.createNonce ?? randomUUID;
  }

  async issueWriteCapability(
    tenant: TTenantContext,
    permit: TResourceWritePermit,
  ): Promise<string> {
    if (
      permit.orgId !== tenant.orgId
      || permit.status !== 'active'
      || permit.expiresAtMs <= this.#nowMs()
    ) {
      throw new Error('Cannot issue a resource capability for an inactive write permit.');
    }
    const payload = Buffer.from(JSON.stringify({
      orgId: permit.orgId,
      permitId: permit.id,
      resourceId: permit.resourceId,
      invocationId: permit.invocationId,
      operation: permit.operationName,
      operationId: permit.operationId,
      operationFingerprintSha256: permit.operationFingerprintSha256,
      attemptId: permit.attemptId,
      leaseEpoch: permit.leaseEpoch,
      expiresAtMs: permit.expiresAtMs,
      nonce: this.#createNonce(),
      audience: this.#audience,
    }), 'utf8');
    const signature = createHmac('sha256', this.#secret).update(payload).digest();
    return `${encoded(payload)}.${encoded(signature)}`;
  }

  async verifyWriteCapability(
    tenant: TTenantContext,
    capability: string,
  ): Promise<TResourceWriteCapabilityClaims | null> {
    const [payloadValue, signatureValue, extra] = capability.split('.');
    if (!payloadValue || !signatureValue || extra !== undefined) return null;
    let payload: Buffer;
    let supplied: Buffer;
    let claims: unknown;
    try {
      payload = decoded(payloadValue);
      supplied = decoded(signatureValue);
      claims = JSON.parse(payload.toString('utf8'));
    } catch {
      return null;
    }
    const expected = createHmac('sha256', this.#secret).update(payload).digest();
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
    if (!isClaims(claims)) return null;
    if (
      claims.audience !== this.#audience
      || claims.orgId !== tenant.orgId
      || claims.expiresAtMs <= this.#nowMs()
    ) return null;
    const permit = await this.#permits.getWritePermit(tenant, claims.permitId);
    if (
      permit === null
      || permit.status !== 'active'
      || permit.expiresAtMs !== claims.expiresAtMs
      || permit.orgId !== claims.orgId
      || permit.resourceId !== claims.resourceId
      || permit.invocationId !== claims.invocationId
      || permit.operationName !== claims.operation
      || permit.operationId !== claims.operationId
      || permit.operationFingerprintSha256 !== claims.operationFingerprintSha256
      || permit.attemptId !== claims.attemptId
      || permit.leaseEpoch !== claims.leaseEpoch
    ) return null;
    const { audience: _audience, ...publicClaims } = claims;
    return Object.freeze(publicClaims);
  }
}

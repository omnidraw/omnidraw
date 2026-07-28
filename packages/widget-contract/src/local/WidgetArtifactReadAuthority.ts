import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactReadCapabilitySigner,
  IWidgetArtifactReadCapabilityVerifier,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityClaims,
  TWidgetArtifactReadCapabilitySignRequest,
  TWidgetArtifactReadCapabilityVerifyRequest,
} from '..';
import { fnValidateArtifactDigest } from './fn.artifact-path';
import { fnWidgetArtifactCapabilityContextIsValid } from './fn.artifact-read-policy';

const MAX_WIDGET_ARTIFACT_READ_CAPABILITY_LENGTH = 4_096;

export type TWidgetArtifactReadAuthorityConfig = Readonly<{
  secret: Uint8Array;
  maximumTtlMs: number;
  now?: () => number;
}>;

function base64Url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64url');
}

function sign(secret: Uint8Array, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function claimsAreValid(value: unknown): value is TWidgetArtifactReadCapabilityClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  if (Object.keys(claim).length !== 10) return false;
  if (
    typeof claim.orgId !== 'string'
    || typeof claim.definitionId !== 'string'
    || typeof claim.revisionId !== 'string'
    || typeof claim.artifactId !== 'string'
    || !['ui', 'unsigned_ui', 'server', 'source', 'source_map'].includes(String(claim.artifactKind))
    || typeof claim.digestSha256 !== 'string'
    || ![
      'browser_ui',
      'server_execution',
      'source_build',
      'preview_construction',
      'source_map',
      'cell_move',
    ].includes(String(claim.purpose))
    || typeof claim.audience !== 'string'
    || !fnWidgetArtifactCapabilityContextIsValid(claim.audience)
    || typeof claim.expiresAtMs !== 'number'
    || !Number.isSafeInteger(claim.expiresAtMs)
    || typeof claim.nonce !== 'string'
    || !fnWidgetArtifactCapabilityContextIsValid(claim.nonce)
  ) return false;
  try {
    fnValidateArtifactDigest(claim.digestSha256);
  } catch {
    return false;
  }
  return true;
}

/** HMAC-backed short-lived, purpose-bound artifact read authority. */
export class WidgetArtifactReadAuthority implements
  IWidgetArtifactReadCapabilitySigner,
  IWidgetArtifactReadCapabilityVerifier {
  readonly #now: () => number;

  constructor(readonly config: TWidgetArtifactReadAuthorityConfig) {
    if (config.secret.byteLength < 32) {
      throw new Error('Widget artifact read authority requires at least 32 secret bytes.');
    }
    if (!Number.isSafeInteger(config.maximumTtlMs) || config.maximumTtlMs < 1) {
      throw new Error('Widget artifact read authority maximum TTL is invalid.');
    }
    this.#now = config.now ?? Date.now;
  }

  async issueArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilitySignRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    const nowMs = this.#now();
    if (
      !Number.isSafeInteger(request.expiresAtMs)
      || request.expiresAtMs <= nowMs
      || request.expiresAtMs - nowMs > this.config.maximumTtlMs
    ) {
      throw new Error('Widget artifact read capability expiry is invalid.');
    }
    fnValidateArtifactDigest(request.digestSha256);
    const claims: TWidgetArtifactReadCapabilityClaims = Object.freeze({
      orgId: tenant.orgId,
      definitionId: request.definitionId,
      revisionId: request.revisionId,
      artifactId: request.artifactId,
      artifactKind: request.artifactKind,
      digestSha256: request.digestSha256,
      purpose: request.purpose,
      audience: request.audience,
      expiresAtMs: request.expiresAtMs,
      nonce: request.nonce,
    });
    if (!claimsAreValid(claims)) {
      throw new Error('Widget artifact read capability claims are invalid.');
    }
    const payload = base64Url(JSON.stringify(claims));
    const capability = `${payload}.${sign(this.config.secret, payload)}`;
    if (capability.length > MAX_WIDGET_ARTIFACT_READ_CAPABILITY_LENGTH) {
      throw new Error('Widget artifact read capability claims are too large.');
    }
    return capability;
  }

  async verifyArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityVerifyRequest,
  ): Promise<TWidgetArtifactReadCapabilityClaims | null> {
    if (
      request.readCapability.length < 3
      || request.readCapability.length > MAX_WIDGET_ARTIFACT_READ_CAPABILITY_LENGTH
    ) return null;
    const separator = request.readCapability.indexOf('.');
    if (separator < 1 || request.readCapability.indexOf('.', separator + 1) !== -1) return null;
    const payload = request.readCapability.slice(0, separator);
    const signature = request.readCapability.slice(separator + 1);
    if (!constantTimeEqual(sign(this.config.secret, payload), signature)) return null;

    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!claimsAreValid(claims)) return null;
    if (
      claims.orgId !== tenant.orgId
      || claims.purpose !== request.purpose
      || claims.audience !== request.audience
      || claims.expiresAtMs <= request.nowMs
      || claims.expiresAtMs - request.nowMs > this.config.maximumTtlMs
    ) return null;
    return Object.freeze({ ...claims });
  }
}

/**
 * @file Matches decoded resource write-capability claims to a fenced operation.
 */

import type { TResourceWriteCapabilityClaims } from '../types';

type TArgs = Readonly<{
  nowMs: number;
  orgId: string;
  resourceId: string;
  invocationId: string;
  operation: string;
  operationId: string;
  operationFingerprintSha256: string;
  attemptId: string;
  leaseEpoch: number;
}>;

export function fnResourceWriteCapabilityMatches(
  claims: TResourceWriteCapabilityClaims,
  args: TArgs,
): boolean {
  return claims.expiresAtMs > args.nowMs
    && claims.orgId === args.orgId
    && claims.resourceId === args.resourceId
    && claims.invocationId === args.invocationId
    && claims.operation === args.operation
    && claims.operationId === args.operationId
    && claims.operationFingerprintSha256 === args.operationFingerprintSha256
    && claims.attemptId === args.attemptId
    && claims.leaseEpoch === args.leaseEpoch;
}

/**
 * @file Logical resource contracts shared by hosts, gateways, and providers.
 */

import type { TOrganizationId, TTenantContext } from '@vibecanvas/tenant-core';

export type TResourceId = string;
export type TResourceSlot = string;
export type TResourceKind = 'kv' | 'secret_store' | 'db';
export type TResourceEffect = 'read' | 'write' | 'read_write';
export type TResourceOperationName = string;

export type TResourceRequirement = Readonly<{
  slot: TResourceSlot;
  kind: TResourceKind;
  effect: TResourceEffect;
}>;

export type TResourceBinding = Readonly<{
  slot: TResourceSlot;
  resourceId: TResourceId;
  kind: TResourceKind;
  allowRead: boolean;
  allowWrite: boolean;
}>;

export type TResourceCall =
  | Readonly<{
    slot: TResourceSlot;
    operation: TResourceOperationName;
    effect: 'read';
    input: unknown;
  }>
  | Readonly<{
    slot: TResourceSlot;
    operation: TResourceOperationName;
    effect: 'write';
    input: unknown;
    writeCapability: string;
  }>;

export type TResolvedResourceCall = Readonly<{
  tenant: TTenantContext;
  resourceId: TResourceId;
  kind: TResourceKind;
  operation: TResourceOperationName;
  effect: Exclude<TResourceEffect, 'read_write'>;
  input: unknown;
}>;

export type TResourceCallResult<TOutput = unknown> = Readonly<{
  output: TOutput;
}>;

export type TResourceWriteCapabilityClaims = Readonly<{
  orgId: TOrganizationId;
  resourceId: TResourceId;
  operation: TResourceOperationName;
  attemptId: string;
  leaseEpoch: number;
  expiresAtMs: number;
  nonce: string;
}>;

export type TResourceDrainLease = Readonly<{
  resourceId: TResourceId;
  leaseId: string;
  expiresAtMs: number;
}>;

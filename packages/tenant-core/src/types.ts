/**
 * @file Public tenant identity, scope, and placement value types.
 */

export type TOrganizationId = string;
export type TAccountId = string;
export type TCellId = string;
export type TCanvasId = string;
export type TInvocationId = string;
export type TRequestId = string;
export type TPlacementEpoch = number;

export type TTenantRole = string;
export type TTenantCapability = string;

export type TTenantContext = Readonly<{
  orgId: TOrganizationId;
  accountId: TAccountId;
  cellId: TCellId;
  placementEpoch: TPlacementEpoch;
  roles: readonly TTenantRole[];
  capabilities: readonly TTenantCapability[];
  requestId: TRequestId;
  canvasId?: TCanvasId;
  invocationId?: TInvocationId;
}>;

export type TTenantPlacement = Readonly<{
  orgId: TOrganizationId;
  cellId: TCellId;
  epoch: TPlacementEpoch;
}>;

export type TIdentityRequest = Readonly<{
  requestId: TRequestId;
  session: unknown;
}>;

export type TTenantIdentity = Readonly<{
  orgId: TOrganizationId;
  accountId: TAccountId;
  roles: readonly TTenantRole[];
  capabilities: readonly TTenantCapability[];
}>;

export type TTenantContextRequest = Readonly<{
  requestId: TRequestId;
  session: unknown;
  canvasId?: TCanvasId;
  invocationId?: TInvocationId;
}>;

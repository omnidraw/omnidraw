import type { TTenantCapability, TTenantRole } from '@vibecanvas/tenant-core';

export type TOssFakeSession = Readonly<{
  accountId: string;
  capabilities: readonly TTenantCapability[];
  cellId: string;
  mode: 'oss-default-owner';
  orgId: string;
  placementEpoch: number;
  roles: readonly TTenantRole[];
}>;

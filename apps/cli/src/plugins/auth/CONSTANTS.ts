import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import type { TTenantPlacement } from '@vibecanvas/tenant-core';
import type { TOssFakeSession } from './types';

export const OSS_FAKE_SESSION = Object.freeze({
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  capabilities: Object.freeze(['*']),
  cellId: DEFAULT_OSS_CELL_ID,
  mode: 'oss-default-owner',
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
}) satisfies TOssFakeSession;

export const OSS_TENANT_PLACEMENT = Object.freeze({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  cellId: DEFAULT_OSS_CELL_ID,
  epoch: 1,
}) satisfies TTenantPlacement;

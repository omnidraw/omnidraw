import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../CONSTANTS';
import type {
  DbServiceTurso,
  TTenantDb,
} from '../DbServiceTurso/DbServiceTurso';

export const TEST_TENANT: TTenantContext = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: 'local-test-cell',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'service-db-test-request',
});

export type TTenantTestDb = TTenantDb & Pick<DbServiceTurso, 'db'>;

export function bindTestTenant(service: DbServiceTurso): TTenantTestDb {
  return Object.assign(service.forTenant(TEST_TENANT), { db: service.db });
}

export function bindTenantOperation<TPortal, TArgs extends { tenant: TTenantContext }, TResult>(
  operation: (portal: TPortal, args: TArgs) => TResult,
): (portal: TPortal, args: Omit<TArgs, 'tenant'>) => TResult {
  return (portal, args) => operation(portal, { tenant: TEST_TENANT, ...args } as TArgs);
}

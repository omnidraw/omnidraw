import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import type {
  DbServiceTurso,
  TTenantDb,
} from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export const TEST_TENANT = Object.freeze({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: 'service-actor-test-cell',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'service-actor-test-request',
}) satisfies Parameters<DbServiceTurso['forTenant']>[0];

export type TActorTestDb = TTenantDb & Pick<DbServiceTurso, 'db'>;

export function bindTestTenantDb(service: DbServiceTurso): TActorTestDb {
  return Object.assign(service.forTenant(TEST_TENANT), { db: service.db });
}

export function createTestTenantEvents(): ITenantEventPublisherService {
  return new EventPublisherService().forTenant(TEST_TENANT);
}

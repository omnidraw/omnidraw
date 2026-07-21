import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { ZNotificationEvent } from './contract';
import { fxNotificationEvents } from './fx.notification-events';

const tenantA = fnFreezeTenantContext({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'notification-a',
});

const tenantB = fnFreezeTenantContext({
  ...tenantA,
  orgId: 'org-b',
  accountId: 'account-b',
  requestId: 'notification-b',
});

describe('notification warning delivery', () => {
  test('accepts warning severity and atomically replays the latest warning to a late subscriber', async () => {
    const warning = ZNotificationEvent.parse({
      type: 'warning',
      title: 'Widget tooling prerequisites unavailable',
      description: 'Install Node.js and npm.',
    });
    const publisher = new EventPublisherService();
    publisher.publishNotification(tenantB, {
      type: 'error',
      title: 'Tenant B only',
    });
    const sequence = publisher.publishNotification(tenantA, warning);

    const events = fxNotificationEvents(publisher, { tenant: tenantA });
    expect(await events.next()).toEqual({
      done: false,
      value: { ...warning, sequence },
    });
    await events.return(undefined);
    expect(publisher.getLatestNotification(tenantA)).toEqual(warning);
    expect(publisher.getLatestNotification(tenantB)?.title).toBe('Tenant B only');
  });

  test('replays only records after the supplied reconnect cursor', async () => {
    const publisher = new EventPublisherService();
    const firstSequence = publisher.publishNotification(tenantA, {
      type: 'info',
      title: 'Already delivered',
    });
    const secondSequence = publisher.publishNotification(tenantA, {
      type: 'success',
      title: 'Replay me',
    });

    const events = fxNotificationEvents(publisher, {
      afterSequence: firstSequence,
      tenant: tenantA,
    });
    expect(await events.next()).toEqual({
      done: false,
      value: { type: 'success', title: 'Replay me', sequence: secondSequence },
    });
    await events.return(undefined);
  });
});

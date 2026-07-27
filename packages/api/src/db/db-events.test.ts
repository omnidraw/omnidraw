import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import { apiDbEvents } from './api.db-events';

const tenantOwner = fnFreezeTenantContext({
  orgId: 'org-a',
  accountId: 'account-owner',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'db-events-owner',
});

const tenantSameOrgNonmember = fnFreezeTenantContext({
  ...tenantOwner,
  accountId: 'account-nonmember',
  roles: ['member'],
  requestId: 'db-events-nonmember',
});

const tenantForeign = fnFreezeTenantContext({
  ...tenantOwner,
  orgId: 'org-b',
  accountId: 'account-foreign',
  requestId: 'db-events-foreign',
});

const CANVAS_ID = 'canvas-a';
const UNKNOWN_CANVAS_ID = 'canvas-unknown';

type TFixture = ReturnType<typeof createFixture>;

function createFixture() {
  const publisher = new EventPublisherService();
  let subscriptionCount = 0;
  const portal = {
    findCanvasById: async (tenant: TTenantContext, args: { id: string }) => (
      tenant.orgId === tenantOwner.orgId
        && tenant.accountId === tenantOwner.accountId
        && args.id === CANVAS_ID
        ? {
          id: CANVAS_ID,
          name: 'Owner canvas',
          revision: 0,
          created_at: '2026-01-01T00:00:00.000Z',
        }
        : null
    ),
    subscribeDbEventRecords: (tenant: TTenantContext, canvasId: string, options?: { afterSequence?: number }) => {
      subscriptionCount += 1;
      return publisher.subscribeDbEventRecords(tenant, canvasId, options);
    },
  };
  return {
    context: (tenant: TTenantContext) => ({
      db: {
        canvas: {
          findById: portal.findCanvasById,
        },
      },
      eventPublisher: {
        subscribeDbEventRecords: portal.subscribeDbEventRecords,
      },
      tenant,
    }),
    publisher,
    subscriptionCount: () => subscriptionCount,
  };
}

async function rejectionSignature(fixture: TFixture, tenant: TTenantContext, canvasId: string) {
  const subscribe = apiDbEvents.callable({ context: fixture.context(tenant) });
  const events = await subscribe({ canvasId });
  try {
    await events.next();
    throw new Error('Expected rejection.');
  } catch (error) {
    return {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

describe('database event API authorization and replay', () => {
  test('authorizes canvas membership before opening the subscription', async () => {
    const fixture = createFixture();
    const sameOrgNonmember = await rejectionSignature(fixture, tenantSameOrgNonmember, CANVAS_ID);
    const foreign = await rejectionSignature(fixture, tenantForeign, CANVAS_ID);
    const unknown = await rejectionSignature(fixture, tenantOwner, UNKNOWN_CANVAS_ID);

    expect(sameOrgNonmember).toEqual({ name: 'Error', message: 'Canvas not found' });
    expect(foreign).toEqual(sameOrgNonmember);
    expect(unknown).toEqual(sameOrgNonmember);
    expect(fixture.subscriptionCount()).toBe(0);
  });

  test('returns a monotonic sequence and replays only events after the reconnect cursor', async () => {
    const fixture = createFixture();
    const firstSequence = fixture.publisher.publishDbEvent(tenantOwner, CANVAS_ID, {
      data: { change: 'delete', table: 'widgets', id: 'already-delivered' },
    });
    fixture.publisher.publishDbEvent(tenantForeign, CANVAS_ID, {
      data: { change: 'delete', table: 'widgets', id: 'foreign' },
    });
    const secondSequence = fixture.publisher.publishDbEvent(tenantOwner, CANVAS_ID, {
      data: { change: 'delete', table: 'widgets', id: 'replay-me' },
    });

    const subscribe = apiDbEvents.callable({ context: fixture.context(tenantOwner) });
    const events = await subscribe({
      afterSequence: firstSequence,
      canvasId: CANVAS_ID,
    });
    expect(await events.next()).toEqual({
      done: false,
      value: {
        data: { change: 'delete', table: 'widgets', id: 'replay-me' },
        sequence: secondSequence,
      },
    });
    expect(secondSequence).toBe(firstSequence + 1);
    expect(fixture.subscriptionCount()).toBe(1);
    await events.return(undefined);
  });
});

import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { EventPublisherService } from './EventPublisherService';

const tenantA = Object.freeze({
  orgId: '00000000-0000-4000-8000-000000000011',
  accountId: '00000000-0000-4000-8000-000000000012',
  cellId: '00000000-0000-4000-8000-000000000013',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'request-a',
}) satisfies TTenantContext;

const tenantB = Object.freeze({
  ...tenantA,
  orgId: '00000000-0000-4000-8000-000000000021',
  accountId: '00000000-0000-4000-8000-000000000022',
  requestId: 'request-b',
}) satisfies TTenantContext;

describe('EventPublisherService tenant isolation', () => {
  test('isolates identical notification topics and latest values by tenant', async () => {
    const service = new EventPublisherService();
    const iteratorA = service.subscribeNotifications(tenantA)[Symbol.asyncIterator]();
    const nextA = iteratorA.next();

    service.publishNotification(tenantB, { type: 'warning', title: 'Tenant B' });
    service.publishNotification(tenantA, { type: 'info', title: 'Tenant A' });

    expect(await nextA).toEqual({
      done: false,
      value: { type: 'info', title: 'Tenant A' },
    });
    expect(service.getLatestNotification(tenantA)).toEqual({ type: 'info', title: 'Tenant A' });
    expect(service.getLatestNotification(tenantB)).toEqual({ type: 'warning', title: 'Tenant B' });
    await iteratorA.return?.();
  });

  test('supports tenant-scoped wildcard topics and replay cursors', async () => {
    const service = new EventPublisherService();
    service.publishDbEvent(tenantA, 'canvas-a', {
      data: { change: 'delete', table: 'widgets', id: 'one' },
    });
    const cursor = service.getDbEventCursor(tenantA);
    service.publishDbEvent(tenantB, 'canvas-a', {
      data: { change: 'delete', table: 'widgets', id: 'foreign' },
    });
    service.publishDbEvent(tenantA, 'canvas-b', {
      data: { change: 'delete', table: 'widgets', id: 'two' },
    });

    const replay = service.subscribeDbEvents(tenantA, '*', { afterSequence: cursor })[Symbol.asyncIterator]();
    expect(await replay.next()).toEqual({
      done: false,
      value: { data: { change: 'delete', table: 'widgets', id: 'two' } },
    });
    await replay.return?.();
  });

  test('exposes monotonic records for reconnect replay without crossing tenant scopes', async () => {
    const service = new EventPublisherService();
    const firstSequence = service.publishDbEvent(tenantA, 'canvas-a', {
      data: { change: 'delete', table: 'widgets', id: 'first' },
    });
    service.publishDbEvent(tenantB, 'canvas-a', {
      data: { change: 'delete', table: 'widgets', id: 'foreign' },
    });
    const secondSequence = service.publishDbEvent(tenantA, 'canvas-a', {
      data: { change: 'delete', table: 'widgets', id: 'second' },
    });

    const replay = service.subscribeDbEventRecords(tenantA, 'canvas-a', {
      afterSequence: firstSequence,
    })[Symbol.asyncIterator]();
    expect(await replay.next()).toEqual({
      done: false,
      value: {
        event: { data: { change: 'delete', table: 'widgets', id: 'second' } },
        sequence: secondSequence,
      },
    });
    expect(secondSequence).toBe(firstSequence + 1);
    await replay.return?.();
  });

  test('atomically replays the latest notification and resumes after its sequence', async () => {
    const service = new EventPublisherService();
    const firstSequence = service.publishNotification(tenantA, { type: 'info', title: 'First' });

    const initial = service.subscribeNotificationRecords(tenantA)[Symbol.asyncIterator]();
    expect(await initial.next()).toEqual({
      done: false,
      value: { event: { type: 'info', title: 'First' }, sequence: firstSequence },
    });
    await initial.return?.();

    service.publishNotification(tenantB, { type: 'error', title: 'Foreign' });
    const secondSequence = service.publishNotification(tenantA, { type: 'success', title: 'Second' });
    const reconnect = service.subscribeNotificationRecords(tenantA, {
      afterSequence: firstSequence,
    })[Symbol.asyncIterator]();
    expect(await reconnect.next()).toEqual({
      done: false,
      value: { event: { type: 'success', title: 'Second' }, sequence: secondSequence },
    });
    await reconnect.return?.();
  });

  test('isolates identical filesystem paths and watch topics', async () => {
    const service = new EventPublisherService();
    const watchA = service.subscribeFilesystemEvents(tenantA, 'home', '/same')[Symbol.asyncIterator]();
    const nextA = watchA.next();

    service.publishFilesystemEvent(tenantB, 'home', '/same', { eventType: 'change', fileName: 'foreign.txt' });
    service.publishFilesystemEvent(tenantA, 'home', '/same', { eventType: 'change', fileName: 'local.txt' });

    expect(await nextA).toEqual({
      done: false,
      value: { eventType: 'change', fileName: 'local.txt' },
    });
    await watchA.return?.();
  });

  test('creates an immutable tenant-bound capability for legacy services', () => {
    const service = new EventPublisherService();
    const boundA = service.forTenant(tenantA);
    const boundB = service.forTenant(tenantB);

    boundA.publishNotification({ type: 'success', title: 'A' });
    boundB.publishNotification({ type: 'error', title: 'B' });

    expect(Object.isFrozen(boundA)).toBe(true);
    expect(boundA.getLatestNotification()?.title).toBe('A');
    expect(boundB.getLatestNotification()?.title).toBe('B');
  });
});

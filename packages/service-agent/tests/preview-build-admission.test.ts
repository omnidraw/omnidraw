import { describe, expect, test } from 'bun:test';
import {
  PreviewBuildAdmission,
} from '../src/widget-drafts/PreviewBuildAdmission';

function deferred<TResult>() {
  let resolve!: (result: TResult) => void;
  const promise = new Promise<TResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function request(
  admission: PreviewBuildAdmission,
  tenantKey: string,
  draftId: string,
  started: string[],
  gate: ReturnType<typeof deferred<string>>,
  controller = new AbortController(),
) {
  const result = admission.run({
    tenantKey,
    draftId,
    signal: controller.signal,
  }, async () => {
    started.push(`${tenantKey}:${draftId}`);
    return gate.promise;
  });
  return { controller, result };
}

describe('PreviewBuildAdmission', () => {
  test('enforces one active build per draft and two per tenant', async () => {
    const admission = new PreviewBuildAdmission({
      maxActivePerTenant: 2,
      maxActiveGlobal: 4,
    });
    const started: string[] = [];
    const gates = Array.from({ length: 4 }, () => deferred<string>());
    const one = request(admission, 'tenant-a', 'draft-1', started, gates[0]!);
    const sameDraft = request(admission, 'tenant-a', 'draft-1', started, gates[1]!);
    const two = request(admission, 'tenant-a', 'draft-2', started, gates[2]!);
    const tenantLimited = request(admission, 'tenant-a', 'draft-3', started, gates[3]!);

    await Promise.resolve();
    expect(started).toEqual(['tenant-a:draft-1', 'tenant-a:draft-2']);

    gates[0]!.resolve('one');
    await one.result;
    await Promise.resolve();
    expect(started).toEqual([
      'tenant-a:draft-1',
      'tenant-a:draft-2',
      'tenant-a:draft-1',
    ]);

    gates[1]!.resolve('same-draft');
    await sameDraft.result;
    await Promise.resolve();
    expect(started.at(-1)).toBe('tenant-a:draft-3');

    gates[2]!.resolve('two');
    gates[3]!.resolve('three');
    await expect(two.result).resolves.toBe('two');
    await expect(tenantLimited.result).resolves.toBe('three');
  });

  test('enforces the global ceiling and rotates eligible tenants', async () => {
    const admission = new PreviewBuildAdmission({
      maxActivePerTenant: 2,
      maxActiveGlobal: 1,
    });
    const started: string[] = [];
    const gates = Array.from({ length: 3 }, () => deferred<string>());
    const first = request(admission, 'tenant-a', 'draft-1', started, gates[0]!);
    const sameTenant = request(admission, 'tenant-a', 'draft-2', started, gates[1]!);
    const otherTenant = request(admission, 'tenant-b', 'draft-3', started, gates[2]!);

    await Promise.resolve();
    expect(started).toEqual(['tenant-a:draft-1']);
    gates[0]!.resolve('first');
    await first.result;
    await Promise.resolve();
    expect(started).toEqual(['tenant-a:draft-1', 'tenant-b:draft-3']);

    gates[2]!.resolve('other');
    await otherTenant.result;
    await Promise.resolve();
    expect(started.at(-1)).toBe('tenant-a:draft-2');
    gates[1]!.resolve('same');
    await expect(sameTenant.result).resolves.toBe('same');
  });

  test('removes a cancelled queued build without consuming capacity', async () => {
    const admission = new PreviewBuildAdmission({
      maxActivePerTenant: 1,
      maxActiveGlobal: 1,
    });
    const started: string[] = [];
    const activeGate = deferred<string>();
    const cancelledGate = deferred<string>();
    const nextGate = deferred<string>();
    const active = request(admission, 'tenant-a', 'draft-1', started, activeGate);
    const cancelled = request(
      admission,
      'tenant-a',
      'draft-2',
      started,
      cancelledGate,
    );
    const next = request(admission, 'tenant-b', 'draft-3', started, nextGate);

    cancelled.controller.abort();
    await expect(cancelled.result).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_BUILD_SUPERSEDED',
    });
    activeGate.resolve('active');
    await active.result;
    await Promise.resolve();
    expect(started).toEqual(['tenant-a:draft-1', 'tenant-b:draft-3']);
    nextGate.resolve('next');
    await expect(next.result).resolves.toBe('next');
  });
});

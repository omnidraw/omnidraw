import { describe, expect, test } from 'vitest';
import type { TBrowserTenantScope } from '@vibecanvas/canvas/fn.browser-tenant-scope';
import { createSerializedTenantSwitcher } from './tenant-switch-coordinator';
import { txSwitchBrowserTenant } from './tx.switch-browser-tenant';

const scope = Object.freeze({
  accountId: 'account-b',
  cellId: 'cell-b',
  deploymentOrigin: 'https://other.example',
  orgId: 'org-b',
  placementEpoch: 2,
}) satisfies TBrowserTenantScope;

describe('txSwitchBrowserTenant', () => {
  test('tears down every old tenant authority before activating the next scope', async () => {
    const calls: string[] = [];
    await txSwitchBrowserTenant({
      disconnect: async () => { calls.push('disconnect'); },
      clearAutomerge: async () => { calls.push('clear-automerge'); },
      activateClientState: (received) => { calls.push(`client-state:${received.orgId}`); },
      connect: (received) => { calls.push(`connect:${received.orgId}`); },
      bootstrap: async (received) => { calls.push(`bootstrap:${received.orgId}`); },
    }, { scope });

    expect(calls).toEqual([
      'disconnect',
      'clear-automerge',
      'client-state:org-b',
      'connect:org-b',
      'bootstrap:org-b',
    ]);
  });

  test('serializes overlapping switches so the last requested scope wins', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const calls: string[] = [];
    const switchTenant = createSerializedTenantSwitcher({
      switchTenant: async (received) => {
        calls.push(`start:${received.orgId}`);
        if (received.orgId === 'org-b') {
          markFirstStarted();
          await firstBlocked;
        }
        calls.push(`finish:${received.orgId}`);
      },
    });
    const scopeC = Object.freeze({ ...scope, accountId: 'account-c', orgId: 'org-c' });

    const switchingB = switchTenant(scope);
    const switchingC = switchTenant(scopeC);
    await firstStarted;

    expect(calls).toEqual(['start:org-b']);
    releaseFirst();
    await Promise.all([switchingB, switchingC]);
    expect(calls).toEqual([
      'start:org-b',
      'finish:org-b',
      'start:org-c',
      'finish:org-c',
    ]);
  });
});

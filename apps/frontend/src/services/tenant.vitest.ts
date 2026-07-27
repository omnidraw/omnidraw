import { createComputed, createRoot, onCleanup } from 'solid-js';
import { afterEach, describe, expect, test } from 'vitest';
import type { TBrowserTenantScope } from '@vibecanvas/canvas/fn.browser-tenant-scope';
import {
  activateBrowserTenantScope,
  createBrowserTenantBoundary,
  getBrowserTenantActivation,
  getBrowserTenantScope,
} from './tenant';
import { activateFrontendTenantState } from './tenant-client-state';
import { setStore, store } from '../store';
import type { TBackendCanvas } from '../types/backend.types';

const originalScope = getBrowserTenantScope();

function tenantScope(orgId: string): TBrowserTenantScope {
  return Object.freeze({
    accountId: `account-${orgId}`,
    cellId: `cell-${orgId}`,
    deploymentOrigin: 'https://cloud.example',
    orgId,
    placementEpoch: 1,
  });
}

function canvas(orgId: string): TBackendCanvas {
  return {
    id: 'shared-canvas-id',
    name: orgId,
    automerge_url: `automerge:${orgId}`,
    created_at: '2026-01-01 00:00:00',
  };
}

afterEach(() => {
  activateBrowserTenantScope(originalScope);
});

describe('browser tenant reactivity', () => {
  test('notifies Solid computations when the active tenant changes', () => {
    const observed: string[] = [];
    const dispose = createRoot((rootDispose) => {
      createComputed(() => observed.push(getBrowserTenantScope().orgId));
      return rootDispose;
    });

    activateBrowserTenantScope(tenantScope('org-reactive'));

    expect(observed.at(-1)).toBe('org-reactive');
    dispose();
  });

  test('disposes and recreates a same-ID canvas boundary on organization switch', () => {
    const canvasId = 'shared-canvas-id';
    const mounts: string[] = [];
    const unmounts: string[] = [];
    activateBrowserTenantScope(tenantScope('org-a'));

    const dispose = createRoot((rootDispose) => {
      const rendered = createBrowserTenantBoundary((scope) => {
        const identity = `${scope.orgId}:${canvasId}`;
        mounts.push(identity);
        onCleanup(() => unmounts.push(identity));
        return identity;
      });
      createComputed(() => rendered());
      return rootDispose;
    });

    const firstActivation = getBrowserTenantActivation();
    activateBrowserTenantScope(tenantScope('org-b'));

    expect(getBrowserTenantActivation()).not.toBe(firstActivation);
    expect(mounts).toEqual(['org-a:shared-canvas-id', 'org-b:shared-canvas-id']);
    expect(unmounts).toEqual(['org-a:shared-canvas-id']);
    dispose();
  });

  test('publishes no mixed tenant and same-ID canvas pair during scoped store activation', () => {
    const scopeA = tenantScope('org-a');
    const scopeB = tenantScope('org-b');
    activateFrontendTenantState(scopeB);
    setStore('canvases', [canvas('org-b')]);
    activateFrontendTenantState(scopeA);
    setStore('canvases', [canvas('org-a')]);

    const observed: string[] = [];
    const dispose = createRoot((rootDispose) => {
      createComputed(() => {
        observed.push(`${getBrowserTenantScope().orgId}:${store.canvases[0]?.name ?? 'empty'}`);
      });
      return rootDispose;
    });

    activateFrontendTenantState(scopeB);

    expect(observed).toEqual(['org-a:org-a', 'org-b:org-b']);
    expect(observed).not.toContain('org-a:org-b');
    expect(observed).not.toContain('org-b:org-a');
    dispose();
  });
});

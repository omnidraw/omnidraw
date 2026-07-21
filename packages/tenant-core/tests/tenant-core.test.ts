import { describe, expect, test } from 'bun:test';
import {
  fnScopedKey,
  fnTenantContextHasCapability,
  fnTenantContextMatchesPlacement,
  type IIdentityProvider,
  type ITenantContextProvider,
  type TTenantContext,
} from '../src';

const context: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 7,
  roles: ['member'],
  capabilities: ['canvas:read'],
  requestId: 'request-a',
};

describe('tenant-core public contracts', () => {
  test('builds unambiguous scoped keys', () => {
    expect(fnScopedKey('canvas', ['ab', 'c'])).not.toBe(
      fnScopedKey('canvas', ['a', 'bc']),
    );
    expect(fnScopedKey('canvas', ['ab', 'c'])).toBe('6:canvas|2:ab|1:c');
  });

  test('checks capabilities and placement epochs without mutable state', () => {
    expect(fnTenantContextHasCapability(context, 'canvas:read')).toBe(true);
    expect(fnTenantContextHasCapability(context, 'canvas:write')).toBe(false);
    expect(fnTenantContextMatchesPlacement(context, {
      orgId: 'org-a',
      cellId: 'cell-a',
      epoch: 7,
    })).toBe(true);
    expect(fnTenantContextMatchesPlacement(context, {
      orgId: 'org-a',
      cellId: 'cell-a',
      epoch: 8,
    })).toBe(false);
  });

  test('supports a fake managed context provider', async () => {
    const identity: IIdentityProvider = {
      resolveIdentity: async () => ({
        orgId: context.orgId,
        accountId: context.accountId,
        roles: context.roles,
        capabilities: context.capabilities,
      }),
    };
    const provider: ITenantContextProvider = {
      resolveTenantContext: async (request) => ({ ...context, requestId: request.requestId }),
    };

    expect((await identity.resolveIdentity({
      requestId: 'request-b',
      session: { bearer: 'opaque' },
    })).orgId).toBe('org-a');
    expect((await provider.resolveTenantContext({
      requestId: 'request-b',
      session: { bearer: 'opaque' },
    })).requestId).toBe('request-b');
  });
});

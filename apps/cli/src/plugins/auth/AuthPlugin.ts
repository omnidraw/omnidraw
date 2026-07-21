import type { IPlugin } from '@vibecanvas/runtime';
import type { ITenantContextProvider, TTenantContextRequest } from '@vibecanvas/tenant-core';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import type { IRuntimeServices } from '../../setup-services';
import { OSS_FAKE_SESSION } from './CONSTANTS';
import { fnAssertOssTenantPlacement, fnCreateOssTenantContext } from './fn.oss-tenant-context';
import type { TOssFakeSession } from './types';

function createAuthPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'auth',
    apply(ctx) {
      if (ctx.config.helpRequested || ctx.config.versionRequested) return;

      ctx.hooks.boot.tapPromise(async () => {
        const db = ctx.services.get('db');
        if (!db) return;

        await db.account.ensureDefaultOwner();
      });
    },
  };
}

const OSS_TENANT_CONTEXT_PROVIDER: ITenantContextProvider = Object.freeze({
  async resolveTenantContext(request: TTenantContextRequest) {
    return fnAssertOssTenantPlacement(fnCreateOssTenantContext(request));
  },
});

export { createAuthPlugin, OSS_FAKE_SESSION, OSS_TENANT_CONTEXT_PROVIDER };
export type { TOssFakeSession };

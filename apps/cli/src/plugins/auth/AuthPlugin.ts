import type { IPlugin } from '@vibecanvas/runtime';
import { DEFAULT_OSS_ACCOUNT_ID } from '@vibecanvas/service-db/CONSTANTS';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import type { IRuntimeServices } from '../../setup-services';

type TOssFakeSession = {
  accountId: string;
  mode: 'oss-default-owner';
};

function createAuthPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'auth',
    apply(ctx) {
      if (ctx.config.helpRequested || ctx.config.versionRequested) return;

      ctx.hooks.boot.tapPromise(async () => {
        const db = ctx.services.get('db');
        if (!db) return;

        db.account.ensureDefaultOwner();
      });
    },
  };
}

const OSS_FAKE_SESSION: TOssFakeSession = {
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  mode: 'oss-default-owner',
};

export { createAuthPlugin, OSS_FAKE_SESSION };
export type { TOssFakeSession };

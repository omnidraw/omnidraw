import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { OSS_FAKE_SESSION, OSS_TENANT_CONTEXT_PROVIDER } from '../auth/AuthPlugin';
import {
  OSS_LOCAL_FILESYSTEM_CAPABILITY_REF,
  OSS_LOCAL_FILESYSTEM_ID,
} from './CONSTANTS';


function createFilesystemPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'filesystem',
    apply(ctx) {
      ctx.hooks.boot.tapPromise(async () => {
        if (ctx.config.helpRequested || ctx.config.versionRequested) return;

        const db = ctx.services.get('db');
        const filesystem = ctx.services.get('filesystem');
        if (!db || !filesystem) return;

        const tenant = await OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
          requestId: crypto.randomUUID(),
          session: OSS_FAKE_SESSION,
        });
        const existing = await db.filesystem.findById(tenant, { id: OSS_LOCAL_FILESYSTEM_ID });
        if (!existing) {
          await db.filesystem.create(tenant, {
            id: OSS_LOCAL_FILESYSTEM_ID,
            name: 'Local Workspace',
            slug: 'local-workspace',
            path: OSS_LOCAL_FILESYSTEM_CAPABILITY_REF,
            description: 'Trusted filesystem capability for the local Vibecanvas workspace.',
          });
        }
        filesystem.registerRoot(tenant, {
          filesystemId: OSS_LOCAL_FILESYSTEM_ID,
          rootPath: ctx.config.cwd,
        });
      });
    },
  };
}

export { createFilesystemPlugin };

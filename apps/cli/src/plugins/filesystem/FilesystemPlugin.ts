import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';


function createFilesystemPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'filesystem',
    apply(ctx) {
      ctx.hooks.boot.tapPromise(async () => {
        if (ctx.config.helpRequested || ctx.config.versionRequested) return;

        const db = ctx.services.get('db');
        const filesystem = ctx.services.get('filesystem');
        if (!db || !filesystem) return;

      });
    },
  };
}

export { createFilesystemPlugin };

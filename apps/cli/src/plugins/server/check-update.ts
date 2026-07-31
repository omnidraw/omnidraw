import type { ITenantEventPublisherService } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { ICliConfig } from '../../config';
import { checkForUpgrade } from '../cli/cmds/cmd.upgrade';

function checkForUpdateOnBoot(config: ICliConfig, eventPublisher: ITenantEventPublisherService): void {
  checkForUpgrade({ config, checkOnly: true })
    .then((result) => {
      if (result.status === 'update-available') {
        eventPublisher.publishNotification({
          type: 'info',
          title: 'Update Available',
          description: `v${result.version} is available (current: v${config.version}). Run \`omnidraw upgrade\` to update.`,
        });
      }
    })
    .catch(() => { });
}

export { checkForUpdateOnBoot };

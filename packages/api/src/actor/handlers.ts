import { resourceHandlers } from '../resource/handlers';
import { apiActorSnapshot } from './api.actor-snapshot';
import { apiDeleteDefinition } from './api.def-delete';
import { apiGetDefinitions } from './api.def-get';
import { apiListDefinitions } from './api.def-list';
import { apiNotificationEvents } from './api.events';
import { apiActorSendMessage } from './api.instance-send-message';
import { baseActorsOs } from './orpc';

const actorsHandlers = {
  definitions: {
    list: apiListDefinitions,
    get: apiGetDefinitions,
    delete: apiDeleteDefinition,
  },
  events: apiNotificationEvents,
  instances: {
    snapshot: apiActorSnapshot,
    sendMessage: apiActorSendMessage,
  },
  ...resourceHandlers,
};

export { actorsHandlers, baseActorsOs };

import { apiActorEvents } from './api.actor-events';
import { apiCreateActorConnection } from './api.create-actor-connection';
import { apiCreateActorInstance } from './api.create-actor-instance';
import { apiGetActorDefinition } from './api.get-actor-definition';
import { apiGetActorInstance } from './api.get-actor-instance';
import { apiListActorConnections } from './api.list-actor-connections';
import { apiListActorDefinitions } from './api.list-actor-definitions';
import { apiListActorInstances } from './api.list-actor-instances';
import { apiListActorOutputs } from './api.list-actor-outputs';
import { apiRemoveActorConnection } from './api.remove-actor-connection';
import { apiRemoveActorInstance } from './api.remove-actor-instance';
import { apiUpdateActorConnection } from './api.update-actor-connection';
import { apiSendActorMessage } from './api.send-actor-message';
import { baseActorsOs } from './orpc';

const actorsHandlers = {
  definitions: {
    list: apiListActorDefinitions,
    get: apiGetActorDefinition,
  },
  instances: {
    list: apiListActorInstances,
    get: apiGetActorInstance,
    create: apiCreateActorInstance,
    remove: apiRemoveActorInstance,
  },
  connections: {
    list: apiListActorConnections,
    create: apiCreateActorConnection,
    update: apiUpdateActorConnection,
    remove: apiRemoveActorConnection,
  },
  messages: {
    send: apiSendActorMessage,
  },
  outputs: {
    list: apiListActorOutputs,
  },
  events: apiActorEvents,
};

export { actorsHandlers, baseActorsOs };

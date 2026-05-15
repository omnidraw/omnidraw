import { apiActorEvents } from './api.actor-events';
import { apiCreateActorConnection } from './api.create-actor-connection';
import { apiCreateActorInstance } from './api.create-actor-instance';
import { apiGetActorInstance } from './api.get-actor-instance';
import { apiGetActorRevision } from './api.get-actor-revision';
import { apiListActorConnections } from './api.list-actor-connections';
import { apiListActorInstances } from './api.list-actor-instances';
import { apiListActorRevisions } from './api.list-actor-revisions';
import { apiRegisterActorRevision } from './api.register-actor-revision';
import { apiRemoveActorConnection } from './api.remove-actor-connection';
import { apiUpdateActorConnection } from './api.update-actor-connection';
import { baseActorsOs } from './orpc';

const actorsHandlers = {
  instances: {
    list: apiListActorInstances,
    get: apiGetActorInstance,
    create: apiCreateActorInstance,
  },
  revisions: {
    register: apiRegisterActorRevision,
    list: apiListActorRevisions,
    get: apiGetActorRevision,
  },
  connections: {
    list: apiListActorConnections,
    create: apiCreateActorConnection,
    update: apiUpdateActorConnection,
    remove: apiRemoveActorConnection,
  },
  events: apiActorEvents,
};

export { actorsHandlers, baseActorsOs };

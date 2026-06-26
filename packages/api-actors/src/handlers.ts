import { baseActorsOs } from './orpc';
import { apiListDefinitions } from "./api.def-list";
import { apiGetDefinitions } from "./api.def-get";
import { apiActorSnapshot } from "./api.actor-snapshot";

const actorsHandlers = {
    definitions: {
        list: apiListDefinitions,
        get: apiGetDefinitions
    },
    instances: {
        snapshot: apiActorSnapshot
    }
};

export { actorsHandlers, baseActorsOs };

import { baseActorsOs } from './orpc';
import { apiListDefinitions } from "./api.def-list";
import { apiGetDefinitions } from "./api.def-get";
import { apiActorSnapshot } from "./api.actor-snapshot";
import { apiNotificationEvents } from "./api.events";
import { apiActorSendMessage } from "./api.instance-send-message";

const actorsHandlers = {
    definitions: {
        list: apiListDefinitions,
        get: apiGetDefinitions,
    },
    events: apiNotificationEvents,
    instances: {
        snapshot: apiActorSnapshot,
        sendMessage: apiActorSendMessage,
    }
};

export { actorsHandlers, baseActorsOs };

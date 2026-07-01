import { apiGetDefinitions } from "./api.auth.get";
import { apiNotificationEvents } from "./api.events";
import { baseActorsOs } from './orpc';

const actorsHandlers = {
    auth: {
        get: apiGetDefinitions,
    },
    events: apiNotificationEvents,
};

export { actorsHandlers, baseActorsOs };

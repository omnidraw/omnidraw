import { baseActorsOs } from './orpc';
import { apiListDefinitions } from "./api.def-list";
import { apiGetDefinitions } from "./api.def-get";

const actorsHandlers = {
    definitions: {
        list: apiListDefinitions,
        get: apiGetDefinitions
    }
};

export { actorsHandlers, baseActorsOs };

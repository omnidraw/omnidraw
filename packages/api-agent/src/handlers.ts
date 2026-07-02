import { apiGetDefinitions } from "./api.setting.get";
import { baseAgentOs } from './orpc';

const agentHandlers = {
    settings: {
        get: apiGetDefinitions,
    },
};

export { agentHandlers, baseAgentOs };

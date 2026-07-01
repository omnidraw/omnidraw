import { apiGetDefinitions } from "./api.setting.get";
import { baseAgentOs } from './orpc';

const agentHandlers = {
    auth: {
        get: apiGetDefinitions,
    },
};

export { agentHandlers, baseAgentOs };

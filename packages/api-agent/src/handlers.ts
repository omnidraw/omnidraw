import { apiAuthAbort } from "./api.auth.abort";
import { apiAuthLogin } from "./api.auth.login";
import { apiGetDefinitions } from "./api.setting.get";
import { baseAgentOs } from './orpc';

const agentHandlers = {
    settings: {
        get: apiGetDefinitions,
    },
    auth: {
        login: apiAuthLogin,
        abort: apiAuthAbort
    }
};

export { agentHandlers, baseAgentOs };

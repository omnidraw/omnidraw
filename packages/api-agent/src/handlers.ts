import { apiAuthAbort } from "./api.auth.abort";
import { apiAuthApiKeyRemove } from "./api.auth.apiKey.remove";
import { apiAuthApiKeySet } from "./api.auth.apiKey.set";
import { apiAuthLogin } from "./api.auth.login";
import { apiAuthLogout } from "./api.auth.logout";
import { apiAuthStatus } from "./api.auth.status";
import { apiAgentEvents } from "./api.events";
import { apiGetDefinitions } from "./api.setting.get";
import { apiWizzardCancel } from "./api.wizzard.cancel";
import { apiWizzardConnect } from "./api.wizzard.connect";
import { apiWizzardPrompt } from "./api.wizzard.prompt";
import { baseAgentOs } from './orpc';

const agentHandlers = {
    settings: {
        get: apiGetDefinitions,
    },
    auth: {
        login: apiAuthLogin,
        logout: apiAuthLogout,
        status: apiAuthStatus,
        abort: apiAuthAbort,
        apiKey: {
            set: apiAuthApiKeySet,
            remove: apiAuthApiKeyRemove,
        },
    },
    wizzard: {
        connect: apiWizzardConnect,
        prompt: apiWizzardPrompt,
        cancel: apiWizzardCancel,
    },
    events: apiAgentEvents,
};

export { agentHandlers, baseAgentOs };

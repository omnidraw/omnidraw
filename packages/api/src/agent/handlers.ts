import { apiAuthAbort } from "./api.auth.abort";
import { apiAuthApiKeyRemove } from "./api.auth.apiKey.remove";
import { apiAuthApiKeySet } from "./api.auth.apiKey.set";
import { apiAuthLogin } from "./api.auth.login";
import { apiAuthLogout } from "./api.auth.logout";
import { apiAuthStatus } from "./api.auth.status";
import { apiAgentEvents } from "./api.events";
import { apiGetDefinitions } from "./api.setting.get";
import { apiUpdateApprovalPolicy } from './api.setting.approvalPolicy.update';
import { apiChatCancel } from "./api.chat.cancel";
import { apiChatApprovalGet } from "./api.chat.approval.get";
import { apiChatApprovalList } from "./api.chat.approval.list";
import { apiChatApprovalResolve } from "./api.chat.approval.resolve";
import { apiChatConnect } from "./api.chat.connect";
import { apiChatDbChangeApprove } from "./api.chat.dbChange.approve";
import { apiChatDbChangeReject } from "./api.chat.dbChange.reject";
import { apiChatNewSession } from "./api.chat.newSession";
import { apiChatPrompt } from "./api.chat.prompt";
import { baseAgentOs } from './orpc';
import { apiApprovalGet } from './api.approval.get';
import { apiApprovalList } from './api.approval.list';
import { apiApprovalResolve } from './api.approval.resolve';

const agentHandlers = {
    settings: {
        get: apiGetDefinitions,
        approvalPolicy: {
            update: apiUpdateApprovalPolicy,
        },
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
    chat: {
        connect: apiChatConnect,
        prompt: apiChatPrompt,
        dbChange: {
            approve: apiChatDbChangeApprove,
            reject: apiChatDbChangeReject,
        },
        approval: {
            list: apiChatApprovalList,
            get: apiChatApprovalGet,
            resolve: apiChatApprovalResolve,
        },
        cancel: apiChatCancel,
        newSession: apiChatNewSession,
    },
    approval: {
        list: apiApprovalList,
        get: apiApprovalGet,
        resolve: apiApprovalResolve,
    },
    events: apiAgentEvents,
};

export { agentHandlers, baseAgentOs };

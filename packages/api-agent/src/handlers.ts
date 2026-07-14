import { apiAuthAbort } from "./api.auth.abort";
import { apiAuthApiKeyRemove } from "./api.auth.apiKey.remove";
import { apiAuthApiKeySet } from "./api.auth.apiKey.set";
import { apiAuthLogin } from "./api.auth.login";
import { apiAuthLogout } from "./api.auth.logout";
import { apiAuthStatus } from "./api.auth.status";
import { apiAgentEvents } from "./api.events";
import { apiGetDefinitions } from "./api.setting.get";
import { apiChatCancel } from "./api.chat.cancel";
import { apiChatConnect } from "./api.chat.connect";
import { apiChatDraftManifestPatch } from "./api.chat.draftManifest.patch";
import { apiChatDraftManifestRead } from "./api.chat.draftManifest.read";
import { apiChatDbChangeApprove } from "./api.chat.dbChange.approve";
import { apiChatDbChangeReject } from "./api.chat.dbChange.reject";
import { apiChatDraftActorInspect } from "./api.chat.draftActor.inspect";
import { apiChatDraftActorReload } from "./api.chat.draftActor.reload";
import { apiChatDraftActorReset } from "./api.chat.draftActor.reset";
import { apiChatDraftActorSend } from "./api.chat.draftActor.send";
import { apiChatDraftActorStart } from "./api.chat.draftActor.start";
import { apiChatDraftActorStop } from "./api.chat.draftActor.stop";
import { apiChatNewSession } from "./api.chat.newSession";
import { apiChatPreviewSource } from "./api.chat.previewSource";
import { apiChatPublish } from "./api.chat.publish";
import { apiChatPrompt } from "./api.chat.prompt";
import { apiChatResourceBindingsClear } from "./api.chat.resourceBindings.clear";
import { apiChatStartWidgetEdit } from "./api.chat.startWidgetEdit";
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
    chat: {
        connect: apiChatConnect,
        startWidgetEdit: apiChatStartWidgetEdit,
        prompt: apiChatPrompt,
        resourceBindings: {
            clear: apiChatResourceBindingsClear,
        },
        dbChange: {
            approve: apiChatDbChangeApprove,
            reject: apiChatDbChangeReject,
        },
        cancel: apiChatCancel,
        newSession: apiChatNewSession,
        previewSource: apiChatPreviewSource,
        publish: apiChatPublish,
        draftManifest: {
            read: apiChatDraftManifestRead,
            patch: apiChatDraftManifestPatch,
        },
        draftActor: {
            start: apiChatDraftActorStart,
            reload: apiChatDraftActorReload,
            reset: apiChatDraftActorReset,
            stop: apiChatDraftActorStop,
            inspect: apiChatDraftActorInspect,
            send: apiChatDraftActorSend,
        },
    },
    events: apiAgentEvents,
};

export { agentHandlers, baseAgentOs };

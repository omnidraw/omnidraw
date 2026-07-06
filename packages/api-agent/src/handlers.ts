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
import { apiWizzardDraftManifestPatch } from "./api.wizzard.draftManifest.patch";
import { apiWizzardDraftManifestRead } from "./api.wizzard.draftManifest.read";
import { apiWizzardDraftActorInspect } from "./api.wizzard.draftActor.inspect";
import { apiWizzardDraftActorReload } from "./api.wizzard.draftActor.reload";
import { apiWizzardDraftActorReset } from "./api.wizzard.draftActor.reset";
import { apiWizzardDraftActorSend } from "./api.wizzard.draftActor.send";
import { apiWizzardDraftActorStart } from "./api.wizzard.draftActor.start";
import { apiWizzardDraftActorStop } from "./api.wizzard.draftActor.stop";
import { apiWizzardNewSession } from "./api.wizzard.newSession";
import { apiWizzardPreviewSource } from "./api.wizzard.previewSource";
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
        newSession: apiWizzardNewSession,
        previewSource: apiWizzardPreviewSource,
        draftManifest: {
            read: apiWizzardDraftManifestRead,
            patch: apiWizzardDraftManifestPatch,
        },
        draftActor: {
            start: apiWizzardDraftActorStart,
            reload: apiWizzardDraftActorReload,
            reset: apiWizzardDraftActorReset,
            stop: apiWizzardDraftActorStop,
            inspect: apiWizzardDraftActorInspect,
            send: apiWizzardDraftActorSend,
        },
    },
    events: apiAgentEvents,
};

export { agentHandlers, baseAgentOs };

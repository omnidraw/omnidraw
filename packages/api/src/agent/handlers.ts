import { apiAuthAbort } from "./api.auth.abort";
import { apiAuthApiKeyRemove } from "./api.auth.apiKey.remove";
import { apiAuthApiKeySet } from "./api.auth.apiKey.set";
import { apiAuthLogin } from "./api.auth.login";
import { apiAuthLogout } from "./api.auth.logout";
import { apiAuthStatus } from "./api.auth.status";
import { apiAgentEvents } from "./api.events";
import { apiGetDefinitions } from "./api.setting.get";
import { apiChatCancel } from "./api.chat.cancel";
import { apiChatApprovalGet } from "./api.chat.approval.get";
import { apiChatApprovalList } from "./api.chat.approval.list";
import { apiChatApprovalResolve } from "./api.chat.approval.resolve";
import { apiChatConnect } from "./api.chat.connect";
import { apiChatDbChangeApprove } from "./api.chat.dbChange.approve";
import { apiChatDbChangeReject } from "./api.chat.dbChange.reject";
import { apiChatNewSession } from "./api.chat.newSession";
import { apiChatPrompt } from "./api.chat.prompt";
import { apiChatResourceBindingsClear } from "./api.chat.resourceBindings.clear";
import { apiChatStartWidgetEdit } from "./api.chat.startWidgetEdit";
import { baseAgentOs } from './orpc';
import { apiWidgetDraftGet } from './api.widgetDraft.get';
import { apiWidgetDraftList } from './api.widgetDraft.list';
import { apiWidgetDraftValidate } from './api.widgetDraft.validate';
import { apiWidgetPreviewBuild } from './api.widgetPreview.build';
import { apiWidgetPreviewCancelInvocation } from './api.widgetPreview.invocation.cancel';
import { apiWidgetPreviewClose } from './api.widgetPreview.close';
import { apiWidgetPreviewGet } from './api.widgetPreview.get';
import { apiWidgetPreviewGetInvocation } from './api.widgetPreview.invocation.get';
import { apiWidgetPreviewInvoke } from './api.widgetPreview.invoke';
import { apiWidgetPublishPublish } from './api.widgetPublish.publish';
import { apiApprovalGet } from './api.approval.get';
import { apiApprovalList } from './api.approval.list';
import { apiApprovalResolve } from './api.approval.resolve';
import {
    apiWidgetsCatalog,
    apiWidgetsDelete,
    apiWidgetsDetail,
    apiWidgetsEnsureDraft,
    apiWidgetsFile,
    apiWidgetsFiles,
    apiWidgetsGroupsCreate,
    apiWidgetsGroupsRemove,
    apiWidgetsGroupsUpdate,
    apiWidgetsPatchDraftTool,
    apiWidgetsPatchDraftMetadata,
    apiWidgetsResolvePlacement,
} from './api.widgets';

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
        approval: {
            list: apiChatApprovalList,
            get: apiChatApprovalGet,
            resolve: apiChatApprovalResolve,
        },
        cancel: apiChatCancel,
        newSession: apiChatNewSession,
    },
    widgetDraft: {
        list: apiWidgetDraftList,
        get: apiWidgetDraftGet,
        validate: apiWidgetDraftValidate,
    },
    widgetPreview: {
        get: apiWidgetPreviewGet,
        build: apiWidgetPreviewBuild,
        close: apiWidgetPreviewClose,
        invoke: apiWidgetPreviewInvoke,
        invocation: {
            get: apiWidgetPreviewGetInvocation,
            cancel: apiWidgetPreviewCancelInvocation,
        },
    },
    widgetPublish: {
        publish: apiWidgetPublishPublish,
    },
    widgets: {
        catalog: apiWidgetsCatalog,
        detail: apiWidgetsDetail,
        files: apiWidgetsFiles,
        file: apiWidgetsFile,
        ensureDraft: apiWidgetsEnsureDraft,
        patchDraftTool: apiWidgetsPatchDraftTool,
        patchDraftMetadata: apiWidgetsPatchDraftMetadata,
        delete: apiWidgetsDelete,
        resolvePlacement: apiWidgetsResolvePlacement,
        groups: {
            create: apiWidgetsGroupsCreate,
            update: apiWidgetsGroupsUpdate,
            remove: apiWidgetsGroupsRemove,
        },
    },
    approval: {
        list: apiApprovalList,
        get: apiApprovalGet,
        resolve: apiApprovalResolve,
    },
    events: apiAgentEvents,
};

export { agentHandlers, baseAgentOs };

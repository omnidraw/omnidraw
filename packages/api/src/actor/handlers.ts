import { baseActorsOs } from './orpc';
import { apiListDefinitions } from "./api.def-list";
import { apiGetDefinitions } from "./api.def-get";
import { apiDeleteDefinition } from "./api.def-delete";
import { apiActorSnapshot } from "./api.actor-snapshot";
import { apiNotificationEvents } from "./api.events";
import { apiActorSendMessage } from "./api.instance-send-message";
import {
    apiActorDefinitionResourceStatus,
    apiBindActorResource,
    apiCreateActorResource,
    apiDeleteActorResource,
    apiDeleteActorResourceData,
    apiGetActorResource,
    apiListActorResourceData,
    apiListActorResourceReferences,
    apiListActorResources,
    apiRenameActorResource,
    apiRevealActorResourceSecret,
    apiSetActorResourceData,
    apiUnbindActorResource,
} from '../resource/api.resources';
import {
    apiBulkDbRows,
    apiChangeDbDraft,
    apiConfirmDbApply,
    apiCreateDbDraft,
    apiCreateDbRow,
    apiDbResourceImpact,
    apiDeleteDbRow,
    apiDiscardDbBackup,
    apiDiscardDbDraft,
    apiExecuteDbLiveSql,
    apiExecuteDbDraftSql,
    apiGetActiveDbDraft,
    apiGetDbApply,
    apiGetDbBackup,
    apiGetDbDraft,
    apiGetDbRestoreStatus,
    apiGetDbRow,
    apiInspectDbDraft,
    apiInspectDbResource,
    apiListDbApplies,
    apiListDbDrafts,
    apiListDbRows,
    apiPreviewDbApply,
    apiPreviewDbBackupRestore,
    apiRestoreDbBackup,
    apiUpdateDbRow,
} from '../resource/api.db-resources';

const actorsHandlers = {
    definitions: {
        list: apiListDefinitions,
        get: apiGetDefinitions,
        delete: apiDeleteDefinition,
    },
    events: apiNotificationEvents,
    instances: {
        snapshot: apiActorSnapshot,
        sendMessage: apiActorSendMessage,
    },
    resources: {
        list: apiListActorResources,
        get: apiGetActorResource,
        create: apiCreateActorResource,
        rename: apiRenameActorResource,
        delete: apiDeleteActorResource,
        references: apiListActorResourceReferences,
        data: apiListActorResourceData,
        dataSet: apiSetActorResourceData,
        dataDelete: apiDeleteActorResourceData,
        dataRevealSecret: apiRevealActorResourceSecret,
        definitionStatus: apiActorDefinitionResourceStatus,
        bind: apiBindActorResource,
        unbind: apiUnbindActorResource,
    },
    dbResources: {
        impact: apiDbResourceImpact,
        inspect: apiInspectDbResource,
        executeSql: apiExecuteDbLiveSql,
    },
    dbRows: {
        list: apiListDbRows,
        get: apiGetDbRow,
        create: apiCreateDbRow,
        update: apiUpdateDbRow,
        delete: apiDeleteDbRow,
        bulk: apiBulkDbRows,
    },
    dbDrafts: {
        create: apiCreateDbDraft,
        list: apiListDbDrafts,
        get: apiGetDbDraft,
        active: apiGetActiveDbDraft,
        inspect: apiInspectDbDraft,
        change: apiChangeDbDraft,
        executeSql: apiExecuteDbDraftSql,
        discard: apiDiscardDbDraft,
    },
    dbApplies: {
        preview: apiPreviewDbApply,
        confirm: apiConfirmDbApply,
        get: apiGetDbApply,
        list: apiListDbApplies,
    },
    dbBackups: {
        get: apiGetDbBackup,
        discard: apiDiscardDbBackup,
        previewRestore: apiPreviewDbBackupRestore,
        restore: apiRestoreDbBackup,
        restoreStatus: apiGetDbRestoreStatus,
    },
};

export { actorsHandlers, baseActorsOs };

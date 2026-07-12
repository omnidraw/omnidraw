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
    apiGetActorResource,
    apiListActorResourceReferences,
    apiListActorResources,
    apiRenameActorResource,
    apiUnbindActorResource,
} from './api.resources';
import {
    apiCreateDbMigrationDraft,
    apiCreateDbSchema,
    apiDeleteDbMigrationDraft,
    apiDeleteDbSchemaDraft,
    apiDeprecateDbSchema,
    apiGetDbSchema,
    apiGetDbResourceConfiguration,
    apiListDbMigrations,
    apiListDbSchemas,
    apiPublishDbMigration,
    apiPublishDbSchema,
    apiPreviewDbResourceMigration,
    apiMigrateDbResource,
    apiUpdateDbMigrationDraft,
    apiUpdateDbSchemaDraft,
} from './api.db-resources';

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
        definitionStatus: apiActorDefinitionResourceStatus,
        bind: apiBindActorResource,
        unbind: apiUnbindActorResource,
    },
    dbSchemas: {
        list: apiListDbSchemas,
        get: apiGetDbSchema,
        create: apiCreateDbSchema,
        updateDraft: apiUpdateDbSchemaDraft,
        deleteDraft: apiDeleteDbSchemaDraft,
        publish: apiPublishDbSchema,
        deprecate: apiDeprecateDbSchema,
    },
    dbMigrations: {
        list: apiListDbMigrations,
        createDraft: apiCreateDbMigrationDraft,
        updateDraft: apiUpdateDbMigrationDraft,
        deleteDraft: apiDeleteDbMigrationDraft,
        publish: apiPublishDbMigration,
    },
    dbResources: {
        configuration: apiGetDbResourceConfiguration,
        previewMigration: apiPreviewDbResourceMigration,
        migrate: apiMigrateDbResource,
    },
};

export { actorsHandlers, baseActorsOs };

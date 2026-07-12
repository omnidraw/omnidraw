import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ZActorResourceRequirement, ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"
import {
  ZActorDefinition,
  ZActorStatus,
  ZDbResourceSchema,
  ZDbResourceSchemaMigration,
  ZDbResourceConfiguration,
  ZDbResourceSchemaStatus,
  ZDbResourceMigrationStatus,
  ZJson,
  ZWidgetError,
} from "@vibecanvas/service-db/model"

export const ZActorResourceKind = z.enum(['kv', 'secretStore', 'db']);
export const ZActorResourceStatus = z.enum(['created', 'provisioning', 'ready', 'migrating', 'error', 'deleting']);
export const ZActorResourcePermission = z.enum(['read', 'write']);
export const ZActorResourceScope = z.array(ZActorResourcePermission).min(1).max(2).refine(
  (scope) => new Set(scope).size === scope.length,
  'Resource scope permissions must be unique.',
);

export const ZActorResourceApiErrorData = z.object({
  code: z.string(),
  details: ZJson.optional(),
});

export const ZActorResource = z.object({
  id: z.string(),
  kind: ZActorResourceKind,
  name: z.string(),
  status: ZActorResourceStatus,
  last_error: ZJson.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ZActorResourceBinding = z.object({
  actor_definition_name: z.string(),
  slot_name: z.string(),
  resource_id: z.string(),
  allow_read: z.boolean(),
  allow_write: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const boundedNonBlankString = (max: number) => z.string().min(1).max(max).refine(
  (value) => value.trim().length > 0,
  'Value must not be blank.',
);
const ZResourceId = boundedNonBlankString(128);
const ZResourceName = boundedNonBlankString(256);
const ZDefinitionName = boundedNonBlankString(256);
const ZSlotName = boundedNonBlankString(128);
const ZSchemaId = boundedNonBlankString(128);
const ZMigrationName = boundedNonBlankString(128);
const ZMigrationSql = z.string().min(1).max(1_048_576).refine(
  (value) => value.trim().length > 0,
  'Migration SQL must not be blank.',
);

export const ZCreateActorResourceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kv'), name: ZResourceName }).strict(),
  z.object({ kind: z.literal('secretStore'), name: ZResourceName }).strict(),
  z.object({
    kind: z.literal('db'),
    name: ZResourceName,
    db: z.object({ schemaId: ZSchemaId, version: z.number().int().nonnegative() }).strict(),
  }).strict(),
]);

export const ZActorResourceBindingStatus = z.object({
  slot: z.string(),
  requirement: ZActorResourceRequirement,
  bound: z.boolean(),
  resource: ZActorResource.nullable(),
  requestedScope: ZActorResourceScope,
  bindingScope: ZActorResourceScope.nullable(),
  scopeValid: z.boolean(),
  kindMatches: z.boolean(),
  ready: z.boolean(),
  compatible: z.boolean(),
  blockedCode: z.string().nullable(),
  blockedMessage: z.string().nullable(),
  expectedSchemaId: z.string().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().nullable().optional(),
  actualSchemaId: z.string().nullable().optional(),
  actualVersion: z.number().int().nonnegative().nullable().optional(),
  targetVersion: z.number().int().nonnegative().nullable().optional(),
  schemaMatches: z.boolean().optional(),
  versionMatches: z.boolean().optional(),
});

export const ZDbResourceMigrationPreview = z.object({
  resource: ZActorResource,
  configuration: ZDbResourceConfiguration,
  targetVersion: z.number().int().positive(),
  affectedDefinitions: z.array(z.object({
    definitionName: z.string(),
    slots: z.array(z.string()),
    expectedSchemaId: z.string().nullable(),
    expectedVersion: z.number().int().nonnegative().nullable(),
    compatibleAfterMigration: z.boolean(),
  })),
  affectedInstances: z.array(z.object({
    instanceId: z.string(),
    definitionName: z.string(),
    status: z.string(),
    running: z.boolean(),
    restartWhenCompatible: z.boolean(),
  })),
});

const ZActorDefListItem = ZVibecanvasJson.extend(ZActorDefinition.shape)
const ZActorDefinitionListItem = ZActorDefinition.extend({
  version: z.string().optional(),
  health: z.enum(['ready', 'error']),
  error: ZWidgetError.nullable(),
})
const ZActorDefResponse = z.object({
  def: ZActorDefListItem,
  widgetCode: z.object({
    content: z.string(),
    path: z.string()
  }).array()
});

const ZActorSnapshot = z.object({
  status: ZActorStatus,
  state: z.string(),
  context: ZJson,
  error: ZWidgetError.nullable(),
})

const ZActorSendMessageResult = z.object({
  messageId: z.string(),
})

export const ZActorSystemEvent = z.discriminatedUnion('type', [
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('ack'),
    messageId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('state.changed'),
    from: z.string(),
    to: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('status.changed'),
    from: ZActorStatus.nullable(),
    to: ZActorStatus,
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('data.changed'),
    data: ZJson,
    messageId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('snapshot'),
    revision: z.number().int().positive(),
    state: z.string(),
    data: ZJson,
    cause: z.enum(['startup', 'input', 'activity', 'error']),
    jobId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    details: ZJson.optional(),
    messageId: z.string().optional(),
  }),
]);

export const ZActorMessageEvent = z.object({
  kind: z.literal('actor'),
  actorId: z.string(),
  name: z.string(),
  payload: ZJson,
  messageId: z.string().optional(),
});

export const ZActorEvent = z.union([
  ZActorSystemEvent,
  ZActorMessageEvent,
]);

export type TActorEvent = z.infer<typeof ZActorEvent>

export const actorsContract = oc.errors({
  ACTOR_RESOURCE_ERROR: {
    status: 409,
    message: 'Actor resource operation failed.',
    data: ZActorResourceApiErrorData,
  },
}).router({
  definitions: {
    list: oc.output(ZActorDefinitionListItem.array()),
    get: oc.input(z.object({ name: z.string() }))
      .output(ZActorDefResponse),
    delete: oc
      .input(z.object({ name: z.string() }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
  },
  events: oc
    .input(z.object({}))
    .route({ method: 'GET' })
    .output(eventIterator(ZActorEvent)),
  instances: {
    snapshot: oc
      .input(z.union([
        z.object({ instanceId: z.string() }),
        z.object({ elementId: z.string() }),
      ]))
      .output(ZActorSnapshot),
    sendMessage: oc
      .input(z.object({ name: z.string(), payload: z.unknown(), instanceId: z.string() }))
      .output(ZActorSendMessageResult)
  },
  resources: {
    list: oc
      .input(z.object({ kind: ZActorResourceKind.optional(), status: ZActorResourceStatus.optional() }).optional())
      .output(ZActorResource.array()),
    get: oc.input(z.object({ resourceId: ZResourceId })).output(ZActorResource),
    create: oc.input(ZCreateActorResourceInput).output(ZActorResource),
    rename: oc
      .input(z.object({ resourceId: ZResourceId, name: ZResourceName }))
      .output(ZActorResource),
    delete: oc
      .input(z.object({ resourceId: ZResourceId }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
    references: oc
      .input(z.object({ resourceId: ZResourceId }))
      .output(ZActorResourceBinding.array()),
    definitionStatus: oc
      .input(z.object({ definitionName: ZDefinitionName }))
      .output(ZActorResourceBindingStatus.array()),
    bind: oc
      .input(z.object({
        definitionName: ZDefinitionName,
        slot: ZSlotName,
        resourceId: ZResourceId,
        scope: ZActorResourceScope.optional(),
      }))
      .output(ZActorResourceBinding),
    unbind: oc
      .input(z.object({ definitionName: ZDefinitionName, slot: ZSlotName }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
  },
  dbSchemas: {
    list: oc
      .input(z.object({ status: ZDbResourceSchemaStatus.optional() }).optional())
      .output(ZDbResourceSchema.array()),
    get: oc.input(z.object({ id: ZSchemaId })).output(ZDbResourceSchema),
    create: oc
      .input(z.object({ id: ZSchemaId, name: ZResourceName, description: z.string().max(4_096).nullable().optional() }))
      .output(ZDbResourceSchema),
    updateDraft: oc
      .input(z.object({ id: ZSchemaId, name: ZResourceName, description: z.string().max(4_096).nullable().optional() }))
      .output(ZDbResourceSchema),
    deleteDraft: oc
      .input(z.object({ id: ZSchemaId }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
    publish: oc.input(z.object({ id: ZSchemaId })).output(ZDbResourceSchema),
    deprecate: oc.input(z.object({ id: ZSchemaId })).output(ZDbResourceSchema),
  },
  dbMigrations: {
    list: oc
      .input(z.object({
        schemaId: ZSchemaId,
        status: ZDbResourceMigrationStatus.optional(),
        throughVersion: z.number().int().nonnegative().optional(),
      }))
      .output(ZDbResourceSchemaMigration.array()),
    createDraft: oc
      .input(z.object({
        schemaId: ZSchemaId,
        version: z.number().int().positive(),
        name: ZMigrationName,
        sql: ZMigrationSql,
      }))
      .output(ZDbResourceSchemaMigration),
    updateDraft: oc
      .input(z.object({
        schemaId: ZSchemaId,
        version: z.number().int().positive(),
        name: ZMigrationName,
        sql: ZMigrationSql,
      }))
      .output(ZDbResourceSchemaMigration),
    deleteDraft: oc
      .input(z.object({ schemaId: ZSchemaId, version: z.number().int().positive() }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
    publish: oc
      .input(z.object({ schemaId: ZSchemaId, version: z.number().int().positive() }))
      .output(ZDbResourceSchemaMigration),
  },
  dbResources: {
    configuration: oc
      .input(z.object({ resourceId: ZResourceId }))
      .output(ZDbResourceConfiguration),
    previewMigration: oc
      .input(z.object({ resourceId: ZResourceId, targetVersion: z.number().int().positive() }))
      .output(ZDbResourceMigrationPreview),
    migrate: oc
      .input(z.object({ resourceId: ZResourceId, targetVersion: z.number().int().positive() }))
      .output(z.object({
        preview: ZDbResourceMigrationPreview,
        resource: ZActorResource,
        configuration: ZDbResourceConfiguration,
      })),
  },
});

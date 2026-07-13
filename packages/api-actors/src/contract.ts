import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ZActorResourceRequirement, ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"
import {
  ZActorDefinition,
  ZActorStatus,
  ZDbResourceApplyInstanceResult,
  ZDbResourceApplyRun,
  ZDbResourceDraft,
  ZDbResourceDraftChange,
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

const ZActorResourceKvDataEntry = z.object({
  key: z.string().max(1_024),
  valuePreview: z.string().max(4_096),
  valueTruncated: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
const ZActorResourceSecretDataEntry = z.object({
  name: z.string().max(256),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const ZActorResourceDataPage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kv'),
    entries: z.array(ZActorResourceKvDataEntry).max(100),
    nextCursor: z.string().max(1_024).nullable(),
  }).strict(),
  z.object({
    kind: z.literal('secretStore'),
    entries: z.array(ZActorResourceSecretDataEntry).max(100),
    nextCursor: z.string().max(256).nullable(),
  }).strict(),
]);

export const ZActorResourceDataMutationResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kv'), entry: ZActorResourceKvDataEntry }).strict(),
  z.object({ kind: z.literal('secretStore'), entry: ZActorResourceSecretDataEntry }).strict(),
]);

const ZActorResourceDataValue = ZJson.refine((value) => {
  try {
    return (JSON.stringify(value)?.length ?? 0) <= 1_048_576;
  } catch {
    return false;
  }
}, 'Resource values must be JSON-compatible and no larger than 1 MiB.');

const boundedNonBlankString = (max: number) => z.string().min(1).max(max).refine(
  (value) => value.trim().length > 0,
  'Value must not be blank.',
);
const ZResourceId = boundedNonBlankString(128);
const ZResourceName = boundedNonBlankString(256);
const ZDefinitionName = boundedNonBlankString(256);
const ZSlotName = boundedNonBlankString(128);
const ZHostId = boundedNonBlankString(128);
const ZObjectName = boundedNonBlankString(256).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Database object name contains control characters.');
const ZDraftSql = z.string().min(1).max(1_048_576).refine((value) => value.trim().length > 0, 'Draft SQL must not be blank.');

export const ZCreateActorResourceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kv'), name: ZResourceName }).strict(),
  z.object({ kind: z.literal('secretStore'), name: ZResourceName }).strict(),
  z.object({ kind: z.literal('db'), name: ZResourceName }).strict(),
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
  blockedCode: z.string().nullable(),
  blockedMessage: z.string().nullable(),
});

const ZDbIntegerString = z.string().min(1).max(20).regex(/^-?(?:0|[1-9][0-9]*)$/).refine((value) => {
  try {
    const integer = BigInt(value);
    return integer >= -9_223_372_036_854_775_808n && integer <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}, 'Integer is outside SQLite signed 64-bit range.');
const ZDbIntegerCellValue = z.object({ type: z.literal('integer'), value: ZDbIntegerString }).strict();

export const ZDbCellValue = z.discriminatedUnion('type', [
  z.object({ type: z.literal('null') }).strict(),
  ZDbIntegerCellValue,
  z.object({ type: z.literal('real'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('text'), value: z.string().max(1_048_576) }).strict(),
  z.object({
    type: z.literal('blob'),
    base64: z.string().max(1_398_104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict(),
]);
export const ZDbBlobPreviewCellValue = z.object({
  type: z.literal('blobPreview'),
  byteLength: z.number().int().nonnegative().max(2_147_483_647),
  previewBase64: z.string().max(88).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  truncated: z.boolean(),
}).strict();
export const ZDbPreviewCellValue = z.discriminatedUnion('type', [
  z.object({ type: z.literal('null') }).strict(),
  ZDbIntegerCellValue,
  z.object({ type: z.literal('real'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('text'), value: z.string().max(1_048_576) }).strict(),
  ZDbBlobPreviewCellValue,
]);
const ZDbValueRecord = z.record(ZObjectName, ZDbCellValue).refine((values) => Object.keys(values).length <= 128, 'Database value record has too many columns.');
const ZDbPreviewValueRecord = z.record(ZObjectName, ZDbPreviewCellValue).refine((values) => Object.keys(values).length <= 128, 'Database preview value record has too many columns.');
const ZNonEmptyDbValueRecord = ZDbValueRecord.refine((values) => Object.keys(values).length > 0, 'Expected original values must not be empty.');
export const ZDbRowIdentity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primaryKey'), values: ZNonEmptyDbValueRecord }).strict(),
  z.object({ kind: z.literal('rowid'), value: ZDbIntegerCellValue }).strict(),
]);
const ZDbColumn = z.object({
  name: ZObjectName,
  declaredType: z.string().max(128),
  nullable: z.boolean(),
  defaultSql: z.string().max(1_048_576).nullable(),
  primaryKeyOrder: z.number().int().positive().nullable(),
  hidden: z.boolean(),
}).strict();
export const ZDbObject = z.object({
  name: ZObjectName,
  kind: z.enum(['table', 'view']),
  columns: z.array(ZDbColumn).max(512),
  indexes: z.array(z.object({
    name: ZObjectName, unique: z.boolean(), origin: z.string().max(32), partial: z.boolean(),
    columns: z.array(z.object({ name: ZObjectName.nullable(), sequence: z.number().int().nonnegative() }).strict()).max(512),
    createSql: z.string().max(1_048_576).nullable(),
  }).strict()).max(512),
  foreignKeys: z.array(z.object({
    id: z.number().int().nonnegative(), columns: z.array(ZObjectName).min(1).max(512), referencedTable: ZObjectName,
    referencedColumns: z.array(ZObjectName.nullable()).max(512), onUpdate: z.string().max(32), onDelete: z.string().max(32), match: z.string().max(32),
  }).strict()).max(512),
  triggers: z.array(z.object({ name: ZObjectName, createSql: z.string().max(1_048_576) }).strict()).max(512),
  createSql: z.string().max(1_048_576).nullable(),
  identity: z.union([
    z.object({ kind: z.literal('primaryKey'), columns: z.array(ZObjectName).min(1).max(128) }).strict(),
    z.object({ kind: z.literal('rowid') }).strict(),
  ]).nullable(),
  editable: z.boolean(),
  readOnlyReason: z.string().max(1_024).nullable(),
}).strict();
export const ZDbInspection = z.object({
  resourceId: ZResourceId, target: z.enum(['live', 'draft']), draftId: ZHostId.nullable(), objects: z.array(ZDbObject).max(256),
}).strict();
const ZDbRow = z.object({ identity: ZDbRowIdentity.nullable(), values: ZDbValueRecord }).strict();
const ZDbRowPreview = z.object({ identity: ZDbRowIdentity.nullable(), values: ZDbPreviewValueRecord }).strict();
const ZDbSqlParameterName = z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const ZDbSqlParameters = z.record(ZDbSqlParameterName, ZDbCellValue).refine((values) => Object.keys(values).length <= 128, 'Database SQL has too many parameters.');
const ZDbLiveSqlResult = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rows'),
    columns: z.array(z.string().max(1_024)).max(128),
    rows: z.array(ZDbPreviewValueRecord).max(200),
    rowCount: z.number().int().nonnegative().max(1_000),
    rowsAffected: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal('execute'),
    rowsAffected: z.number().int().nonnegative(),
    lastInsertRowId: ZDbCellValue.nullable(),
  }).strict(),
]);

const ZDbColumnDefinition = z.object({
  name: ZObjectName,
  declaredType: z.string().max(128).optional(),
  nullable: z.boolean().optional(),
  defaultSql: z.string().max(1_024).nullable().optional(),
  primaryKeyOrder: z.number().int().positive().nullable().optional(),
}).strict();
export const ZDbDraftOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('createTable'), table: ZObjectName, columns: z.array(ZDbColumnDefinition).min(1).max(128), withoutRowid: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('renameTable'), table: ZObjectName, newName: ZObjectName }).strict(),
  z.object({ kind: z.literal('dropTable'), table: ZObjectName }).strict(),
  z.object({ kind: z.literal('addColumn'), table: ZObjectName, column: ZDbColumnDefinition }).strict(),
  z.object({ kind: z.literal('renameColumn'), table: ZObjectName, column: ZObjectName, newName: ZObjectName }).strict(),
  z.object({ kind: z.literal('alterColumn'), table: ZObjectName, column: ZObjectName, definition: ZDbColumnDefinition }).strict(),
  z.object({ kind: z.literal('dropColumn'), table: ZObjectName, column: ZObjectName }).strict(),
  z.object({ kind: z.literal('createIndex'), table: ZObjectName, name: ZObjectName, columns: z.array(ZObjectName).min(1).max(128), unique: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('dropIndex'), name: ZObjectName }).strict(),
  z.object({ kind: z.literal('createForeignKey'), table: ZObjectName, columns: z.array(ZObjectName).min(1).max(128), referencedTable: ZObjectName, referencedColumns: z.array(ZObjectName).min(1).max(128), onUpdate: z.string().max(32).optional(), onDelete: z.string().max(32).optional() }).strict(),
  z.object({ kind: z.literal('dropForeignKey'), table: ZObjectName, id: z.number().int().nonnegative() }).strict(),
]);

const ZDbImpact = z.object({
  resource: ZActorResource,
  definitions: z.array(z.object({ definitionName: z.string(), slots: z.array(z.object({ slot: z.string(), scope: ZActorResourceScope })) })),
  instances: z.array(z.object({ instanceId: z.string(), definitionName: z.string(), status: z.string(), running: z.boolean() })),
});
const ZDbDraftDetails = z.object({ draft: ZDbResourceDraft, changes: z.array(ZDbResourceDraftChange) });
const ZDbApplyDetails = z.object({ apply: ZDbResourceApplyRun, instances: z.array(ZDbResourceApplyInstanceResult) });
const ZDbApplyPreview = ZDbDraftDetails.extend({
  resource: ZActorResource,
  impact: ZDbImpact,
  warnings: z.array(z.string()),
  compatibilityNotice: z.string(),
});
const ZCursor = z.object({ createdAt: z.string(), id: z.string() });

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
    data: oc
      .input(z.object({
        resourceId: ZResourceId,
        prefix: z.string().max(1_024).optional(),
        cursor: z.string().min(1).max(1_024).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict())
      .output(ZActorResourceDataPage),
    dataSet: oc
      .input(z.object({
        resourceId: ZResourceId,
        key: boundedNonBlankString(1_024),
        expectedRevision: z.number().int().positive().nullable(),
        value: ZActorResourceDataValue,
      }).strict())
      .output(ZActorResourceDataMutationResult),
    dataDelete: oc
      .input(z.object({
        resourceId: ZResourceId,
        key: boundedNonBlankString(1_024),
        expectedRevision: z.number().int().positive(),
      }).strict())
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.literal(true) }).strict()),
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
  dbResources: {
    impact: oc
      .input(z.object({ resourceId: ZResourceId }))
      .output(ZDbImpact),
    inspect: oc
      .input(z.object({ resourceId: ZResourceId, target: z.enum(['live', 'draft']), draftId: ZHostId.optional() }))
      .output(ZDbInspection.nullable()),
    executeSql: oc
      .input(z.object({ resourceId: ZResourceId, sql: ZDraftSql, parameters: ZDbSqlParameters.optional(), approved: z.boolean() }).strict())
      .output(ZDbLiveSqlResult),
  },
  dbRows: {
    list: oc
      .input(z.object({ resourceId: ZResourceId, object: ZObjectName, cursor: ZDbRowIdentity.nullable().optional(), limit: z.number().int().min(1).max(200).optional() }))
      .output(z.object({ object: ZDbObject, rows: z.array(ZDbRowPreview).max(200), hasMore: z.boolean(), nextCursor: ZDbRowIdentity.nullable() }).strict()),
    get: oc
      .input(z.object({ resourceId: ZResourceId, object: ZObjectName, identity: ZDbRowIdentity, columns: z.array(ZObjectName).min(1).max(128).optional() }).strict())
      .output(ZDbRow),
    create: oc
      .input(z.object({ resourceId: ZResourceId, object: ZObjectName, values: ZDbValueRecord }).strict())
      .output(z.object({ rowsAffected: z.number().int().nonnegative(), lastInsertRowId: ZDbCellValue.nullable() }).strict()),
    update: oc
      .input(z.object({ resourceId: ZResourceId, object: ZObjectName, identity: ZDbRowIdentity, values: ZNonEmptyDbValueRecord, expectedOriginal: ZNonEmptyDbValueRecord }).strict().superRefine((input, context) => {
        for (const name of Object.keys(input.values)) {
          if (!Object.prototype.hasOwnProperty.call(input.expectedOriginal, name)) context.addIssue({ code: 'custom', message: `Expected original value is missing updated column "${name}".`, path: ['expectedOriginal', name] });
        }
      }))
      .output(z.object({ rowsAffected: z.number().int().nonnegative() }).strict()),
    delete: oc
      .input(z.object({ resourceId: ZResourceId, object: ZObjectName, identity: ZDbRowIdentity, expectedOriginal: ZNonEmptyDbValueRecord }).strict())
      .route({ method: 'DELETE' })
      .output(z.object({ rowsAffected: z.number().int().nonnegative() }).strict()),
    bulk: oc
      .input(z.object({
        resourceId: ZResourceId,
        object: ZObjectName,
        operations: z.array(z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('create'), values: ZDbValueRecord }).strict(),
          z.object({ kind: z.literal('update'), identity: ZDbRowIdentity, values: ZNonEmptyDbValueRecord, expectedOriginal: ZNonEmptyDbValueRecord }).strict(),
          z.object({ kind: z.literal('delete'), identity: ZDbRowIdentity, expectedOriginal: ZNonEmptyDbValueRecord }).strict(),
        ])).min(1).max(100),
      }).strict().superRefine((input, context) => {
        input.operations.forEach((operation, index) => {
          if (operation.kind !== 'update') return;
          for (const name of Object.keys(operation.values)) {
            if (!Object.prototype.hasOwnProperty.call(operation.expectedOriginal, name)) context.addIssue({ code: 'custom', message: `Expected original value is missing updated column "${name}".`, path: ['operations', index, 'expectedOriginal', name] });
          }
        });
      }))
      .output(z.array(z.object({ rowsAffected: z.number().int().nonnegative() }).strict()).max(100)),
  },
  dbDrafts: {
    create: oc.input(z.object({ resourceId: ZResourceId, name: ZResourceName })).output(ZDbDraftDetails),
    list: oc.input(z.object({ resourceId: ZResourceId, before: ZCursor.optional(), limit: z.number().int().min(1).max(100).optional() })).output(z.array(ZDbResourceDraft)),
    get: oc.input(z.object({ draftId: ZHostId })).output(ZDbDraftDetails),
    active: oc.input(z.object({ resourceId: ZResourceId })).output(ZDbDraftDetails.nullable()),
    inspect: oc.input(z.object({ resourceId: ZResourceId, draftId: ZHostId.optional() })).output(ZDbInspection.nullable()),
    change: oc.input(z.object({ draftId: ZHostId, operation: ZDbDraftOperation })).output(ZDbResourceDraftChange),
    executeSql: oc.input(z.object({ draftId: ZHostId, sql: ZDraftSql })).output(ZDbResourceDraftChange),
    discard: oc.input(z.object({ draftId: ZHostId })).route({ method: 'DELETE' }).output(ZDbResourceDraft),
  },
  dbApplies: {
    preview: oc.input(z.object({ draftId: ZHostId })).output(ZDbApplyPreview),
    confirm: oc.input(z.object({ draftId: ZHostId })).output(ZDbResourceApplyRun),
    get: oc.input(z.object({ applyId: ZHostId })).output(ZDbApplyDetails),
    list: oc.input(z.object({ resourceId: ZResourceId, before: ZCursor.optional(), limit: z.number().int().min(1).max(100).optional() })).output(z.array(ZDbResourceApplyRun)),
  },
  dbBackups: {
    get: oc.input(z.object({ resourceId: ZResourceId })).output(z.object({ resourceId: z.string(), applyId: z.string(), createdAt: z.string() }).nullable()),
    discard: oc.input(z.object({ resourceId: ZResourceId, applyId: ZHostId })).route({ method: 'DELETE' }).output(z.object({ discarded: z.boolean() })),
    previewRestore: oc.input(z.object({ resourceId: ZResourceId, applyId: ZHostId })).output(z.object({
      backup: z.object({ resourceId: z.string(), applyId: z.string(), createdAt: z.string() }),
      impact: ZDbImpact,
      warning: z.string(),
      compatibilityNotice: z.string(),
    })),
    restore: oc.input(z.object({ resourceId: ZResourceId, applyId: ZHostId })).output(ZDbResourceApplyRun),
    restoreStatus: oc.input(z.object({ restoreId: ZHostId })).output(ZDbApplyDetails),
  },
});

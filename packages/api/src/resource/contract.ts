import { oc } from '@orpc/contract';
import { z } from 'zod';

const RESOURCE_IDENTIFIER_MAX_LENGTH = 128;
const DB_NAMED_OPERATION_SQL_MAX_LENGTH = 65_536;
const DB_NAMED_OPERATION_MAX_COUNT = 128;
const DB_NAMED_OPERATION_PARAMETER_MAX_COUNT = 128;

const ZJson: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(ZJson),
  z.record(z.string(), ZJson.optional()),
]));
const ZSqlBoolean = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);
const ZDbResourceDraftStatus = z.enum(['editing', 'applying', 'applied', 'discarded', 'error']);
const ZDbResourceApplyStatus = z.enum([
  'preparing',
  'applying',
  'succeeded',
  'failed',
  'recovered',
]);
const ZDbResourceDraft = z.object({
  id: z.string(),
  resource_id: z.string(),
  name: z.string(),
  status: ZDbResourceDraftStatus,
  last_error: ZJson.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  applied_at: z.string().nullable(),
});
const ZDbResourceDraftChange = z.object({
  draft_id: z.string(),
  sequence: z.number().int().positive(),
  kind: z.enum(['structure', 'sql']),
  operation: ZJson.nullable(),
  sql: z.string(),
  created_at: z.string(),
});
const ZDbResourceApplyRun = z.object({
  id: z.string(),
  resource_id: z.string(),
  draft_id: z.string().nullable(),
  source_apply_id: z.string().nullable(),
  status: ZDbResourceApplyStatus,
  last_error: ZJson.nullable(),
  backup_retained: ZSqlBoolean,
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function isOneSqlStatement(sql: string): boolean {
  type TSqlState = 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment';

  let state: TSqlState = 'normal';
  let hasStatementContent = false;
  let terminated = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') state = 'normal';
      continue;
    }
    if (state === 'backtick') {
      if (char === '`' && next === '`') index += 1;
      else if (char === '`') state = 'normal';
      continue;
    }
    if (state === 'bracket') {
      if (char === ']' && next === ']') index += 1;
      else if (char === ']') state = 'normal';
      continue;
    }

    if (/\s/.test(char)) continue;
    if (char === '-' && next === '-') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (char === ';') {
      if (!hasStatementContent || terminated) return false;
      terminated = true;
      continue;
    }
    if (terminated) return false;

    hasStatementContent = true;
    if (char === "'") state = 'single';
    if (char === '"') state = 'double';
    if (char === '`') state = 'backtick';
    if (char === '[') state = 'bracket';
  }

  return hasStatementContent && (state === 'normal' || state === 'line-comment');
}

function boundedRecord<TKey extends string, TValue>(
  key: z.ZodType<TKey>,
  value: z.ZodType<TValue>,
  maximum: number,
) {
  return z.record(key, value).refine((record) => Object.keys(record).length <= maximum, {
    message: `expected at most ${maximum} entries`,
  });
}

export const ZResourceKind = z.enum(['kv', 'secretStore', 'db']);
export const ZResourceStatus = z.enum(['created', 'provisioning', 'ready', 'migrating', 'error', 'deleting']);
export const ZResourcePermission = z.enum(['read', 'write']);
export const ZResourceScope = z.array(ZResourcePermission).min(1).max(2).refine(
  (scope) => new Set(scope).size === scope.length,
  'Resource scope permissions must be unique.',
);

export const ZResourceApiErrorData = z.object({
  code: z.string(),
  details: ZJson.optional(),
});

export const ZResource = z.object({
  id: z.string(),
  kind: ZResourceKind,
  name: z.string(),
  status: ZResourceStatus,
  last_error: ZJson.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ZResourceKvDataEntry = z.object({
  key: z.string().max(1_024),
  valuePreview: z.string().max(4_096),
  valueTruncated: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
const ZResourceSecretDataEntry = z.object({
  name: z.string().max(256),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const ZResourceDataPage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kv'),
    entries: z.array(ZResourceKvDataEntry).max(100),
    nextCursor: z.string().max(1_024).nullable(),
  }).strict(),
  z.object({
    kind: z.literal('secretStore'),
    entries: z.array(ZResourceSecretDataEntry).max(100),
    nextCursor: z.string().max(256).nullable(),
  }).strict(),
]);

export const ZResourceDataMutationResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kv'), entry: ZResourceKvDataEntry }).strict(),
  z.object({ kind: z.literal('secretStore'), entry: ZResourceSecretDataEntry }).strict(),
]);

export const ZResourceSecretReveal = z.object({
  kind: z.literal('secretStore'),
  name: z.string().min(1).max(256).refine((value) => value.trim().length > 0, 'Value must not be blank.'),
  value: z.string().min(1).max(1_048_576),
  revision: z.number().int().positive(),
}).strict();

const ZResourceDataValue = ZJson.refine((value) => {
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

export const ZCreateResourceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kv'), name: ZResourceName }).strict(),
  z.object({ kind: z.literal('secretStore'), name: ZResourceName }).strict(),
  z.object({ kind: z.literal('db'), name: ZResourceName }).strict(),
]);

const ZResourceIdentifier = z.string()
  .max(RESOURCE_IDENTIFIER_MAX_LENGTH)
  .refine(isNonBlank, 'resource identifier must not be blank');
const ZResourceRequirementScope = z.array(ZResourcePermission)
  .min(1)
  .max(2)
  .superRefine((scope, context) => {
    if (new Set(scope).size !== scope.length) {
      context.addIssue({ code: 'custom', message: 'resource scope must not contain duplicate permissions' });
    }
  });
const ZDbOperationParameterDeclaration = z.object({
  type: z.enum(['string', 'number', 'boolean', 'bigint', 'bytes', 'json']),
  required: z.boolean().default(true),
  nullable: z.boolean().default(false),
});
const ZDbNamedOperation = z.object({
  effect: ZResourcePermission,
  sql: z.string()
    .max(DB_NAMED_OPERATION_SQL_MAX_LENGTH)
    .refine(isNonBlank, 'named operation SQL must not be blank')
    .refine(isOneSqlStatement, 'named operation SQL must contain exactly one statement'),
  parameters: boundedRecord(
    ZResourceIdentifier,
    ZDbOperationParameterDeclaration,
    DB_NAMED_OPERATION_PARAMETER_MAX_COUNT,
  ).optional(),
  result: z.enum(['rows', 'execute']),
});
const ZResourceRequirement = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kv'),
    required: z.boolean(),
    scope: ZResourceRequirementScope,
  }),
  z.object({
    kind: z.literal('secretStore'),
    required: z.boolean(),
    scope: ZResourceRequirementScope,
  }),
  z.object({
    kind: z.literal('db'),
    required: z.boolean(),
    scope: ZResourceRequirementScope,
    arbitrarySql: z.boolean().default(false),
    operations: boundedRecord(
      ZResourceIdentifier,
      ZDbNamedOperation,
      DB_NAMED_OPERATION_MAX_COUNT,
    ).optional(),
  }).strict().superRefine((requirement, context) => {
    for (const [operationName, operation] of Object.entries(requirement.operations ?? {})) {
      if (!requirement.scope.includes(operation.effect)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', operationName, 'effect'],
          message: `${operation.effect} operation requires ${operation.effect} in the resource scope`,
        });
      }
    }
  }),
]);
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
    name: ZObjectName,
    unique: z.boolean(),
    origin: z.string().max(32),
    partial: z.boolean(),
    columns: z.array(z.object({ name: ZObjectName.nullable(), sequence: z.number().int().nonnegative() }).strict()).max(512),
    createSql: z.string().max(1_048_576).nullable(),
  }).strict()).max(512),
  foreignKeys: z.array(z.object({
    id: z.number().int().nonnegative(),
    columns: z.array(ZObjectName).min(1).max(512),
    referencedTable: ZObjectName,
    referencedColumns: z.array(ZObjectName.nullable()).max(512),
    onUpdate: z.string().max(32),
    onDelete: z.string().max(32),
    match: z.string().max(32),
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
  resourceId: ZResourceId,
  target: z.enum(['live', 'draft']),
  draftId: ZHostId.nullable(),
  objects: z.array(ZDbObject).max(256),
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
  z.object({ kind: z.literal('createTable'), table: ZObjectName, columns: z.array(ZDbColumnDefinition).min(1).max(128), strict: z.boolean().optional(), withoutRowid: z.boolean().optional() }).strict(),
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

const ZResourceUse = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum(['active', 'draining', 'stopped']),
  label: z.string().optional(),
});
const ZResourceUseInspection = z.object({
  resourceId: z.string(),
  uses: z.array(ZResourceUse),
});
const ZResourceDrainLease = z.object({
  resourceId: z.string(),
  leaseId: z.string(),
  leaseEpoch: z.number().int().positive(),
  expiresAtMs: z.number().int().nonnegative(),
  drainedUses: z.array(ZResourceUse),
});
const ZDbImpact = z.object({
  resource: ZResource,
  uses: ZResourceUseInspection,
});
const ZDbDraftDetails = z.object({ draft: ZDbResourceDraft, changes: z.array(ZDbResourceDraftChange) });
const ZDbApplyDetails = z.object({ apply: ZDbResourceApplyRun, drain: ZResourceDrainLease.nullable() });
const ZDbApplyPreview = ZDbDraftDetails.extend({
  resource: ZResource,
  impact: ZDbImpact,
  warnings: z.array(z.string()),
});
const ZCursor = z.object({ createdAt: z.string(), id: z.string() });

export const resourceContract = oc.errors({
  RESOURCE_ERROR: {
    status: 409,
    message: 'Resource operation failed.',
    data: ZResourceApiErrorData,
  },
}).router({
  resources: {
    list: oc
      .input(z.object({ kind: ZResourceKind.optional(), status: ZResourceStatus.optional() }).optional())
      .output(ZResource.array()),
    get: oc.input(z.object({ resourceId: ZResourceId })).output(ZResource),
    create: oc.input(ZCreateResourceInput).output(ZResource),
    rename: oc
      .input(z.object({ resourceId: ZResourceId, name: ZResourceName }))
      .output(ZResource),
    delete: oc
      .input(z.object({ resourceId: ZResourceId }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
    data: oc
      .input(z.object({
        resourceId: ZResourceId,
        prefix: z.string().max(1_024).optional(),
        cursor: z.string().min(1).max(1_024).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict())
      .output(ZResourceDataPage),
    dataSet: oc
      .input(z.object({
        resourceId: ZResourceId,
        key: boundedNonBlankString(1_024),
        expectedRevision: z.number().int().positive().nullable(),
        value: ZResourceDataValue,
      }).strict())
      .output(ZResourceDataMutationResult),
    dataDelete: oc
      .input(z.object({
        resourceId: ZResourceId,
        key: boundedNonBlankString(1_024),
        expectedRevision: z.number().int().positive(),
      }).strict())
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.literal(true) }).strict()),
    dataRevealSecret: oc
      .input(z.object({
        resourceId: ZResourceId,
        name: ZResourceName,
      }).strict())
      .route({ method: 'POST' })
      .output(ZResourceSecretReveal),
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
    })),
    restore: oc.input(z.object({ resourceId: ZResourceId, applyId: ZHostId })).output(ZDbResourceApplyRun),
    restoreStatus: oc.input(z.object({ restoreId: ZHostId })).output(ZDbApplyDetails),
  },
});

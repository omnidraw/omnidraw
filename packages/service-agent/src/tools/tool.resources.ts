import { defineTool } from '@earendil-works/pi-coding-agent';
import type { TDbCellValue } from '@vibecanvas/service-actor/resources/resource-types';
import type { TActorResource, TJson } from '@vibecanvas/service-db/model';
import { Type } from 'typebox';
import { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import type { TToolAuthorizationContext } from '../approval/types';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TActorServiceReloader, TToolDefinition } from './types';

type TResourceKind = TActorResource['kind'];
type TDbParameter = string | number | boolean | null | { type: 'integer'; value: string } | { type: 'blob'; base64: string };
type TResourceDataReadQuery =
  | { kind: 'kv'; operation: 'get' | 'has'; key: string }
  | { kind: 'kv'; operation: 'list'; prefix?: string; cursor?: string; limit?: number }
  | { kind: 'secretStore'; operation: 'has'; key: string }
  | { kind: 'secretStore'; operation: 'list'; prefix?: string; cursor?: string; limit?: number }
  | { kind: 'db'; sql: string; parameters?: TDbParameter[] };
type TResourceDataWriteOperation =
  | { kind: 'kv'; operation: 'set'; key: string; value: TJson }
  | { kind: 'kv'; operation: 'delete'; key: string }
  | { kind: 'secretStore'; operation: 'set'; key: string; value: string }
  | { kind: 'secretStore'; operation: 'delete'; key: string }
  | { kind: 'db'; sql: string; parameters?: TDbParameter[] };

type TCreateResourceToolsArgs = {
  chatId: string;
  authorization: TToolAuthorizationContext;
  actorService?: TActorServiceReloader;
  approvals: ApprovalCoordinator;
  authorize: (toolName: string) => Promise<boolean>;
  takeSensitiveToolArgs?: (toolCallId: string) => unknown;
};

const RESOURCE_BATCH_SERIALIZED_LIMIT = 2_000_000;

const RESOURCE_KIND_SCHEMA = Type.Union([Type.Literal('kv'), Type.Literal('secretStore'), Type.Literal('db')]);
const DB_PARAMETER_SCHEMA = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Object({ type: Type.Literal('integer'), value: Type.String({ pattern: '^-?[0-9]+$' }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('blob'), base64: Type.String({ maxLength: 1_400_000 }) }, { additionalProperties: false }),
]);
const DB_QUERY_SCHEMA = Type.Object({
  kind: Type.Literal('db'),
  sql: Type.String({ minLength: 1, maxLength: 1_048_576 }),
  parameters: Type.Optional(Type.Array(DB_PARAMETER_SCHEMA, { maxItems: 256 })),
}, { additionalProperties: false });
const KV_READ_SCHEMA = Type.Union([
  Type.Object({ kind: Type.Literal('kv'), operation: Type.Union([Type.Literal('get'), Type.Literal('has')]), key: Type.String({ minLength: 1, maxLength: 1_024 }) }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('kv'),
    operation: Type.Literal('list'),
    prefix: Type.Optional(Type.String({ maxLength: 1_024 })),
    cursor: Type.Optional(Type.String({ maxLength: 4_096 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false }),
]);
const SECRET_READ_SCHEMA = Type.Union([
  Type.Object({ kind: Type.Literal('secretStore'), operation: Type.Literal('has'), key: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('secretStore'),
    operation: Type.Literal('list'),
    prefix: Type.Optional(Type.String({ maxLength: 256 })),
    cursor: Type.Optional(Type.String({ maxLength: 4_096 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false }),
]);
const DATA_READ_QUERY_SCHEMA = Type.Union([KV_READ_SCHEMA, SECRET_READ_SCHEMA, DB_QUERY_SCHEMA]);
const DATA_WRITE_OPERATION_SCHEMA = Type.Union([
  Type.Object({ kind: Type.Literal('kv'), operation: Type.Literal('set'), key: Type.String({ minLength: 1, maxLength: 1_024 }), value: Type.Any() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('kv'), operation: Type.Literal('delete'), key: Type.String({ minLength: 1, maxLength: 1_024 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('secretStore'), operation: Type.Literal('set'), key: Type.String({ minLength: 1, maxLength: 256 }), value: Type.String({ minLength: 1, maxLength: 1_048_576 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('secretStore'), operation: Type.Literal('delete'), key: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
  DB_QUERY_SCHEMA,
]);

function safeResource(resource: TActorResource) {
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    status: resource.status,
    createdAt: resource.created_at,
    updatedAt: resource.updated_at,
  };
}

function safeError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value?.code === 'string' ? value.code : 'RESOURCE_OPERATION_FAILED',
    message: typeof value?.message === 'string' ? value.message : 'Resource operation failed.',
  };
}

function safeWriteError(error: unknown, operations: readonly TResourceDataWriteOperation[]) {
  const safe = safeError(error);
  const secretValues = operations.flatMap((operation) => (
    operation.kind === 'secretStore' && operation.operation === 'set' ? [operation.value] : []
  ));
  for (const value of secretValues) {
    safe.code = safe.code.split(value).join('[redacted]');
    safe.message = safe.message.split(value).join('[redacted]');
  }
  return safe;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function assertBatchBound(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > RESOURCE_BATCH_SERIALIZED_LIMIT) {
    throw new Error('Resource operation batch exceeds the total request-size limit.');
  }
}

function toWireParameters(parameters: TDbParameter[] | undefined): TDbCellValue[] | undefined {
  return parameters?.map((value): TDbCellValue => {
    if (value === null) return { type: 'null' };
    if (typeof value === 'string') return { type: 'text', value };
    if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Database parameters must be finite numbers.');
      return Number.isSafeInteger(value) ? { type: 'integer', value: String(value) } : { type: 'real', value };
    }
    return value.type === 'integer'
      ? { type: 'integer', value: value.value }
      : { type: 'blob', base64: value.base64 };
  });
}

async function requireResource(actorService: TActorServiceReloader | undefined, resourceId: string): Promise<TActorResource> {
  const resource = await actorService?.getResource?.(resourceId);
  if (!resource) throw new Error('Resource was not found.');
  if (resource.status !== 'ready') throw new Error(`Resource '${resource.name}' is not ready.`);
  return resource;
}

async function assertUniqueResourceName(actorService: TActorServiceReloader | undefined, name: string, excludeId?: string): Promise<void> {
  const resources = await actorService?.listResources?.({}) ?? [];
  const collision = resources.find((resource) => resource.id !== excludeId && resource.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
  if (collision) throw new Error(`Resource name '${name}' is already in use.`);
}

async function executeReadQuery(actorService: TActorServiceReloader | undefined, resource: TActorResource, query: TResourceDataReadQuery): Promise<unknown> {
  if (query.kind !== resource.kind) throw new Error(`Query kind '${query.kind}' does not match resource kind '${resource.kind}'.`);
  if (query.kind === 'kv') {
    if (query.operation === 'list') {
      if (!actorService?.listResourceData) throw new Error('Resource data listing is unavailable in this host.');
      return actorService.listResourceData({ resourceId: resource.id, prefix: query.prefix, cursor: query.cursor, limit: query.limit });
    }
    if (!actorService?.getResourceDataEntry) throw new Error('Resource data reads are unavailable in this host.');
    const entry = await actorService.getResourceDataEntry({ resourceId: resource.id, key: query.key });
    return query.operation === 'has' ? { exists: entry !== null } : entry;
  }
  if (query.kind === 'secretStore') {
    if (query.operation === 'has') {
      if (!actorService?.getResourceDataEntry) throw new Error('Secret metadata reads are unavailable in this host.');
      return { exists: await actorService.getResourceDataEntry({ resourceId: resource.id, key: query.key }) !== null };
    }
    if (!actorService?.listResourceData) throw new Error('Secret metadata listing is unavailable in this host.');
    return actorService.listResourceData({ resourceId: resource.id, prefix: query.prefix, cursor: query.cursor, limit: query.limit });
  }
  if (!actorService?.executeDbLiveSql) throw new Error('Database queries are unavailable in this host.');
  return actorService.executeDbLiveSql({
    resourceId: resource.id,
    sql: query.sql,
    parameters: toWireParameters(query.parameters),
    approved: false,
  });
}

async function executeWriteOperation(actorService: TActorServiceReloader | undefined, resource: TActorResource, operation: TResourceDataWriteOperation): Promise<unknown> {
  if (operation.kind !== resource.kind) throw new Error(`Operation kind '${operation.kind}' does not match resource kind '${resource.kind}'.`);
  if (operation.kind === 'db') throw new Error('Database writes must use the durable coordinated apply path.');
  if (!actorService?.getResourceDataEntry || !actorService.setResourceDataEntry || !actorService.deleteResourceDataEntry) {
    throw new Error('Resource data writes are unavailable in this host.');
  }
  const current = await actorService.getResourceDataEntry({ resourceId: resource.id, key: operation.key });
  if (operation.operation === 'delete') {
    if (!current) return { deleted: false };
    return actorService.deleteResourceDataEntry({ resourceId: resource.id, key: operation.key, expectedRevision: current.revision });
  }
  const result = await actorService.setResourceDataEntry({
    resourceId: resource.id,
    key: operation.key,
    expectedRevision: current?.revision ?? null,
    value: operation.value,
  });
  return result.kind === 'secretStore' ? { kind: result.kind, entry: result.entry } : result;
}

async function executeDbWriteBatch(
  actorService: TActorServiceReloader | undefined,
  resource: TActorResource,
  operations: Extract<TResourceDataWriteOperation, { kind: 'db' }>[],
): Promise<{ results: unknown[]; atomicity: string; apply: unknown }> {
  if (!actorService?.createDbDraft || !actorService.executeDbDraftSql || !actorService.previewDbApply || !actorService.confirmDbApply || !actorService.discardDbDraft) {
    throw new Error('Durable database writes are unavailable in this host.');
  }
  const details = await actorService.createDbDraft(resource.id, 'AI Chat protected resource write');
  const draftId = details.draft.id;
  let applyStarted = false;
  try {
    for (const operation of operations) {
      await actorService.executeDbDraftSql(draftId, operation.sql, toWireParameters(operation.parameters));
    }
    const preview = await actorService.previewDbApply(draftId);
    const apply = await actorService.confirmDbApply(draftId);
    applyStarted = true;
    return {
      results: operations.map(() => ({ ok: true, value: { staged: true, applyId: apply.id } })),
      atomicity: 'All statements are staged and committed through one durable SQLite draft/apply transaction.',
      apply: { id: apply.id, status: apply.status, warnings: preview.warnings },
    };
  } catch (error) {
    if (!applyStarted) await actorService.discardDbDraft(draftId).catch(() => undefined);
    throw error;
  }
}

function safeWriteDetails(resource: TActorResource, operations: TResourceDataWriteOperation[]) {
  return {
    resource: safeResource(resource),
    operations: operations.map((operation) => operation.kind === 'secretStore' && operation.operation === 'set'
      ? { ...operation, value: '[redacted]' }
      : operation),
    atomicity: 'Operations execute sequentially. Each individual provider operation is atomic; the batch is not a cross-operation transaction.',
  };
}

export function createResourceTools(args: TCreateResourceToolsArgs): TToolDefinition[] {
  const list = defineTool({
    name: 'vc_resource_list',
    label: 'List Resources',
    description: 'List a bounded stable page of safe resource metadata. Values, rows, paths, and native configuration are never returned.',
    parameters: Type.Object({
      kind: Type.Optional(RESOURCE_KIND_SCHEMA),
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_list')) return fnToolError('This tool call is not authorized.');
      if (!args.actorService?.listResources) return fnToolError('Resource discovery is unavailable in this host.');
      const resources = (await args.actorService.listResources(params.kind ? { kind: params.kind } : {}))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
      const start = params.cursor ? resources.findIndex((resource) => resource.id === params.cursor) + 1 : 0;
      if (params.cursor && start === 0) return fnToolError('Resource cursor is stale or invalid.');
      const limit = params.limit ?? 20;
      const page = resources.slice(start, start + limit);
      const nextCursor = start + page.length < resources.length ? page.at(-1)?.id ?? null : null;
      return fnToolSuccess(`Found ${page.length} resource${page.length === 1 ? '' : 's'} in this page.`, {
        resources: page.map(safeResource),
        nextCursor,
      });
    },
  }) as TToolDefinition;

  const inspect = defineTool({
    name: 'vc_resource_inspect',
    label: 'Inspect Resource',
    description: 'Inspect kind-specific safe metadata. Secret plaintext and database rows are never returned.',
    parameters: Type.Object({ resourceId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_inspect')) return fnToolError('This tool call is not authorized.');
      try {
        const resource = await requireResource(args.actorService, params.resourceId);
        const bindings = await args.actorService?.listResourceReferences?.(resource.id) ?? [];
        if (resource.kind === 'db') {
          const inspection = await args.actorService?.inspectDbResource?.({ resourceId: resource.id, target: 'live' });
          if (!inspection) throw new Error('Database schema inspection is unavailable.');
          const objects = inspection.objects.slice(0, 64).map((object) => ({
            name: object.name,
            kind: object.kind,
            columns: object.columns.slice(0, 128),
            indexes: object.indexes.slice(0, 64),
            foreignKeys: object.foreignKeys.slice(0, 64),
            triggers: object.triggers.slice(0, 64),
            createSql: object.createSql?.slice(0, 8_000) ?? null,
            identity: object.identity,
            editable: object.editable,
            readOnlyReason: object.readOnlyReason,
          }));
          return fnToolSuccess(`Inspected database schema for '${resource.name}'. No rows were read.`, {
            resource: safeResource(resource),
            bindingCount: bindings.length,
            objects,
            truncated: inspection.objects.length > objects.length,
          });
        }
        const page = await args.actorService?.listResourceData?.({ resourceId: resource.id, limit: 100 });
        const entries = page?.kind === 'kv'
          ? page.entries.map(({ key, revision, createdAt, updatedAt }) => ({ key, revision, createdAt, updatedAt }))
          : page?.kind === 'secretStore' ? page.entries : [];
        return fnToolSuccess(`Inspected safe metadata for '${resource.name}'.`, {
          resource: safeResource(resource),
          bindingCount: bindings.length,
          entries,
          approximateEntryCount: entries.length,
          truncated: page?.nextCursor !== null,
        });
      } catch (error) {
        return fnToolError(safeError(error).message, { error: safeError(error) });
      }
    },
  }) as TToolDefinition;

  const create = defineTool({
    name: 'vc_resource_create',
    label: 'Create Resource',
    description: 'Request creation of a KV, secret-store, or SQLite database resource. Execution pauses for direct user approval.',
    parameters: Type.Union([
      Type.Object({ kind: Type.Literal('kv'), name: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('secretStore'), name: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('db'), name: Type.String({ minLength: 1, maxLength: 120 }), engine: Type.Optional(Type.Literal('sqlite')) }, { additionalProperties: false }),
    ]),
    async execute(_toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_create')) return fnToolError('This tool call is not authorized.');
      if (!args.actorService?.createResource) return fnToolError('Resource creation is unavailable in this host.');
      try {
        await assertUniqueResourceName(args.actorService, params.name);
        const resource = await args.approvals.request({
          chatId: args.chatId,
          kind: 'resource-create',
          authorization: args.authorization,
          exactArgs: { kind: params.kind as TResourceKind, name: String(params.name) },
          summary: `Create ${params.kind} resource '${params.name}'`,
          risk: 'medium',
          safeDetails: { kind: params.kind, name: params.name, engine: params.kind === 'db' ? 'sqlite' : undefined },
          signal,
          execute: async (stored) => {
            await assertUniqueResourceName(args.actorService, stored.name);
            return args.actorService!.createResource!({ kind: stored.kind, name: stored.name });
          },
        });
        return fnToolSuccess(`Created resource '${resource.name}'.`, { resource: safeResource(resource) });
      } catch (error) {
        return fnToolError(safeError(error).message, { error: safeError(error) });
      }
    },
  }) as TToolDefinition;

  const update = defineTool({
    name: 'vc_resource_update',
    label: 'Update Resource',
    description: 'Request a safe resource metadata update. Resource kind, storage path, and database engine cannot be changed. Execution pauses for user approval.',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, maxLength: 128 }),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    }, { additionalProperties: false, minProperties: 2 }),
    async execute(_toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_update')) return fnToolError('This tool call is not authorized.');
      if (!args.actorService?.renameResource || !params.name) return fnToolError('A mutable resource name is required.');
      try {
        const current = await requireResource(args.actorService, params.resourceId);
        await assertUniqueResourceName(args.actorService, params.name, current.id);
        const resource = await args.approvals.request({
          chatId: args.chatId,
          kind: 'resource-update',
          authorization: args.authorization,
          exactArgs: { resourceId: current.id, name: String(params.name) },
          summary: `Rename resource '${current.name}' to '${params.name}'`,
          risk: 'medium',
          safeDetails: { resource: safeResource(current), name: params.name },
          signal,
          execute: async (stored) => {
            await assertUniqueResourceName(args.actorService, stored.name, stored.resourceId);
            return args.actorService!.renameResource!({ id: stored.resourceId, name: stored.name });
          },
        });
        return fnToolSuccess(`Updated resource '${resource.name}'.`, { resource: safeResource(resource) });
      } catch (error) {
        return fnToolError(safeError(error).message, { error: safeError(error) });
      }
    },
  }) as TToolDefinition;

  const remove = defineTool({
    name: 'vc_resource_delete',
    label: 'Delete Resource',
    description: 'Request deletion of an unbound resource. The agent cannot force deletion or approve it.',
    parameters: Type.Object({ resourceId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
    async execute(_toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_delete')) return fnToolError('This tool call is not authorized.');
      if (!args.actorService?.deleteResource) return fnToolError('Resource deletion is unavailable in this host.');
      try {
        const current = await requireResource(args.actorService, params.resourceId);
        await args.approvals.request({
          chatId: args.chatId,
          kind: 'resource-delete',
          authorization: args.authorization,
          exactArgs: { resourceId: current.id },
          summary: `Delete ${current.kind} resource '${current.name}'`,
          risk: 'high',
          warnings: ['Deletion fails while live widget bindings still reference this resource.'],
          safeDetails: { resource: safeResource(current) },
          signal,
          execute: async (stored) => args.actorService!.deleteResource!(stored.resourceId),
        });
        return fnToolSuccess(`Deleted resource '${current.name}'.`, { deleted: true, resourceId: current.id });
      } catch (error) {
        return fnToolError(safeError(error).message, { error: safeError(error) });
      }
    },
  }) as TToolDefinition;

  const dataRead = defineTool({
    name: 'vc_resource_data_read',
    label: 'Read Resource Data',
    description: 'Run one or more bounded kind-specific reads. Results remain ordered and each query has its own status. Secret plaintext is never returned.',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, maxLength: 128 }),
      query: Type.Union([DATA_READ_QUERY_SCHEMA, Type.Array(DATA_READ_QUERY_SCHEMA, { minItems: 1, maxItems: 20 })]),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_data_read')) return fnToolError('This tool call is not authorized.');
      try {
        const resource = await requireResource(args.actorService, params.resourceId);
        const queries = asArray(params.query as TResourceDataReadQuery | TResourceDataReadQuery[]);
        assertBatchBound(queries);
        const results = [];
        for (const query of queries) {
          try {
            results.push({ ok: true, value: await executeReadQuery(args.actorService, resource, query) });
          } catch (error) {
            results.push({ ok: false, error: safeError(error) });
          }
        }
        return fnToolSuccess(`Completed ${results.length} ordered resource read${results.length === 1 ? '' : 's'}.`, {
          resource: safeResource(resource),
          results,
        });
      } catch (error) {
        return fnToolError(safeError(error).message, { error: safeError(error) });
      }
    },
  }) as TToolDefinition;

  const dataWrite = defineTool({
    name: 'vc_resource_data_write',
    label: 'Write Resource Data',
    description: 'Request one or more kind-specific KV, secret-store, or SQLite writes. Exact server-held arguments execute only after direct user approval.',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, maxLength: 128 }),
      operation: Type.Union([DATA_WRITE_OPERATION_SCHEMA, Type.Array(DATA_WRITE_OPERATION_SCHEMA, { minItems: 1, maxItems: 20 })]),
    }, { additionalProperties: false }),
    async execute(toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_data_write')) return fnToolError('This tool call is not authorized.');
      let protectedOperations: TResourceDataWriteOperation[] = [];
      try {
        params = args.takeSensitiveToolArgs?.(toolCallId) ?? params;
        const resource = await requireResource(args.actorService, params.resourceId);
        const operations = asArray(params.operation as TResourceDataWriteOperation | TResourceDataWriteOperation[]);
        protectedOperations = operations;
        assertBatchBound(operations);
        const mismatch = operations.find((operation) => operation.kind !== resource.kind);
        if (mismatch) throw new Error(`Operation kind '${mismatch.kind}' does not match resource kind '${resource.kind}'.`);
        const execution = await args.approvals.request({
          chatId: args.chatId,
          kind: 'resource-data-write',
          authorization: args.authorization,
          exactArgs: { resourceId: resource.id, operations },
          summary: `Execute ${operations.length} protected ${resource.kind} write${operations.length === 1 ? '' : 's'} on '${resource.name}'`,
          risk: 'high',
          safeDetails: safeWriteDetails(resource, operations),
          signal,
          execute: async (stored) => {
            const current = await requireResource(args.actorService, stored.resourceId);
            if (current.kind === 'db') {
              return executeDbWriteBatch(
                args.actorService,
                current,
                stored.operations as Extract<TResourceDataWriteOperation, { kind: 'db' }>[],
              );
            }
            const output = [];
            for (const operation of stored.operations) {
              try {
                output.push({ ok: true, value: await executeWriteOperation(args.actorService, current, operation) });
              } catch (error) {
                output.push({ ok: false, error: safeWriteError(error, stored.operations) });
              }
            }
            return {
              results: output,
              atomicity: 'Operations execute sequentially. Each individual provider operation is atomic; the batch is not a cross-operation transaction.',
              apply: null,
            };
          },
        });
        return fnToolSuccess(`Completed ${execution.results.length} protected resource write${execution.results.length === 1 ? '' : 's'}.`, {
          resource: safeResource(resource),
          results: execution.results,
          atomicity: execution.atomicity,
          apply: execution.apply,
        });
      } catch (error) {
        const safe = safeWriteError(error, protectedOperations);
        return fnToolError(safe.message, { error: safe });
      }
    },
  }) as TToolDefinition;

  return [list, inspect, create, update, remove, dataRead, dataWrite];
}

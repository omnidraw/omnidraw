import { defineTool } from '@earendil-works/pi-coding-agent';
import type { TDbCellValue, TResourceJson } from '@vibecanvas/resource-runtime';
import { Type } from 'typebox';
import type { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import type { TToolAuthorizationContext } from '../approval/types';
import {
  fnDbSchemaFingerprint,
  fnCreateResourceListCursor,
  fnParseDbSchemaCursor,
  fnParseResourceListCursor,
  fnRedactResourceError,
  fnResourceListFingerprint,
  fnResourceCapabilities,
  fnSafeDbSchemaObject,
  fnSafeDbSchemaOverview,
  fnSafeResource,
  fnSafeResourceError,
  fnSafeResourceMetadata,
  fnSortResources,
} from './fn.resource-tools';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TAgentResource, TAgentResourceService } from './resource-service';
import type { TToolDefinition } from './types';

type TResourceKind = TAgentResource['kind'];
type TDbParameter = string | number | boolean | null | { type: 'integer'; value: string } | { type: 'blob'; base64: string };
type TResourceDataReadQuery =
  | { operation: 'get' | 'has'; key: string }
  | { operation: 'list'; prefix?: string; search?: string; cursor?: string; limit?: number }
  | { operation: 'sql'; sql: string; parameters?: TDbParameter[] }
  | { operation: 'schema'; object?: string; cursor?: string; limit?: number };
type TResourceDataWriteOperation =
  | { operation: 'set'; key: string; value: TResourceJson | string }
  | { operation: 'delete'; key: string }
  | { operation: 'sql'; sql: string; parameters?: TDbParameter[] };

type TCreateResourceToolsArgs = {
  chatId: string;
  authorization: TToolAuthorizationContext;
  resourceService?: TAgentResourceService;
  approvals: ApprovalCoordinator;
  authorize: (toolName: string) => Promise<boolean>;
  takeSensitiveToolArgs?: (toolCallId: string) => unknown;
};

const RESOURCE_BATCH_SERIALIZED_LIMIT = 2_000_000;
const RESOURCE_NAME_SCHEMA = Type.String({ minLength: 1, maxLength: 120 });
const RESOURCE_KIND_SCHEMA = Type.Union([Type.Literal('kv'), Type.Literal('secretStore'), Type.Literal('db')]);
const DB_PARAMETER_SCHEMA = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Object({ type: Type.Literal('integer'), value: Type.String({ pattern: '^-?[0-9]+$' }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('blob'), base64: Type.String({ maxLength: 1_400_000 }) }, { additionalProperties: false }),
]);
const DB_READ_SCHEMA = Type.Object({
  operation: Type.Literal('sql'),
  sql: Type.String({ minLength: 1, maxLength: 1_048_576 }),
  parameters: Type.Optional(Type.Array(DB_PARAMETER_SCHEMA, { maxItems: 256 })),
}, { additionalProperties: false });
const DATA_READ_QUERY_SCHEMA = Type.Union([
  Type.Object({ operation: Type.Union([Type.Literal('get'), Type.Literal('has')]), key: Type.String({ minLength: 1, maxLength: 1_024 }) }, { additionalProperties: false }),
  Type.Object({
    operation: Type.Literal('list'),
    prefix: Type.Optional(Type.String({ maxLength: 1_024 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024, description: 'Case-sensitive substring to find anywhere in a KV or secret key.' })),
    cursor: Type.Optional(Type.String({ maxLength: 4_096 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false }),
  DB_READ_SCHEMA,
  Type.Object({
    operation: Type.Literal('schema'),
    object: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024, description: 'Exact table or view name. Omit for a dense paginated schema catalog.' })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: 'Opaque continuation cursor returned by an earlier schema catalog page.' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: 'Maximum schema objects to return. Defaults to 100.' })),
  }, { additionalProperties: false }),
]);
const DATA_WRITE_OPERATION_SCHEMA = Type.Union([
  Type.Object({ operation: Type.Literal('set'), key: Type.String({ minLength: 1, maxLength: 1_024 }), value: Type.Any() }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal('delete'), key: Type.String({ minLength: 1, maxLength: 1_024 }) }, { additionalProperties: false }),
  DB_READ_SCHEMA,
]);

function toolUnavailable(code: string, message: string) {
  return fnToolError({ code, message });
}

function toolResourceError(error: unknown, secretValues: readonly string[] = [], modelData?: unknown) {
  const safe = fnRedactResourceError(fnSafeResourceError(error), secretValues);
  return fnToolError({
    code: safe.code,
    message: safe.message,
    ...(modelData === undefined ? {} : { modelData }),
    details: { error: safe },
  });
}

function assertBatchBound(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > RESOURCE_BATCH_SERIALIZED_LIMIT) {
    throw Object.assign(new Error('Resource operation batch exceeds the total request-size limit.'), {
      code: 'RESOURCE_BATCH_TOO_LARGE',
    });
  }
}

function toWireParameters(parameters: TDbParameter[] | undefined): TDbCellValue[] | undefined {
  return parameters?.map((value): TDbCellValue => {
    if (value === null) return { type: 'null' };
    if (typeof value === 'string') return { type: 'text', value };
    if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Object.assign(new Error('Database parameters must be finite numbers.'), { code: 'DB_OPERATION_PARAMETERS_INVALID' });
      return Number.isSafeInteger(value) ? { type: 'integer', value: String(value) } : { type: 'real', value };
    }
    return value.type === 'integer'
      ? { type: 'integer', value: value.value }
      : { type: 'blob', base64: value.base64 };
  });
}

async function resolveResource(
  resourceService: TAgentResourceService | undefined,
  resourceName: string,
  requireReady: boolean,
): Promise<TAgentResource> {
  if (!resourceService?.resolveResourceByName) {
    throw Object.assign(new Error('Resource name resolution is unavailable in this host.'), { code: 'RESOURCE_LOOKUP_UNAVAILABLE' });
  }
  return resourceService.resolveResourceByName(resourceName, { requireReady });
}

async function executeReadQuery(
  resourceService: TAgentResourceService | undefined,
  resource: TAgentResource,
  query: TResourceDataReadQuery,
): Promise<unknown> {
  if (query.operation === 'schema') {
    if (resource.kind !== 'db') {
      throw Object.assign(new Error(`Schema inspection is unsupported for ${resource.kind} resources.`), { code: 'RESOURCE_OPERATION_UNSUPPORTED' });
    }
    if (!resourceService?.inspectDbResource) throw new Error('Database schema inspection is unavailable in this host.');
    const inspection = await resourceService.inspectDbResource({ resourceId: resource.id, target: 'live' });
    if (!query.object) {
      const fingerprint = fnDbSchemaFingerprint(inspection?.objects ?? []);
      const parsedCursor = query.cursor
        ? fnParseDbSchemaCursor(query.cursor, fingerprint)
        : { ok: true as const, offset: 0 };
      if (!parsedCursor.ok || parsedCursor.offset > (inspection?.objects.length ?? 0)) {
        throw Object.assign(new Error('Database schema cursor is stale or invalid. Start a new schema request without a cursor.'), {
          code: 'DB_SCHEMA_CURSOR_INVALID',
        });
      }
      return { schema: fnSafeDbSchemaOverview(inspection, { offset: parsedCursor.offset, limit: query.limit }) };
    }
    if (query.cursor !== undefined || query.limit !== undefined) {
      throw Object.assign(new Error('Schema cursor and limit are supported only when object is omitted.'), {
        code: 'DB_SCHEMA_QUERY_INVALID',
      });
    }
    const object = inspection?.objects.find((candidate) => candidate.name.toLowerCase() === query.object!.toLowerCase());
    if (!object) {
      throw Object.assign(new Error(`Database schema object '${query.object}' was not found.`), { code: 'DB_SCHEMA_OBJECT_NOT_FOUND' });
    }
    return { schemaObject: fnSafeDbSchemaObject(object), rowsRead: false };
  }
  if (query.operation === 'sql') {
    if (resource.kind !== 'db') {
      throw Object.assign(new Error(`SQL reads are unsupported for ${resource.kind} resources.`), { code: 'RESOURCE_OPERATION_UNSUPPORTED' });
    }
    if (!resourceService?.executeDbLiveSql) throw new Error('Database queries are unavailable in this host.');
    return resourceService.executeDbLiveSql({
      resourceId: resource.id,
      sql: query.sql,
      parameters: toWireParameters(query.parameters),
      approved: false,
    });
  }
  if (resource.kind === 'db') {
    throw Object.assign(new Error(`Operation '${query.operation}' is unsupported for db resources.`), { code: 'RESOURCE_OPERATION_UNSUPPORTED' });
  }
  if (query.operation === 'get' && resource.kind === 'secretStore') {
    throw Object.assign(new Error('Secret plaintext reads are unsupported. Use has or list for key metadata.'), { code: 'SECRET_READ_UNSUPPORTED' });
  }
  if (query.operation === 'list') {
    if (!resourceService?.listResourceData || !resourceService.countResourceData) {
      throw new Error('Resource key discovery is unavailable in this host.');
    }
    const filter = { resourceId: resource.id, prefix: query.prefix, search: query.search };
    const [page, matchingCount] = await Promise.all([
      resourceService.listResourceData({ ...filter, cursor: query.cursor, limit: query.limit ?? 20 }),
      resourceService.countResourceData(filter),
    ]);
    const entries = page.kind === 'kv'
      ? page.entries.map(({ key, revision, createdAt, updatedAt }) => ({ key, revision, createdAt, updatedAt }))
      : page.entries;
    return {
      kind: page.kind,
      entries,
      matchingCount,
      nextCursor: page.nextCursor,
    };
  }
  if (!resourceService?.getResourceDataEntry) throw new Error('Resource data reads are unavailable in this host.');
  const entry = await resourceService.getResourceDataEntry({ resourceId: resource.id, key: query.key });
  return query.operation === 'has' ? { exists: entry !== null } : entry;
}

function validateWriteOperation(resource: TAgentResource, operation: TResourceDataWriteOperation): void {
  if (resource.kind === 'db') {
    if (operation.operation !== 'sql') {
      throw Object.assign(new Error(`Operation '${operation.operation}' is unsupported for db resources.`), { code: 'RESOURCE_OPERATION_UNSUPPORTED' });
    }
    return;
  }
  if (operation.operation === 'sql') {
    throw Object.assign(new Error(`SQL writes are unsupported for ${resource.kind} resources.`), { code: 'RESOURCE_OPERATION_UNSUPPORTED' });
  }
  const maxKeyLength = resource.kind === 'secretStore' ? 256 : 1_024;
  if (operation.key.trim().length === 0 || operation.key.length > maxKeyLength) {
    throw Object.assign(new Error(`${resource.kind === 'secretStore' ? 'Secret names' : 'KV keys'} must be non-blank strings no longer than ${maxKeyLength} characters.`), {
      code: resource.kind === 'secretStore' ? 'SECRET_NAME_INVALID' : 'KV_KEY_INVALID',
    });
  }
  if (operation.operation === 'set' && resource.kind === 'secretStore' && (typeof operation.value !== 'string' || operation.value.length === 0)) {
    throw Object.assign(new Error('Secret set values must be non-empty strings.'), { code: 'SECRET_VALUE_INVALID' });
  }
}

async function executeWriteOperation(
  resourceService: TAgentResourceService | undefined,
  resource: TAgentResource,
  operation: Exclude<TResourceDataWriteOperation, { operation: 'sql' }>,
): Promise<unknown> {
  if (!resourceService?.getResourceDataEntry || !resourceService.setResourceDataEntry || !resourceService.deleteResourceDataEntry) {
    throw new Error('Resource data writes are unavailable in this host.');
  }
  const current = await resourceService.getResourceDataEntry({ resourceId: resource.id, key: operation.key });
  if (operation.operation === 'delete') {
    if (!current) return { deleted: false };
    return resourceService.deleteResourceDataEntry({ resourceId: resource.id, key: operation.key, expectedRevision: current.revision });
  }
  const result = await resourceService.setResourceDataEntry({
    resourceId: resource.id,
    key: operation.key,
    expectedRevision: current?.revision ?? null,
    value: operation.value,
  });
  return result.kind === 'secretStore' ? { kind: result.kind, entry: result.entry } : result;
}

async function executeDbWriteBatch(
  resourceService: TAgentResourceService | undefined,
  resource: TAgentResource,
  operations: Extract<TResourceDataWriteOperation, { operation: 'sql' }>[],
): Promise<{ results: unknown[]; atomicity: string; apply: unknown }> {
  if (!resourceService?.createDbDraft || !resourceService.executeDbDraftSql || !resourceService.previewDbApply || !resourceService.confirmDbApply || !resourceService.discardDbDraft) {
    throw new Error('Durable database writes are unavailable in this host.');
  }
  const details = await resourceService.createDbDraft(resource.id, 'AI Chat protected resource write');
  const draftId = details.draft.id;
  let applyStarted = false;
  try {
    for (const operation of operations) {
      await resourceService.executeDbDraftSql(draftId, operation.sql, toWireParameters(operation.parameters));
    }
    const preview = await resourceService.previewDbApply(draftId);
    const apply = await resourceService.confirmDbApply(draftId);
    applyStarted = true;
    const warnings = preview.warnings.slice(0, 40);
    return {
      results: operations.map((_, index) => ({ index, ok: true, value: { staged: true, applyStatus: apply.status } })),
      atomicity: 'All statements are staged and committed through one durable SQLite draft/apply transaction.',
      apply: {
        status: apply.status,
        warnings,
        warningsTruncated: preview.warnings.length > warnings.length,
      },
    };
  } catch (error) {
    if (!applyStarted) await resourceService.discardDbDraft(draftId).catch(() => undefined);
    throw error;
  }
}

function secretWriteValues(resource: TAgentResource | undefined, operations: readonly TResourceDataWriteOperation[]): string[] {
  if (resource?.kind !== 'secretStore') return [];
  return operations.flatMap((operation) => (
    operation.operation === 'set' && typeof operation.value === 'string' ? [operation.value] : []
  ));
}

function safeWriteApprovalDetails(resource: TAgentResource, operations: readonly TResourceDataWriteOperation[]) {
  return {
    resource: fnSafeResource(resource),
    operations: operations.map((operation, index) => (
      resource.kind === 'secretStore' && operation.operation === 'set'
        ? { index, operation: 'set', key: operation.key, value: '[redacted]' }
        : { index, ...operation }
    )),
    atomicity: resource.kind === 'db'
      ? 'All statements use one durable SQLite draft/apply transaction.'
      : 'Operations execute sequentially. Each provider operation is atomic; the batch is not a cross-operation transaction.',
  };
}

export function createResourceTools(args: TCreateResourceToolsArgs): TToolDefinition[] {
  const list = defineTool({
    name: 'vc_resource_list',
    label: 'List Resources',
    description: 'Discover resources by public name. Follow with vc_resource_inspect using resourceName; internal IDs are never returned.',
    parameters: Type.Object({
      kind: Type.Optional(RESOURCE_KIND_SCHEMA),
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_list')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      if (!args.resourceService?.listResources) return toolUnavailable('RESOURCE_LIST_UNAVAILABLE', 'Resource discovery is unavailable in this host.');
      try {
        const resources = fnSortResources(await args.resourceService.listResources(params.kind ? { kind: params.kind } : {}));
        const fingerprint = fnResourceListFingerprint(resources);
        const parsedCursor = params.cursor
          ? fnParseResourceListCursor(params.cursor, fingerprint, params.kind)
          : { ok: true as const, offset: 0 };
        if (!parsedCursor.ok || parsedCursor.offset > resources.length) {
          return toolUnavailable('RESOURCE_CURSOR_INVALID', 'Resource cursor is stale or invalid. Start a new list request without a cursor.');
        }
        const limit = params.limit ?? 20;
        const page = resources.slice(parsedCursor.offset, parsedCursor.offset + limit);
        const nextOffset = parsedCursor.offset + page.length;
        const modelData = {
          resources: page.map(fnSafeResource),
          nextCursor: nextOffset < resources.length ? fnCreateResourceListCursor(nextOffset, fingerprint, params.kind) : null,
        };
        return fnToolSuccess({
          summary: `Found ${page.length} resource${page.length === 1 ? '' : 's'} in this page.`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return toolResourceError(error);
      }
    },
  }) as TToolDefinition;

  const inspect = defineTool({
    name: 'vc_resource_inspect',
    label: 'Inspect Resource',
    description: 'Inspect compact safe metadata by resourceName, including status, bindings, deletability, KV/secret key count only, or the first dense database schema page. Continue a database schema cursor with vc_resource_data_read.',
    parameters: Type.Object({ resourceName: RESOURCE_NAME_SCHEMA }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_inspect')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      let internalResourceId: string | undefined;
      try {
        const resource = await resolveResource(args.resourceService, params.resourceName, false);
        internalResourceId = resource.id;
        const bindings = await args.resourceService?.listResourceReferences?.(resource.id) ?? [];
        const lifecycle = fnResourceCapabilities(resource, bindings.length);
        const base = {
          resource: fnSafeResourceMetadata(resource),
          ready: lifecycle.ready,
          bindingCount: bindings.length,
          currentlyDeletable: lifecycle.currentlyDeletable,
          deleteBlockedReason: lifecycle.deleteBlockedReason,
          capabilities: lifecycle.capabilities,
        };
        let modelData: Record<string, unknown>;
        if (resource.kind === 'db') {
          const inspection = resource.status === 'ready'
            ? await args.resourceService?.inspectDbResource?.({ resourceId: resource.id, target: 'live' })
            : null;
          modelData = {
            ...base,
            schema: fnSafeDbSchemaOverview(inspection),
          };
        } else {
          const count = resource.status === 'ready'
            ? await args.resourceService?.countResourceData?.({ resourceId: resource.id }) ?? null
            : null;
          modelData = {
            ...base,
            keys: { count },
          };
        }
        return fnToolSuccess({
          summary: `Inspected safe metadata for '${resource.name}'.${resource.kind === 'db' ? ' No rows were read.' : ''}`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return toolResourceError(error, internalResourceId ? [internalResourceId] : []);
      }
    },
  }) as TToolDefinition;

  const create = defineTool({
    name: 'vc_resource_create',
    label: 'Create Resource',
    description: 'Request creation of a named KV, secret-store, or SQLite database resource. Direct user approval is required; follow success with vc_resource_inspect using the returned name.',
    parameters: Type.Union([
      Type.Object({ kind: Type.Literal('kv'), name: RESOURCE_NAME_SCHEMA }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('secretStore'), name: RESOURCE_NAME_SCHEMA }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('db'), name: RESOURCE_NAME_SCHEMA, engine: Type.Optional(Type.Literal('sqlite')) }, { additionalProperties: false }),
    ]),
    async execute(toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_create')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      if (!args.resourceService?.createResource) return toolUnavailable('RESOURCE_CREATE_UNAVAILABLE', 'Resource creation is unavailable in this host.');
      try {
        const resource = await args.approvals.request({
          chatId: args.chatId,
          toolCallId,
          kind: 'resource-create',
          authorization: args.authorization,
          exactArgs: { kind: params.kind as TResourceKind, name: String(params.name) },
          summary: `Create ${params.kind} resource '${params.name}'`,
          risk: 'medium',
          safeDetails: { kind: params.kind, name: params.name, engine: params.kind === 'db' ? 'sqlite' : undefined },
          signal,
          execute: async (stored) => args.resourceService!.createResource!({ kind: stored.kind, name: stored.name }),
        });
        const modelData = { resource: fnSafeResource(resource) };
        return fnToolSuccess({ summary: `Created resource '${resource.name}'.`, modelData, details: modelData });
      } catch (error) {
        return toolResourceError(error);
      }
    },
  }) as TToolDefinition;

  const update = defineTool({
    name: 'vc_resource_update',
    label: 'Rename Resource',
    description: 'Rename a resource by its current public resourceName. The stable internal target is frozen before direct user approval; use newName for subsequent calls.',
    parameters: Type.Object({
      resourceName: RESOURCE_NAME_SCHEMA,
      newName: RESOURCE_NAME_SCHEMA,
    }, { additionalProperties: false }),
    async execute(toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_update')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      if (!args.resourceService?.renameResource) return toolUnavailable('RESOURCE_UPDATE_UNAVAILABLE', 'Resource rename is unavailable in this host.');
      let internalResourceId: string | undefined;
      try {
        const current = await resolveResource(args.resourceService, params.resourceName, false);
        internalResourceId = current.id;
        const resource = await args.approvals.request({
          chatId: args.chatId,
          toolCallId,
          kind: 'resource-update',
          authorization: args.authorization,
          exactArgs: { resourceId: current.id, newName: String(params.newName) },
          summary: `Rename resource '${current.name}' to '${params.newName}'`,
          risk: 'medium',
          safeDetails: { resource: fnSafeResource(current), newName: params.newName },
          signal,
          execute: async (stored) => args.resourceService!.renameResource!({ id: stored.resourceId, name: stored.newName }),
        });
        const modelData = { resource: fnSafeResource(resource) };
        return fnToolSuccess({ summary: `Renamed resource to '${resource.name}'.`, modelData, details: modelData });
      } catch (error) {
        return toolResourceError(error, internalResourceId ? [internalResourceId] : []);
      }
    },
  }) as TToolDefinition;

  const remove = defineTool({
    name: 'vc_resource_delete',
    label: 'Delete Resource',
    description: 'Request deletion by resourceName. The stable internal target is frozen before approval and binding safety is rechecked during execution.',
    parameters: Type.Object({ resourceName: RESOURCE_NAME_SCHEMA }, { additionalProperties: false }),
    async execute(toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_delete')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      if (!args.resourceService?.deleteResource) return toolUnavailable('RESOURCE_DELETE_UNAVAILABLE', 'Resource deletion is unavailable in this host.');
      let internalResourceId: string | undefined;
      try {
        const current = await resolveResource(args.resourceService, params.resourceName, false);
        internalResourceId = current.id;
        await args.approvals.request({
          chatId: args.chatId,
          toolCallId,
          kind: 'resource-delete',
          authorization: args.authorization,
          exactArgs: { resourceId: current.id },
          summary: `Delete ${current.kind} resource '${current.name}'`,
          risk: 'high',
          warnings: ['Deletion fails while live widget bindings still reference this resource.'],
          safeDetails: { resource: fnSafeResource(current) },
          signal,
          execute: async (stored) => args.resourceService!.deleteResource!(stored.resourceId),
        });
        const modelData = { deleted: true, resourceName: current.name };
        return fnToolSuccess({ summary: `Deleted resource '${current.name}'.`, modelData, details: modelData });
      } catch (error) {
        return toolResourceError(error, internalResourceId ? [internalResourceId] : []);
      }
    },
  }) as TToolDefinition;

  const dataRead = defineTool({
    name: 'vc_resource_data_read',
    label: 'Read Resource Data',
    description: 'Run ordered reads against resourceName. KV/secret list supports prefix, substring search, pagination, and returns key metadata only; get reads one KV value. Database schema returns dense catalogs of up to 100 objects with cursor pagination or one detailed table/view definition, while sql runs a bounded read-only statement.',
    parameters: Type.Object({
      resourceName: RESOURCE_NAME_SCHEMA,
      queries: Type.Array(DATA_READ_QUERY_SCHEMA, { minItems: 1, maxItems: 20 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_resource_data_read')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      try {
        const resource = await resolveResource(args.resourceService, params.resourceName, true);
        const queries = params.queries as TResourceDataReadQuery[];
        assertBatchBound(queries);
        const results = [];
        for (const [index, query] of queries.entries()) {
          try {
            results.push({ index, ok: true, value: await executeReadQuery(args.resourceService, resource, query) });
          } catch (error) {
            results.push({ index, ok: false, error: fnRedactResourceError(fnSafeResourceError(error), [resource.id]) });
          }
        }
        const modelData = { resource: fnSafeResource(resource), results };
        return fnToolSuccess({
          summary: `Completed ${results.length} ordered resource read${results.length === 1 ? '' : 's'}.`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return toolResourceError(error);
      }
    },
  }) as TToolDefinition;

  const dataWrite = defineTool({
    name: 'vc_resource_data_write',
    label: 'Write Resource Data',
    description: 'Request an ordered array of writes against resourceName. The stable internal target and exact server-held arguments execute only after direct user approval.',
    parameters: Type.Object({
      resourceName: RESOURCE_NAME_SCHEMA,
      operations: Type.Array(DATA_WRITE_OPERATION_SCHEMA, { minItems: 1, maxItems: 20 }),
    }, { additionalProperties: false }),
    async execute(toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_resource_data_write')) return toolUnavailable('TOOL_NOT_AUTHORIZED', 'This tool call is not authorized.');
      let resource: TAgentResource | undefined;
      let operations: TResourceDataWriteOperation[] = [];
      try {
        params = args.takeSensitiveToolArgs?.(toolCallId) ?? params;
        resource = await resolveResource(args.resourceService, params.resourceName, true);
        operations = params.operations as TResourceDataWriteOperation[];
        assertBatchBound(operations);
        const invalidResults = operations.flatMap((operation, index) => {
          try {
            validateWriteOperation(resource!, operation);
            return [];
          } catch (error) {
            return [{ index, ok: false as const, error: fnSafeResourceError(error) }];
          }
        });
        if (invalidResults.length > 0) {
          const modelData = { resource: fnSafeResource(resource), results: invalidResults };
          return fnToolError({
            code: 'RESOURCE_WRITE_INVALID',
            message: 'One or more resource write operations are invalid for the resolved resource kind.',
            modelData,
            details: modelData,
          });
        }
        const execution = await args.approvals.request({
          chatId: args.chatId,
          toolCallId,
          kind: 'resource-data-write',
          authorization: args.authorization,
          exactArgs: { resourceId: resource.id, operations },
          summary: `Execute ${operations.length} protected ${resource.kind} write${operations.length === 1 ? '' : 's'} on '${resource.name}'`,
          risk: 'high',
          safeDetails: safeWriteApprovalDetails(resource, operations),
          signal,
          execute: async (stored) => {
            const current = await args.resourceService?.getResource?.(stored.resourceId);
            if (!current) throw Object.assign(new Error('The approved resource no longer exists.'), { code: 'RESOURCE_NOT_FOUND' });
            if (current.status !== 'ready') throw Object.assign(new Error(`Resource '${current.name}' is not ready.`), { code: 'RESOURCE_NOT_READY' });
            if (current.kind === 'db') {
              return executeDbWriteBatch(
                args.resourceService,
                current,
                stored.operations as Extract<TResourceDataWriteOperation, { operation: 'sql' }>[],
              );
            }
            const output = [];
            for (const [index, operation] of stored.operations.entries()) {
              try {
                output.push({
                  index,
                  ok: true,
                  value: await executeWriteOperation(
                    args.resourceService,
                    current,
                    operation as Exclude<TResourceDataWriteOperation, { operation: 'sql' }>,
                  ),
                });
              } catch (error) {
                output.push({
                  index,
                  ok: false,
                  error: fnRedactResourceError(fnSafeResourceError(error), [current.id, ...secretWriteValues(current, stored.operations)]),
                });
              }
            }
            return {
              results: output,
              atomicity: 'Operations execute sequentially. Each individual provider operation is atomic; the batch is not a cross-operation transaction.',
              apply: null,
            };
          },
        });
        const modelData = {
          resource: fnSafeResource(resource),
          results: execution.results,
          atomicity: execution.atomicity,
          apply: execution.apply,
        };
        return fnToolSuccess({
          summary: `Completed ${execution.results.length} protected resource write${execution.results.length === 1 ? '' : 's'}.`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return toolResourceError(error, [
          ...(resource ? [resource.id] : []),
          ...secretWriteValues(resource, operations),
        ]);
      }
    },
  }) as TToolDefinition;

  return [list, inspect, create, update, remove, dataRead, dataWrite];
}

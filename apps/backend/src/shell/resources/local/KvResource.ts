import { ResourceError, toResourceError } from '#backend/core/resources/ResourceError';
import type {
  IResourceKeyValuePersistence,
  TResourceJson as TJson,
  TResourceKeyValueCompareAndSetResult,
  TResourceKeyValueDeleteResult,
  TResourceKeyValueEntry,
  TResourceKeyValuePage,
} from './ResourceKeyValuePersistence';
import type {
  ILocalResourceProvider,
  TLocalResourceReconcileResult,
  TLocalResolvedResourceCall,
  TLocalResource,
  TLocalResourceRequirement,
} from './ResourceProviderTypes';

type TResourceProviderCreateArgs = unknown;

const KEY_MAX_LENGTH = 1_024;
const LIST_MAX_LIMIT = 500;

function recordArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ResourceError('KV_OPERATION_FAILED', 'KV operation arguments must be an object.');
  }
  return args as Record<string, unknown>;
}

function keyArg(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > KEY_MAX_LENGTH) {
    throw new ResourceError('KV_KEY_INVALID', `KV keys must be non-blank strings no longer than ${KEY_MAX_LENGTH} characters.`);
  }
  return value;
}

function listTextArg(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > KEY_MAX_LENGTH) {
    throw new ResourceError('KV_KEY_INVALID', `${label} must be a string no longer than ${KEY_MAX_LENGTH} characters.`);
  }
  return value;
}

function listLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > LIST_MAX_LIMIT) {
    throw new ResourceError('KV_LIST_LIMIT_EXCEEDED', `KV list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
  }
  return value as number;
}

function expectedRevision(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ResourceError('KV_OPERATION_FAILED', 'Expected revision must be null or a positive integer.');
  }
  return value as number;
}

function optionalExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ResourceError('KV_OPERATION_FAILED', 'Expected revision must be a positive integer.');
  }
  return value as number;
}

export class KvResource implements ILocalResourceProvider {
  readonly kind = 'kv' as const;
  readonly reconcileReady = true;

  constructor(private readonly persistence: IResourceKeyValuePersistence) {}

  async provision(resource: TLocalResource, _args: TResourceProviderCreateArgs): Promise<void> {
    if (resource.kind !== this.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', 'KV resource catalog kind is invalid.');
    try {
      await this.persistence.provision({ resourceId: resource.id, kind: this.kind });
    } catch (error) {
      throw toResourceError(error, 'KV_RESOURCE_UNAVAILABLE', 'KV resource provisioning failed.');
    }
  }

  async delete(resource: TLocalResource): Promise<void> {
    if (resource.kind !== this.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', 'KV resource catalog kind is invalid.');
    try {
      await this.persistence.deleteResource({ resourceId: resource.id, kind: this.kind });
    } catch (error) {
      throw toResourceError(error, 'KV_RESOURCE_UNAVAILABLE', 'KV resource physical deletion failed.');
    }
  }

  async reconcile(resource: TLocalResource): Promise<TLocalResourceReconcileResult> {
    if (resource.kind !== this.kind) {
      return {
        status: 'error' as const,
        lastError: { code: 'RESOURCE_KIND_MISMATCH', message: 'KV resource catalog kind is invalid.' },
      };
    }
    try {
      await this.persistence.verify({ resourceId: resource.id, kind: this.kind });
      return { status: 'ready' as const };
    } catch {
      return {
        status: 'error' as const,
        lastError: { code: 'KV_RESOURCE_UNAVAILABLE', message: 'KV resource physical state could not be verified safely.' },
      };
    }
  }

  close(): Promise<void> {
    return this.persistence.close();
  }

  effect(operation: string, _requirement: TLocalResourceRequirement): 'read' | 'write' | null {
    if (operation === 'get' || operation === 'has' || operation === 'list') return 'read';
    if (operation === 'set' || operation === 'delete' || operation === 'compareAndSet') return 'write';
    return null;
  }

  async countEntries(args: { resourceId: string; prefix?: string; search?: string }): Promise<number> {
    try {
      return await this.persistence.count({
        resourceId: args.resourceId,
        prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'KV list prefix', true),
        search: args.search === undefined ? undefined : listTextArg(args.search, 'KV list search', true),
      });
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async listEntries(args: {
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<TResourceKeyValuePage> {
    try {
      return await this.persistence.list({
        resourceId: args.resourceId,
        prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'KV list prefix', true),
        search: args.search === undefined ? undefined : listTextArg(args.search, 'KV list search', true),
        cursor: args.cursor === undefined ? undefined : listTextArg(args.cursor, 'KV list cursor', false),
        limit: listLimit(args.limit),
      });
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async getEntry(args: { resourceId: string; key: unknown }): Promise<TResourceKeyValueEntry | null> {
    try {
      return await this.persistence.get({ resourceId: args.resourceId, key: keyArg(args.key) });
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async hasEntry(args: { resourceId: string; key: unknown }): Promise<boolean> {
    try {
      return await this.persistence.has({ resourceId: args.resourceId, key: keyArg(args.key) });
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async setEntry(args: { resourceId: string; key: unknown; value: unknown }): Promise<TResourceKeyValueEntry> {
    try {
      return await this.persistence.set({ resourceId: args.resourceId, key: keyArg(args.key), value: args.value as TJson });
    } catch (error) {
      if (error instanceof TypeError) throw new ResourceError('KV_VALUE_INVALID', 'KV value is not JSON-compatible.');
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async deleteEntry(args: {
    resourceId: string;
    key: unknown;
    expectedRevision?: unknown;
  }): Promise<TResourceKeyValueDeleteResult> {
    try {
      return await this.persistence.delete({
        resourceId: args.resourceId,
        key: keyArg(args.key),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      });
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async compareAndSetEntry(args: {
    resourceId: string;
    key: unknown;
    expectedRevision: unknown;
    value: unknown;
  }): Promise<TResourceKeyValueCompareAndSetResult> {
    try {
      return await this.persistence.compareAndSet({
        resourceId: args.resourceId,
        key: keyArg(args.key),
        expectedRevision: expectedRevision(args.expectedRevision),
        value: args.value as TJson,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ResourceError('KV_VALUE_INVALID', 'KV value is not JSON-compatible.');
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

  async dispatch(context: TLocalResolvedResourceCall, operation: string, rawArgs: unknown): Promise<unknown> {
    try {
      if (context.resource.kind !== this.kind || context.requirement.kind !== this.kind) {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'KV resource kind does not match the resolved slot.');
      }
      const args = recordArgs(rawArgs);
      if (operation === 'get') {
        const entry = await this.getEntry({ resourceId: context.resource.id, key: args.key });
        return entry ? { value: entry.value, revision: entry.revision } : null;
      }
      if (operation === 'has') {
        return this.hasEntry({ resourceId: context.resource.id, key: args.key });
      }
      if (operation === 'list') {
        const page = await this.listEntries({
          resourceId: context.resource.id,
          prefix: args.prefix as string | undefined,
          cursor: args.cursor as string | undefined,
          limit: args.limit as number | undefined,
        });
        return {
          items: page.entries.map((entry) => ({ key: entry.key, value: entry.value, revision: entry.revision })),
          ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
        };
      }
      if (operation === 'set') {
        const entry = await this.setEntry({ resourceId: context.resource.id, key: args.key, value: args.value });
        return { value: entry.value, revision: entry.revision };
      }
      if (operation === 'delete') {
        return this.deleteEntry({ resourceId: context.resource.id, key: args.key });
      }
      if (operation === 'compareAndSet') {
        const result = await this.compareAndSetEntry({
          resourceId: context.resource.id,
          key: args.key,
          expectedRevision: args.expectedRevision,
          value: args.value,
        });
        return result.ok
          ? { ok: true, entry: { value: result.entry.value, revision: result.entry.revision } }
          : { ok: false, currentRevision: result.currentRevision };
      }
      throw new ResourceError('KV_OPERATION_FAILED', `Unknown KV operation "${operation}".`);
    } catch (error) {
      throw toResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }

}

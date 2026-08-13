import { ResourceError, toResourceError } from '#backend/core/resources/ResourceError';
import type {
  IResourceKeyValuePersistence,
  TResourceKeyValueDeleteResult,
  TResourceKeyValueEntry,
  TResourceKeyValueEntryMetadata,
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

const SECRET_NAME_MAX_LENGTH = 256;
const SECRET_VALUE_MAX_LENGTH = 1_048_576;
const LIST_MAX_LIMIT = 500;

export type TSecretStoreCompareAndSetResult =
  | { readonly ok: true; readonly entry: TResourceKeyValueEntryMetadata }
  | { readonly ok: false; readonly expectedRevision: number | null; readonly currentRevision: number | null };

function recordArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ResourceError('SECRET_OPERATION_FAILED', 'Secret-store operation arguments must be an object.');
  }
  return args as Record<string, unknown>;
}

function secretName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > SECRET_NAME_MAX_LENGTH) {
    throw new ResourceError('SECRET_NAME_INVALID', `Secret names must be non-blank strings no longer than ${SECRET_NAME_MAX_LENGTH} characters.`);
  }
  return value;
}

function secretValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > SECRET_VALUE_MAX_LENGTH) {
    throw new ResourceError('SECRET_VALUE_INVALID', `Secret values must be non-empty strings no longer than ${SECRET_VALUE_MAX_LENGTH} characters.`);
  }
  return value;
}

function listTextArg(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > SECRET_NAME_MAX_LENGTH) {
    throw new ResourceError('SECRET_NAME_INVALID', `${label} must be a string no longer than ${SECRET_NAME_MAX_LENGTH} characters.`);
  }
  return value;
}

function listLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > LIST_MAX_LIMIT) {
    throw new ResourceError('SECRET_OPERATION_FAILED', `Secret list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
  }
  return value as number;
}

function expectedRevision(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ResourceError('SECRET_OPERATION_FAILED', 'Expected revision must be null or a positive integer.');
  }
  return value as number;
}

function optionalExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ResourceError('SECRET_OPERATION_FAILED', 'Expected revision must be a positive integer.');
  }
  return value as number;
}

function entryMetadata(entry: TResourceKeyValueEntry): TResourceKeyValueEntryMetadata {
  return {
    key: entry.key,
    revision: entry.revision,
    createdAtSec: entry.createdAtSec,
    updatedAtSec: entry.updatedAtSec,
  };
}

export class SecretStoreResource implements ILocalResourceProvider {
  readonly kind = 'secretStore' as const;
  readonly reconcileReady = true;

  constructor(private readonly persistence: IResourceKeyValuePersistence) {}

  async provision(resource: TLocalResource, _args: TResourceProviderCreateArgs): Promise<void> {
    if (resource.kind !== this.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Secret-store resource catalog kind is invalid.');
    try {
      await this.persistence.provision({ resourceId: resource.id, kind: this.kind });
    } catch (error) {
      throw toResourceError(error, 'SECRET_STORE_UNAVAILABLE', 'Secret-store resource provisioning failed.');
    }
  }

  async delete(resource: TLocalResource): Promise<void> {
    if (resource.kind !== this.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Secret-store resource catalog kind is invalid.');
    try {
      await this.persistence.deleteResource({ resourceId: resource.id, kind: this.kind });
    } catch (error) {
      throw toResourceError(error, 'SECRET_STORE_UNAVAILABLE', 'Secret-store physical deletion failed.');
    }
  }

  async reconcile(resource: TLocalResource): Promise<TLocalResourceReconcileResult> {
    if (resource.kind !== this.kind) {
      return {
        status: 'error' as const,
        lastError: { code: 'RESOURCE_KIND_MISMATCH', message: 'Secret-store resource catalog kind is invalid.' },
      };
    }
    try {
      await this.persistence.verify({ resourceId: resource.id, kind: this.kind });
      return { status: 'ready' as const };
    } catch (error) {
      if (
        error instanceof ResourceError
        && (error.code === 'SECRET_STORE_KEY_UNAVAILABLE' || error.code === 'SECRET_STORE_DECRYPTION_FAILED')
      ) {
        return {
          status: 'error' as const,
          lastError: { code: error.code, message: error.message },
        };
      }
      return {
        status: 'error' as const,
        lastError: { code: 'SECRET_STORE_UNAVAILABLE', message: 'Secret-store physical state could not be verified safely.' },
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
        prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'Secret list prefix', true),
        search: args.search === undefined ? undefined : listTextArg(args.search, 'Secret list search', true),
      });
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async listEntries(args: {
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<TResourceKeyValuePage<TResourceKeyValueEntryMetadata>> {
    try {
      return await this.persistence.listMetadata({
        resourceId: args.resourceId,
        prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'Secret list prefix', true),
        search: args.search === undefined ? undefined : listTextArg(args.search, 'Secret list search', true),
        cursor: args.cursor === undefined ? undefined : listTextArg(args.cursor, 'Secret list cursor', false),
        limit: listLimit(args.limit),
      });
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async getEntryMetadata(args: { resourceId: string; name: unknown }): Promise<TResourceKeyValueEntryMetadata | null> {
    try {
      return await this.persistence.getMetadata({ resourceId: args.resourceId, key: secretName(args.name) });
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async revealEntry(args: { resourceId: string; name: unknown }): Promise<{
    readonly key: string;
    readonly value: string;
    readonly revision: number;
  } | null> {
    const name = secretName(args.name);
    try {
      const entry = await this.persistence.get({ resourceId: args.resourceId, key: name });
      if (!entry) return null;
      if (typeof entry.value !== 'string') {
        throw new TypeError('Stored secret value has an invalid type.');
      }
      return { key: entry.key, value: entry.value, revision: entry.revision };
    } catch (error) {
      throw toResourceError(error, 'SECRET_STORE_UNAVAILABLE', 'Stored secret could not be revealed.');
    }
  }

  async hasEntry(args: { resourceId: string; name: unknown }): Promise<boolean> {
    try {
      return await this.persistence.has({ resourceId: args.resourceId, key: secretName(args.name) });
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async setEntryMetadata(args: {
    resourceId: string;
    name: unknown;
    value: unknown;
  }): Promise<TResourceKeyValueEntryMetadata> {
    try {
      const entry = await this.persistence.set({
        resourceId: args.resourceId,
        key: secretName(args.name),
        value: secretValue(args.value),
      });
      return entryMetadata(entry);
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async deleteEntry(args: {
    resourceId: string;
    name: unknown;
    expectedRevision?: unknown;
  }): Promise<TResourceKeyValueDeleteResult> {
    try {
      return await this.persistence.delete({
        resourceId: args.resourceId,
        key: secretName(args.name),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      });
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async compareAndSetEntry(args: {
    resourceId: string;
    name: unknown;
    expectedRevision: unknown;
    value: unknown;
  }): Promise<TSecretStoreCompareAndSetResult> {
    try {
      const result = await this.persistence.compareAndSet({
        resourceId: args.resourceId,
        key: secretName(args.name),
        expectedRevision: expectedRevision(args.expectedRevision),
        value: secretValue(args.value),
      });
      return result.ok ? { ok: true, entry: entryMetadata(result.entry) } : result;
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async #getPlaintextEntry(args: { resourceId: string; name: unknown }): Promise<TResourceKeyValueEntry | null> {
    try {
      const entry = await this.persistence.get({ resourceId: args.resourceId, key: secretName(args.name) });
      if (entry && typeof entry.value !== 'string') {
        throw new ResourceError('SECRET_OPERATION_FAILED', 'Stored secret value has an invalid type.');
      }
      return entry;
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

  async dispatch(context: TLocalResolvedResourceCall, operation: string, rawArgs: unknown): Promise<unknown> {
    try {
      if (context.resource.kind !== this.kind || context.requirement.kind !== this.kind) {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Secret-store resource kind does not match the resolved slot.');
      }
      const args = recordArgs(rawArgs);
      if (operation === 'get') {
        const entry = await this.#getPlaintextEntry({ resourceId: context.resource.id, name: args.name });
        return entry ? { value: entry.value, revision: entry.revision } : null;
      }
      if (operation === 'has') {
        return this.hasEntry({ resourceId: context.resource.id, name: args.name });
      }
      if (operation === 'list') {
        const page = await this.listEntries({
          resourceId: context.resource.id,
          prefix: args.prefix as string | undefined,
          cursor: args.cursor as string | undefined,
          limit: args.limit as number | undefined,
        });
        return {
          items: page.entries.map((entry) => ({
            name: entry.key,
            revision: entry.revision,
            createdAtSec: entry.createdAtSec,
            updatedAtSec: entry.updatedAtSec,
          })),
          ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
        };
      }
      if (operation === 'set') {
        const entry = await this.setEntryMetadata({ resourceId: context.resource.id, name: args.name, value: args.value });
        return { name: entry.key, revision: entry.revision };
      }
      if (operation === 'delete') {
        return this.deleteEntry({ resourceId: context.resource.id, name: args.name });
      }
      if (operation === 'compareAndSet') {
        const result = await this.compareAndSetEntry({
          resourceId: context.resource.id,
          name: args.name,
          expectedRevision: args.expectedRevision,
          value: args.value,
        });
        return result.ok
          ? { ok: true, entry: { name: result.entry.key, revision: result.entry.revision } }
          : { ok: false, currentRevision: result.currentRevision };
      }
      throw new ResourceError('SECRET_OPERATION_FAILED', `Unknown secret-store operation "${operation}".`);
    } catch (error) {
      throw toResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }

}

import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { TActorResource, TJson } from '@vibecanvas/service-db/model';
import { ActorResourceError, toActorResourceError } from './ActorResourceError';
import type { IActorResourceProvider, TActorResolvedResourceCall, TActorResourceProviderCreateArgs } from './resource-types';
import type { TActorResourceRequirement } from '../core/types';

const KEY_MAX_LENGTH = 1_024;
const LIST_MAX_LIMIT = 500;

function recordArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ActorResourceError('KV_OPERATION_FAILED', 'KV operation arguments must be an object.');
  }
  return args as Record<string, unknown>;
}

function keyArg(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > KEY_MAX_LENGTH) {
    throw new ActorResourceError('KV_KEY_INVALID', `KV keys must be non-blank strings no longer than ${KEY_MAX_LENGTH} characters.`);
  }
  return value;
}

function listTextArg(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > KEY_MAX_LENGTH) {
    throw new ActorResourceError('KV_KEY_INVALID', `${label} must be a string no longer than ${KEY_MAX_LENGTH} characters.`);
  }
  return value;
}

function listLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > LIST_MAX_LIMIT) {
    throw new ActorResourceError('KV_LIST_LIMIT_EXCEEDED', `KV list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
  }
  return value as number;
}

function expectedRevision(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ActorResourceError('KV_OPERATION_FAILED', 'Expected revision must be null or a positive integer.');
  }
  return value as number;
}

export class KvResource implements IActorResourceProvider {
  readonly kind = 'kv' as const;

  constructor(private readonly persistence: DbServiceTurso['actorResource']['keyValue']) {}

  async provision(_resource: TActorResource, _args: TActorResourceProviderCreateArgs): Promise<void> {}

  async delete(_resource: TActorResource): Promise<void> {}

  async reconcile(resource: TActorResource) {
    if (resource.kind !== this.kind) {
      return {
        status: 'error' as const,
        lastError: { code: 'RESOURCE_KIND_MISMATCH', message: 'KV resource catalog kind is invalid.' },
      };
    }
    return { status: 'ready' as const };
  }

  effect(operation: string, _requirement: TActorResourceRequirement): 'read' | 'write' | null {
    if (operation === 'get' || operation === 'has' || operation === 'list') return 'read';
    if (operation === 'set' || operation === 'delete' || operation === 'compareAndSet') return 'write';
    return null;
  }

  async dispatch(context: TActorResolvedResourceCall, operation: string, rawArgs: unknown): Promise<unknown> {
    try {
      if (context.resource.kind !== this.kind || context.requirement.kind !== this.kind) {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', 'KV resource kind does not match the resolved slot.');
      }
      const args = recordArgs(rawArgs);
      if (operation === 'get') {
        const entry = await this.persistence.get({ resourceId: context.resource.id, key: keyArg(args.key) });
        return entry ? { value: entry.value, revision: entry.revision } : null;
      }
      if (operation === 'has') {
        return this.persistence.has({ resourceId: context.resource.id, key: keyArg(args.key) });
      }
      if (operation === 'list') {
        const page = await this.persistence.list({
          resourceId: context.resource.id,
          prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'KV list prefix', true),
          cursor: args.cursor === undefined ? undefined : listTextArg(args.cursor, 'KV list cursor', false),
          limit: listLimit(args.limit),
        });
        return {
          items: page.entries.map((entry) => ({ key: entry.key, value: entry.value, revision: entry.revision })),
          ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
        };
      }
      if (operation === 'set') {
        const entry = await this.persistence.set({
          resourceId: context.resource.id,
          key: keyArg(args.key),
          value: args.value as TJson,
        });
        return { value: entry.value, revision: entry.revision };
      }
      if (operation === 'delete') {
        return this.persistence.delete({ resourceId: context.resource.id, key: keyArg(args.key) });
      }
      if (operation === 'compareAndSet') {
        const result = await this.persistence.compareAndSet({
          resourceId: context.resource.id,
          key: keyArg(args.key),
          expectedRevision: expectedRevision(args.expectedRevision),
          value: args.value as TJson,
        });
        return result.ok
          ? { ok: true, entry: { value: result.entry.value, revision: result.entry.revision } }
          : { ok: false, currentRevision: result.currentRevision };
      }
      throw new ActorResourceError('KV_OPERATION_FAILED', `Unknown KV operation "${operation}".`);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new ActorResourceError('KV_VALUE_INVALID', 'KV value is not JSON-compatible.');
      }
      throw toActorResourceError(error, 'KV_OPERATION_FAILED', 'KV operation failed.');
    }
  }
}

import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { TActorResource, TJson } from '@vibecanvas/service-db/model';
import { ActorResourceError, toActorResourceError } from './ActorResourceError';
import type { IActorResourceProvider, TActorResolvedResourceCall, TActorResourceProviderCreateArgs } from './resource-types';
import type { TActorResourceRequirement } from '../core/types';

const SECRET_NAME_MAX_LENGTH = 256;
const SECRET_VALUE_MAX_LENGTH = 1_048_576;
const LIST_MAX_LIMIT = 500;

function recordArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ActorResourceError('SECRET_OPERATION_FAILED', 'Secret-store operation arguments must be an object.');
  }
  return args as Record<string, unknown>;
}

function secretName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > SECRET_NAME_MAX_LENGTH) {
    throw new ActorResourceError('SECRET_NAME_INVALID', `Secret names must be non-blank strings no longer than ${SECRET_NAME_MAX_LENGTH} characters.`);
  }
  return value;
}

function secretValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > SECRET_VALUE_MAX_LENGTH) {
    throw new ActorResourceError('SECRET_VALUE_INVALID', `Secret values must be non-empty strings no longer than ${SECRET_VALUE_MAX_LENGTH} characters.`);
  }
  return value;
}

function listTextArg(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > SECRET_NAME_MAX_LENGTH) {
    throw new ActorResourceError('SECRET_NAME_INVALID', `${label} must be a string no longer than ${SECRET_NAME_MAX_LENGTH} characters.`);
  }
  return value;
}

function listLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > LIST_MAX_LIMIT) {
    throw new ActorResourceError('SECRET_OPERATION_FAILED', `Secret list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
  }
  return value as number;
}

function expectedRevision(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ActorResourceError('SECRET_OPERATION_FAILED', 'Expected revision must be null or a positive integer.');
  }
  return value as number;
}

export class SecretStoreResource implements IActorResourceProvider {
  readonly kind = 'secretStore' as const;

  constructor(private readonly persistence: DbServiceTurso['actorResource']['keyValue']) {}

  async provision(_resource: TActorResource, _args: TActorResourceProviderCreateArgs): Promise<void> {}

  async delete(_resource: TActorResource): Promise<void> {}

  async reconcile(resource: TActorResource) {
    if (resource.kind !== this.kind) {
      return {
        status: 'error' as const,
        lastError: { code: 'RESOURCE_KIND_MISMATCH', message: 'Secret-store resource catalog kind is invalid.' },
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
    const args = recordArgs(rawArgs);
    try {
      if (context.resource.kind !== this.kind || context.requirement.kind !== this.kind) {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', 'Secret-store resource kind does not match the resolved slot.');
      }
      if (operation === 'get') {
        const entry = await this.persistence.get({ resourceId: context.resource.id, key: secretName(args.name) });
        if (!entry) return null;
        if (typeof entry.value !== 'string') throw new ActorResourceError('SECRET_OPERATION_FAILED', 'Stored secret value has an invalid type.');
        return { value: entry.value, revision: entry.revision };
      }
      if (operation === 'has') {
        return this.persistence.has({ resourceId: context.resource.id, key: secretName(args.name) });
      }
      if (operation === 'list') {
        const page = await this.persistence.list({
          resourceId: context.resource.id,
          prefix: args.prefix === undefined ? undefined : listTextArg(args.prefix, 'Secret list prefix', true),
          cursor: args.cursor === undefined ? undefined : listTextArg(args.cursor, 'Secret list cursor', false),
          limit: listLimit(args.limit),
        });
        return {
          items: page.entries.map((entry) => ({
            name: entry.key,
            revision: entry.revision,
            createdAt: entry.created_at,
            updatedAt: entry.updated_at,
          })),
          ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
        };
      }
      if (operation === 'set') {
        const name = secretName(args.name);
        const entry = await this.persistence.set({ resourceId: context.resource.id, key: name, value: secretValue(args.value) });
        return { name, revision: entry.revision };
      }
      if (operation === 'delete') {
        return this.persistence.delete({ resourceId: context.resource.id, key: secretName(args.name) });
      }
      if (operation === 'compareAndSet') {
        const name = secretName(args.name);
        const result = await this.persistence.compareAndSet({
          resourceId: context.resource.id,
          key: name,
          expectedRevision: expectedRevision(args.expectedRevision),
          value: secretValue(args.value),
        });
        return result.ok
          ? { ok: true, entry: { name, revision: result.entry.revision } }
          : { ok: false, currentRevision: result.currentRevision };
      }
      throw new ActorResourceError('SECRET_OPERATION_FAILED', `Unknown secret-store operation "${operation}".`);
    } catch (error) {
      throw toActorResourceError(error, 'SECRET_OPERATION_FAILED', 'Secret-store operation failed.');
    }
  }
}

import { describe, expect, test } from 'bun:test';
import {
  apiCreateResource,
  apiListResources,
  apiRevealResourceSecret,
} from './api.resources';

describe('disabled Secret Store resource API', () => {
  test('filters retained Secret Store records from resource discovery', async () => {
    const list = apiListResources.callable({
      context: {
        resource: {
          async listResources() {
            return [
              { id: 'kv-1', kind: 'kv', name: 'KV', status: 'ready', lastError: null, createdAtSec: '0', updatedAtSec: '0' },
              { id: 'secret-1', kind: 'secretStore', name: 'Secrets', status: 'ready', lastError: null, createdAtSec: '0', updatedAtSec: '0' },
              { id: 'db-1', kind: 'db', name: 'DB', status: 'ready', lastError: null, createdAtSec: '0', updatedAtSec: '0' },
            ];
          },
        },
      } as never,
    });

    await expect(list({})).resolves.toEqual([
      expect.objectContaining({ id: 'kv-1', kind: 'kv' }),
      expect.objectContaining({ id: 'db-1', kind: 'db' }),
    ]);
    await expect(list({ kind: 'secretStore' })).resolves.toEqual([]);
  });

  test('rejects Secret Store creation without calling the retained service', async () => {
    let called = false;
    const create = apiCreateResource.callable({
      context: {
        resource: {
          async createResource() {
            called = true;
            throw new Error('must not run');
          },
        },
      } as never,
    });

    await expect(create({ kind: 'secretStore', name: 'Secrets' })).rejects.toMatchObject({
      code: 'RESOURCE_ERROR',
      data: { code: 'RESOURCE_KIND_DISABLED' },
    });
    expect(called).toBe(false);
  });

  test('rejects Secret Store reveal without calling the retained service', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        humanResourceSecret: {
          async revealSecret() {
            called = true;
            return { kind: 'secretStore' as const, name: 'unused', value: 'unused', revision: 1 };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: 'api-token' }))
      .rejects.toMatchObject({
        code: 'RESOURCE_ERROR',
        message: 'Secret Store resources are disabled.',
        data: { code: 'RESOURCE_KIND_DISABLED' },
      });
    expect(called).toBe(false);
  });

  test('rejects an invalid secret name before dispatch', async () => {
    const reveal = apiRevealResourceSecret.callable({ context: {} as never });
    await expect(reveal({ resourceId: 'secret-resource-1', name: '   ' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Input validation failed' });
  });
});

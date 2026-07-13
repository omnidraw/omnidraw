import { describe, expect, test } from 'bun:test';
import { fnActorResourceDataPage, fnJsonValuePreview } from '../src/resources/fn.resource-data';

describe('resource management data previews', () => {
  test('bounds large KV values without changing short JSON', () => {
    expect(fnJsonValuePreview({ theme: 'dark' })).toEqual({ preview: '{"theme":"dark"}', truncated: false });
    const large = fnJsonValuePreview('x'.repeat(8_192));
    expect(large.preview).toHaveLength(4_096);
    expect(large.truncated).toBe(true);
  });

  test('never returns secret values', () => {
    const page = fnActorResourceDataPage('secretStore', {
      entries: [{
        resource_id: 'secrets',
        key: 'token',
        value: 'must-not-leak',
        revision: 3,
        created_at: 'created',
        updated_at: 'updated',
      }],
      nextCursor: null,
    });
    expect(page).toEqual({
      kind: 'secretStore',
      entries: [{ name: 'token', revision: 3, createdAt: 'created', updatedAt: 'updated' }],
      nextCursor: null,
    });
    expect(JSON.stringify(page)).not.toContain('must-not-leak');
  });
});

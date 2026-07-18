import { describe, expect, test } from 'bun:test';
import { fnActorResourceDataMutationResult, fnActorResourceDataPage, fnJsonValuePreview } from '../src/resources/fn.resource-data';

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
        key: 'token',
        value: 'must-not-leak',
        revision: 3,
        createdAt: 'created',
        updatedAt: 'updated',
      }],
      nextCursor: null,
    });
    expect(page).toEqual({
      kind: 'secretStore',
      entries: [{ name: 'token', revision: 3, createdAt: 'created', updatedAt: 'updated' }],
      nextCursor: null,
    });
    expect(JSON.stringify(page)).not.toContain('must-not-leak');

    const mutation = fnActorResourceDataMutationResult('secretStore', {
      key: 'token',
      value: 'rotated-must-not-leak',
      revision: 4,
      createdAt: 'created',
      updatedAt: 'later',
    });
    expect(mutation).toEqual({
      kind: 'secretStore',
      entry: { name: 'token', revision: 4, createdAt: 'created', updatedAt: 'later' },
    });
    expect(JSON.stringify(mutation)).not.toContain('rotated-must-not-leak');
  });
});

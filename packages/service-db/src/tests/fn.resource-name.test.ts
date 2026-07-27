import { describe, expect, test } from 'bun:test';
import { fnNormalizeResourceName, fnResourceNameKey } from '../core/fn.resource-name';

describe('resource name normalization', () => {
  test('trims, normalizes Unicode, and folds case with one stable key', () => {
    expect(fnNormalizeResourceName('  Café  ')).toEqual({ ok: true, value: { name: 'Café', key: 'café' } });
    expect(fnResourceNameKey('CAFE\u0301')).toBe('café');
  });

  test('rejects empty, control-character, and overlong names', () => {
    expect(fnNormalizeResourceName('   ')).toMatchObject({ ok: false, code: 'RESOURCE_NAME_INVALID' });
    expect(fnNormalizeResourceName('bad\nname')).toMatchObject({ ok: false, code: 'RESOURCE_NAME_INVALID' });
    expect(fnNormalizeResourceName('x'.repeat(121))).toMatchObject({ ok: false, code: 'RESOURCE_NAME_INVALID' });
  });
});

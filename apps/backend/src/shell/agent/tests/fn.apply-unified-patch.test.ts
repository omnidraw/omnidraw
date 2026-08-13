import { describe, expect, test } from 'bun:test';
import { fnApplyUnifiedPatch } from '../tools/fn.apply-unified-patch';

describe('fnApplyUnifiedPatch', () => {
  test('applies exact multiple hunks while preserving the trailing newline', () => {
    const source = 'one\ntwo\nthree\nfour\n';
    const result = fnApplyUnifiedPatch(source, [
      '--- a/file',
      '+++ b/file',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+TWO',
      '@@ -4,1 +4,2 @@',
      ' four',
      '+five',
    ].join('\n'));
    expect(result).toEqual({ ok: true, content: 'one\nTWO\nthree\nfour\nfive\n' });
  });

  test('fails closed when context differs', () => {
    expect(fnApplyUnifiedPatch('one\n', '@@ -1,1 +1,1 @@\n-two\n+three')).toEqual({
      ok: false,
      message: 'Patch context did not match source line 1.',
    });
  });
});

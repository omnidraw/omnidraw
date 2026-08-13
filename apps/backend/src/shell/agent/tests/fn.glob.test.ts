import { describe, expect, test } from 'bun:test';
import { fnMatchesGlob } from '../workspace/fn.glob';

describe('bounded glob matching', () => {
  test('matches single and recursive wildcards without regular expressions', () => {
    expect(fnMatchesGlob('*.ts', 'main.ts')).toBe(true);
    expect(fnMatchesGlob('*.ts', 'widget/main.ts')).toBe(false);
    expect(fnMatchesGlob('**/*.ts', 'widget/main.ts')).toBe(true);
    expect(fnMatchesGlob('widget/ma?n.ts', 'widget/main.ts')).toBe(true);
    expect(fnMatchesGlob('widget/*.css', 'widget/main.ts')).toBe(false);
  });
});

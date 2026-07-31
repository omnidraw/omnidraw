import { describe, expect, test } from 'bun:test';
import {
  fnBoundedBuildOutput,
  fnRedactBuildOutput,
} from '../src/services/fn.redact-build-output';

describe('fnRedactBuildOutput', () => {
  test('removes injected host workspace paths while retaining useful relative context', () => {
    const root = '/private/tmp/omnidraw-build/npm-distribution-123';
    const output = [
      `at build (file://${root}/node_modules/vite/dist/node.js:10:2)`,
      'ui/main.ts:4:12: error: Expected expression',
    ].join('\n');

    expect(fnRedactBuildOutput(output, {}, [root])).toBe([
      'at build (file://[widget-workspace]/node_modules/vite/dist/node.js:10:2)',
      'ui/main.ts:4:12: error: Expected expression',
    ].join('\n'));
  });

  test('keeps the actionable error head when verbose stack output is truncated', () => {
    const output = `ui/main.ts:4: error: Expected expression\n${'stack\n'.repeat(2_000)}`;
    const bounded = fnBoundedBuildOutput(output, 400);

    expect(bounded).toStartWith('ui/main.ts:4: error: Expected expression');
    expect(bounded).toContain('build output truncated');
    expect(bounded.length).toBe(400);
  });
});

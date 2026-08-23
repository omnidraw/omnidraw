import { describe, expect, test } from 'bun:test';
import { fnDetectHostWorldEscapes } from '../sim/fn.detect-host-world-escapes';

describe('simulation host-world boundary', () => {
  test('detects direct ambient time, entropy, network, timers, promises, and runtimes', () => {
    const issues = fnDetectHostWorldEscapes([
      'const time = Date.now();',
      'const entropy = Math.random();',
      'const response = fetch(url);',
      'setTimeout(callback, 1);',
      'queueMicrotask(callback);',
      'const pending = new Promise(resolve => resolve());',
      'Effect.runPromise(program);',
    ].join('\n'));

    expect(issues.map((issue) => issue.capability)).toEqual([
      'wall-clock',
      'entropy',
      'network',
      'timer',
      'microtask',
      'native-promise',
      'default-effect-runtime',
    ]);
  });

  test('production simulation sources contain no direct host-world escapes', async () => {
    const simRoot = `${import.meta.dir}/../sim`;
    const glob = new Bun.Glob('**/*.ts');
    const failures: string[] = [];
    for await (const relativePath of glob.scan({ cwd: simRoot, onlyFiles: true })) {
      if (relativePath.endsWith('.test.ts')) continue;
      const source = await Bun.file(`${simRoot}/${relativePath}`).text();
      for (const issue of fnDetectHostWorldEscapes(source)) {
        failures.push(`${relativePath}:${issue.line} ${issue.capability}: ${issue.excerpt}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

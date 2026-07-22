import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('widget sandbox instruction budget', () => {
  test.each([
    [
      'infinite artifact',
      'fixtures/infinite-loop-mount.ts',
      'bounded infinite loop interrupted and realm torn down',
    ],
    [
      'outstanding and recursive timer storms',
      'fixtures/async-timer-bounds-mount.ts',
      'timer caps and cumulative execution budget bounded work and teardown cleared every timer',
    ],
  ])('bounds %s in a kill-bounded subprocess', async (_label, fixturePath, marker) => {
    const fixture = resolve(
      import.meta.dirname,
      fixturePath,
    );
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn('bun', ['run', fixture], {
        cwd: resolve(import.meta.dirname, '../../../..'),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Infinite-loop sandbox fixture exceeded the subprocess bound.\n${output}`));
      }, 50_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        done({ code, output });
      });
    });

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain(marker);
  }, 60_000);
});

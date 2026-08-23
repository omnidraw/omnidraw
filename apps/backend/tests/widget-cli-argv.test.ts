import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWidgetSubcommandArgs } from '../src/shell/cli/cmds/widget-argv';
import {
  WIDGET_SUBCOMMAND_HELP,
  writeScreenshotAtomically,
} from '../src/shell/cli/cmds/cmd.widget';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('widget CLI argv', () => {
  test('documents every accepted common option for every subcommand', () => {
    for (const help of Object.values(WIDGET_SUBCOMMAND_HELP)) {
      expect(help).toContain('--port <number>');
      expect(help).toContain('--data-dir <path>');
      expect(help).toContain('--json');
      expect(help).toContain('--help, -h');
    }
  });

  test('requires one exact resolver selector', async () => {
    await expect(parseWidgetSubcommandArgs('resolve', [
      '--widget-key', 'clock', '--name', 'Clock',
    ], () => 'operation')).rejects.toMatchObject({ code: 'WIDGET_SELECTOR_REQUIRED' });
    await expect(parseWidgetSubcommandArgs('resolve', [
      '--name', 'Clock',
    ], () => 'operation')).resolves.toEqual({
      subcommand: 'resolve',
      input: { name: 'Clock' },
    });
  });

  test('parses exact inspection fences, viewport, and bounded @file actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-cli-'));
    roots.push(root);
    const actionsPath = join(root, 'actions.json');
    await writeFile(actionsPath, JSON.stringify([
      { type: 'click', target: { by: 'role', role: 'button', name: 'Run' } },
      { type: 'waitFrames', count: 2 },
    ]));

    const parsed = await parseWidgetSubcommandArgs('inspect', [
      '--widget-key', 'clock',
      '--mode', 'preview',
      '--expected-draft-digest', SHA_A,
      '--expected-generation', '7',
      '--expected-build-identity', SHA_B,
      '--viewport', '640x480@2',
      '--actions', `@${actionsPath}`,
      '--screenshot', 'clock.png',
    ], () => 'operation-1');

    expect(parsed).toMatchObject({
      subcommand: 'inspect',
      screenshotPath: 'clock.png',
      overwrite: false,
      input: {
        widgetKey: 'clock',
        mode: 'preview',
        expectedDraftDigestSha256: SHA_A,
        expectedAcceptedGeneration: 7,
        expectedBuildIdentity: SHA_B,
        viewport: { width: 640, height: 480, deviceScaleFactor: 2 },
        includeScreenshot: true,
        operationId: 'operation-1',
        actions: [{ type: 'click' }, { type: 'waitFrames', count: 2 }],
      },
    });
  });

  test('rejects missing generation and unknown flags before RPC connection', async () => {
    await expect(parseWidgetSubcommandArgs('inspect', [
      '--widget-key', 'clock',
      '--expected-draft-digest', SHA_A,
      '--expected-build-identity', SHA_B,
    ], () => 'operation')).rejects.toMatchObject({ code: 'WIDGET_GENERATION_REQUIRED' });
    await expect(parseWidgetSubcommandArgs('validate', [
      '--widget-key', 'clock', '--force',
    ], () => 'operation')).rejects.toMatchObject({ code: 'WIDGET_ARGUMENT_INVALID' });
  });

  test('writes screenshot bytes atomically and requires explicit overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-screenshot-'));
    roots.push(root);
    const path = join(root, 'evidence.png');
    await writeFile(path, new Uint8Array([1]));

    await expect(writeScreenshotAtomically({
      cwd: root,
      path,
      overwrite: false,
      bytes: new Uint8Array([2, 3]),
    })).rejects.toMatchObject({ code: 'WIDGET_SCREENSHOT_EXISTS' });
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array([1]));
    expect((await readdir(root)).filter((entry) => entry.includes('.tmp'))).toEqual([]);

    await expect(writeScreenshotAtomically({
      cwd: root,
      path,
      overwrite: true,
      bytes: new Uint8Array([2, 3]),
    })).resolves.toBe(path);
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array([2, 3]));
  });
});

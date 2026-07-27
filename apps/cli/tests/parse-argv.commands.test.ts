import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCliConfig } from '../src/build-config';
import { parseCliArgv } from '../src/parse-argv';

describe('parseCliArgv command resolution', () => {
  test('defaults to serve when no subcommand is provided', () => {
    const parsed = parseCliArgv(['bun', 'run']);

    expect(parsed.command).toBe('serve');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.port).toBeUndefined();
  });

  test('treats numeric third positional as serve port', () => {
    const parsed = parseCliArgv(['bun', 'run', '4123']);

    expect(parsed.command).toBe('serve');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.port).toBe(4123);
  });

  test('resolves known commands', () => {
    expect(parseCliArgv(['bun', 'run', 'serve'])).toMatchObject({ command: 'serve', subcommand: undefined });
    expect(parseCliArgv(['bun', 'run', 'canvas'])).toMatchObject({ command: 'canvas', subcommand: undefined });
    expect(parseCliArgv(['bun', 'run', 'canvas', 'query'])).toMatchObject({ command: 'canvas', subcommand: 'query' });
    expect(parseCliArgv(['bun', 'run', 'upgrade'])).toMatchObject({ command: 'upgrade', subcommand: undefined });
    expect(parseCliArgv(['bun', 'run', 'uninstall'])).toMatchObject({ command: 'uninstall', subcommand: undefined });
  });

  test('keeps removed top-level canvas aliases unknown', () => {
    expect(parseCliArgv(['bun', 'run', 'query'])).toMatchObject({ command: 'unknown', subcommand: 'query' });
    expect(parseCliArgv(['bun', 'run', 'list'])).toMatchObject({ command: 'unknown', subcommand: 'list' });
  });

  test('treats leading flag as serve command', () => {
    const parsed = parseCliArgv(['bun', 'run', '--help']);

    expect(parsed.command).toBe('serve');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.helpRequested).toBe(true);
  });

  test('returns unknown for unsupported commands', () => {
    const parsed = parseCliArgv(['bun', 'run', 'deploy']);

    expect(parsed.command).toBe('unknown');
    expect(parsed.subcommand).toBe('deploy');
  });

  test('carries parsed options into buildCliConfig', () => {
    const parsed = parseCliArgv(['bun', 'run', 'serve', '--data-dir', './tmp/vibecanvas-home', '--json']);
    const config = buildCliConfig(parsed);

    expect(config.command).toBe('serve');
    expect(config.subcommand).toBeUndefined();
    expect(config.home.homeDir).toBe(resolve(process.cwd(), './tmp/vibecanvas-home'));
    expect(config.home.mainDbPath).toBe(resolve(process.cwd(), './tmp/vibecanvas-home/main.db'));
    expect(config.subcommandOptions).toMatchObject({
      json: true,
    });
  });

  test('does not mistake a later positional for the top-level command', () => {
    const parsed = parseCliArgv(['bun', 'run', 'serve', '--data-dir', './tmp/vibecanvas-home', 'query']);

    expect(parsed.command).toBe('serve');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.dataDir).toBe('./tmp/vibecanvas-home');
  });

  test('configuration construction resolves paths without touching disk', () => {
    const homeDir = join(tmpdir(), `vibecanvas-config-${crypto.randomUUID()}`);
    const parsed = parseCliArgv(['bun', 'run', 'serve', '--data-dir', homeDir]);

    expect(existsSync(homeDir)).toBe(false);
    const config = buildCliConfig(parsed);

    expect(config.home.homeDir).toBe(homeDir);
    expect(existsSync(homeDir)).toBe(false);
  });
});

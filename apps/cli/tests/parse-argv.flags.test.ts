import { describe, expect, test } from 'bun:test';
import { parseCliArgv } from '../src/parse-argv';

describe('parseCliArgv flag parsing', () => {
  test('reads explicit option values', () => {
    const parsed = parseCliArgv([
      'bun',
      'run',
      'serve',
      '--port',
      '3001',
      '--data-dir',
      './tmp/omnidraw-home',
    ]);

    expect(parsed.port).toBe(3001);
    expect(parsed.dataDir).toBe('./tmp/omnidraw-home');
  });

  test('reads help and version short flags', () => {
    const parsed = parseCliArgv(['bun', 'run', 'serve', '-h', '-v']);

    expect(parsed.helpRequested).toBe(true);
    expect(parsed.versionRequested).toBe(true);
  });

  test('prefers --port over numeric positional command port', () => {
    const parsed = parseCliArgv(['bun', 'run', '4000', '--port', '5000']);

    expect(parsed.command).toBe('serve');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.port).toBe(5000);
  });

  test('retains json and dry-run generic command options', () => {
    const parsed = parseCliArgv(['bun', 'run', 'serve', '--json', '--dry-run']);

    expect(parsed.subcommandOptions).toMatchObject({ json: true, dryRun: true });
  });

  test('keeps the canvas subcommand while command-specific flags remain in raw argv', () => {
    const parsed = parseCliArgv(['bun', 'run', 'canvas', 'query', '--canvas-name', 'ok', '--json']);

    expect(parsed.command).toBe('canvas');
    expect(parsed.subcommand).toBe('query');
    expect(parsed.rawArgv.slice(4)).toEqual(['--canvas-name', 'ok', '--json']);
    expect(parsed.subcommandOptions).toMatchObject({ json: true });
  });

  test('throws on invalid ports', () => {
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', '0'])).toThrow('Invalid port: 0');
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', '70000'])).toThrow('Invalid port: 70000');
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', 'abc'])).toThrow('Invalid port: abc');
  });

  test('rejects option tokens as --data-dir values', () => {
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--data-dir', '--json'])).toThrow("--data-dir requires a path value. Received option token '--json' instead.");
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--data-dir'])).toThrow('--data-dir requires a path value.');
  });

  test('rejects the removed database-file override', () => {
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--db', './tmp/dev.sqlite'])).toThrow('--db is no longer supported. Use --data-dir');
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--db=./tmp/dev.sqlite'])).toThrow('--db is no longer supported. Use --data-dir');
  });
});

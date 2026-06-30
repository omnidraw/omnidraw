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
      '--db',
      './tmp/dev.sqlite',
      '--upgrade',
      '1.2.3',
    ]);

    expect(parsed.port).toBe(3001);
    expect(parsed.dbPath).toBe('./tmp/dev.sqlite');
    expect(parsed.upgradeTarget).toBe('1.2.3');
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

  test('parses json as the only retained generic command option', () => {
    const parsed = parseCliArgv(['bun', 'run', 'serve', '--json']);

    expect(parsed.subcommandOptions).toMatchObject({ json: true });
  });

  test('treats removed canvas flags as generic unknown-command arguments', () => {
    const parsed = parseCliArgv(['bun', 'run', 'canvas', 'query', '--canvas-name', 'ok', '--json']);

    expect(parsed.command).toBe('unknown');
    expect(parsed.subcommand).toBe('canvas');
    expect(parsed.subcommandOptions).toMatchObject({ json: true });
  });

  test('throws on invalid ports', () => {
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', '0'])).toThrow('Invalid port: 0');
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', '70000'])).toThrow('Invalid port: 70000');
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--port', 'abc'])).toThrow('Invalid port: abc');
  });

  test('rejects option tokens as --db values', () => {
    expect(() => parseCliArgv(['bun', 'run', 'serve', '--db', '--json'])).toThrow("--db requires a path value. Received option token '--json' instead.");
  });
});

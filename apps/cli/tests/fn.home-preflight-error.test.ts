import { describe, expect, test } from 'bun:test';
import { fnBuildHomePreflightError } from '../src/fn.home-preflight-error';

const HOME_DIR = '/tmp/vibecanvas-home';

describe('fnBuildHomePreflightError', () => {
  test('surfaces a nested multiprocess WAL conflict with lock-specific guidance', () => {
    const cause = new Error(
      'Database is already open with experimental multiprocess WAL in another process',
    );
    const error = new Error(
      `Refusing to open Vibecanvas database after a read-only preflight failed: ${HOME_DIR}/main.db`,
      { cause },
    );

    expect(fnBuildHomePreflightError({ homeDir: HOME_DIR, error })).toEqual({
      ok: false,
      command: 'serve',
      code: 'VIBECANVAS_HOME_PREFLIGHT_FAILED',
      message: `Refusing selected Vibecanvas home '${HOME_DIR}': ${cause.message}`,
      hint: 'The database is already open or locked by another process. The selected home was not modified.',
      next: 'Stop the other process using this Vibecanvas home, or retry with --data-dir <separate-path>.',
    });
  });

  test('keeps archive guidance for unknown schema refusals without legacy actor wording', () => {
    const result = fnBuildHomePreflightError({
      homeDir: HOME_DIR,
      error: new Error('Refusing to open Vibecanvas database: found a non-empty unknown database.'),
    });

    expect(result.hint).toBe(
      'Unknown or incompatible database layouts are unsupported. The selected home was not modified.',
    );
    expect(result.next).toBe(
      `Archive or move '${HOME_DIR}' manually, or retry with --data-dir <fresh-path>.`,
    );
    expect(result.hint).not.toContain('locked');
    expect(result.hint).not.toContain('Actor-era');
  });

  test('uses the deepest cause in fallback output', () => {
    const reason = 'TLS handshake rejected by the database endpoint';
    const result = fnBuildHomePreflightError({
      homeDir: HOME_DIR,
      error: new Error('Database preflight failed', {
        cause: new Error(reason),
      }),
    });

    expect(result.message).toContain(reason);
    expect(result.hint).toContain(reason);
    expect(result.next).toContain('--data-dir <separate-path>');
    expect(result.hint).not.toContain('Actor-era');
  });
});

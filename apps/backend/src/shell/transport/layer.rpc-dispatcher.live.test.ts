import { describe, expect, test } from 'bun:test';
import { ProcedureError } from '#backend/shell/api/procedure';
import {
  assertIdempotencyKey,
  resumeInput,
} from './layer.rpc-dispatcher.live';

describe('private RPC recovery metadata projection', () => {
  test('projects the generic cursor into every domain-specific stream input', () => {
    const cases = [
      ['canvas.events', 'afterRevision'],
      ['widget.catalog.events', 'afterGeneration'],
      ['widget.runtime.state.events', 'afterVersion'],
      ['agent.events', 'afterSequence'],
      ['db.events', 'afterSequence'],
      ['notification.events', 'afterSequence'],
    ] as const;

    for (const [path, cursorKey] of cases) {
      expect(resumeInput(path, { scope: 'current' }, 17)).toEqual({
        scope: 'current',
        [cursorKey]: 17,
      });
    }
  });

  test('preserves explicit cursors and inputs that cannot accept cursor metadata', () => {
    const explicit = { afterSequence: 9 };
    expect(resumeInput('agent.events', explicit, 17)).toBe(explicit);
    expect(resumeInput('agent.events', {}, undefined)).toEqual({});
    expect(resumeInput('agent.events', null, 17)).toBeNull();
    expect(resumeInput('agent.events', ['scope'], 17)).toEqual(['scope']);
  });
});

describe('private RPC idempotency admission', () => {
  test('accepts an omitted or matching Canvas command key', () => {
    expect(() => assertIdempotencyKey(
      'canvas.execute',
      { commandId: 'command-1' },
      undefined,
    )).not.toThrow();
    expect(() => assertIdempotencyKey(
      'canvas.execute',
      { commandId: 'command-1' },
      'command-1',
    )).not.toThrow();
  });

  test('rejects a mismatched Canvas command key and ignores keys on other operations', () => {
    expect(() => assertIdempotencyKey(
      'canvas.execute',
      { commandId: 'command-1' },
      'command-2',
    )).toThrow(ProcedureError);
    expect(() => assertIdempotencyKey(
      'resource.resources.create',
      { name: 'notes' },
      'unsupported-but-transport-valid',
    )).not.toThrow();
  });
});

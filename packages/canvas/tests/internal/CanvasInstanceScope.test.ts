import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import { CanvasInstanceScope } from '../../src/internal/CanvasInstanceScope';

describe('CanvasInstanceScope', () => {
  it('releases partial acquisition in reverse order', async () => {
    const lifetime = new CanvasInstanceScope();
    const events: string[] = [];
    const program = Effect.gen(function*() {
      yield* lifetime.acquireSync(
        () => { events.push('acquire:first'); return 'first'; },
        () => { events.push('release:first'); },
      );
      yield* lifetime.acquireSync(
        () => { events.push('acquire:second'); return 'second'; },
        () => { events.push('release:second'); },
      );
      return yield* Effect.fail(new Error('third acquisition failed'));
    });

    const exit = await Effect.runPromise(Effect.exit(program));
    await Effect.runPromise(lifetime.close(exit));

    expect(events).toEqual([
      'acquire:first',
      'acquire:second',
      'release:second',
      'release:first',
    ]);
  });

  it('continues teardown and aggregates cleanup failures once', async () => {
    const lifetime = new CanvasInstanceScope();
    const events: string[] = [];
    await Effect.runPromise(lifetime.acquireSync(
      () => 'first',
      () => { events.push('release:first'); throw new Error('first failed'); },
    ));
    await Effect.runPromise(lifetime.acquireSync(
      () => 'second',
      async () => { events.push('release:second'); throw new Error('second failed'); },
    ));

    const error = await Effect.runPromise(lifetime.close()).then(
      () => null,
      (cause) => cause,
    );
    await Effect.runPromise(lifetime.close(Exit.void));

    expect(events).toEqual(['release:second', 'release:first']);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
  });
});

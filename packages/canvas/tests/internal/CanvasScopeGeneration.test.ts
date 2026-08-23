import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';
import { CanvasScopeGeneration } from '../../src/internal/CanvasScopeGeneration';

describe('CanvasScopeGeneration', () => {
  test('releases each replaced generation and repeated disposal is inert', () => {
    const releases: string[] = [];
    let generation = 0;
    const owner = new CanvasScopeGeneration(
      () => Effect.acquireRelease(
        Effect.sync(() => `generation-${++generation}`),
        (value) => Effect.sync(() => { releases.push(value); }),
      ).pipe(Effect.asVoid),
      vi.fn(),
    );

    owner.replace(true);
    owner.replace(true);
    owner.replace(false);
    owner.dispose();
    owner.dispose();

    expect(releases).toEqual(['generation-1', 'generation-2']);
    expect(generation).toBe(2);
  });
});

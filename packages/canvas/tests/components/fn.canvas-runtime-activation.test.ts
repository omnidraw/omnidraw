import { describe, expect, test } from 'vitest';
import {
  fnCanvasRuntimeActivation,
} from '../../src/components/fn.canvas-runtime-activation';

describe('fnCanvasRuntimeActivation', () => {
  test('does not consume the source key before the host container is ready', () => {
    const beforeMount = fnCanvasRuntimeActivation({
      containerReady: false,
      nextKey: 'tenant-a:canvas-a',
      previousKey: null,
    });
    const afterMount = fnCanvasRuntimeActivation({
      containerReady: true,
      nextKey: 'tenant-a:canvas-a',
      previousKey: beforeMount.key,
    });

    expect(beforeMount).toEqual({
      key: null,
      shouldReplace: false,
    });
    expect(afterMount).toEqual({
      key: 'tenant-a:canvas-a',
      shouldReplace: true,
    });
  });

  test('replaces only when the ready source changes', () => {
    expect(fnCanvasRuntimeActivation({
      containerReady: true,
      nextKey: 'tenant-a:canvas-a',
      previousKey: 'tenant-a:canvas-a',
    })).toEqual({
      key: 'tenant-a:canvas-a',
      shouldReplace: false,
    });

    expect(fnCanvasRuntimeActivation({
      containerReady: true,
      nextKey: 'tenant-a:canvas-b',
      previousKey: 'tenant-a:canvas-a',
    })).toEqual({
      key: 'tenant-a:canvas-b',
      shouldReplace: true,
    });
  });
});

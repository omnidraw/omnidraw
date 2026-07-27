import { describe, expect, test, vi } from 'vitest';
import { createWidgetPlacementCoordinator } from '../../src/widget-placement/WidgetPlacementCoordinator';

describe('WidgetPlacementCoordinator', () => {
  test('publishes active-canvas availability changes', () => {
    const coordinator = createWidgetPlacementCoordinator();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);
    const unregister = coordinator.register({
      beginPointerSession: () => true,
      addToCanvas: async () => undefined,
    });

    expect(listener.mock.calls).toEqual([[false], [true]]);
    expect(coordinator.available()).toBe(true);

    unregister();
    expect(listener.mock.calls).toEqual([[false], [true], [false]]);
    expect(coordinator.available()).toBe(false);

    unsubscribe();
  });
});

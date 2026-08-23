import { describe, expect, test, vi } from 'vitest';
import { createWidgetPlacementCoordinator } from '../../../src/shell/framework/feature/widget-placement/WidgetPlacementCoordinator';

describe('WidgetPlacementCoordinator', () => {
  test('publishes active-canvas availability changes', () => {
    const coordinator = createWidgetPlacementCoordinator();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);
    const unregister = coordinator.register({
      isAvailable: () => true,
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

  test('selects the newest connected Canvas and ignores stale remount ports', async () => {
    const coordinator = createWidgetPlacementCoordinator();
    let oldLive = true;
    let nextLive = true;
    const oldBegin = vi.fn(() => true);
    const nextBegin = vi.fn(() => true);
    const oldAdd = vi.fn(async () => undefined);
    const nextAdd = vi.fn(async () => undefined);
    const unregisterOld = coordinator.register({
      isAvailable: () => oldLive,
      beginPointerSession: oldBegin,
      addToCanvas: oldAdd,
    });
    const unregisterNext = coordinator.register({
      isAvailable: () => nextLive,
      beginPointerSession: nextBegin,
      addToCanvas: nextAdd,
    });
    const event = {} as PointerEvent;

    expect(coordinator.beginPointerSession({
      reference: { source: 'draft', widgetKey: 'test', catalogGeneration: 1 },
      bounds: { width: 240, height: 160 },
      label: 'Test',
      event,
    })).toBe(true);
    expect(nextBegin).toHaveBeenCalledTimes(1);
    expect(oldBegin).not.toHaveBeenCalled();

    nextLive = false;
    await coordinator.addToCanvas({
      reference: { source: 'draft', widgetKey: 'test', catalogGeneration: 1 },
      bounds: { width: 240, height: 160 },
      label: 'Test',
    });
    expect(oldAdd).toHaveBeenCalledTimes(1);
    expect(nextAdd).not.toHaveBeenCalled();

    // A late old-host cleanup must not retire the newer live registration.
    nextLive = true;
    unregisterOld();
    expect(coordinator.available()).toBe(true);
    expect(coordinator.beginPointerSession({
      reference: { source: 'draft', widgetKey: 'test', catalogGeneration: 1 },
      bounds: { width: 240, height: 160 },
      label: 'Test',
      event,
    })).toBe(true);
    expect(nextBegin).toHaveBeenCalledTimes(2);
    unregisterNext();
    expect(coordinator.available()).toBe(false);
  });
});

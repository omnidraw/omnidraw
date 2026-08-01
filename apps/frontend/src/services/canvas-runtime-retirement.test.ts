import { describe, expect, test } from 'vitest';
import {
  createFrontendCanvasRuntimeRetirementCoordinator,
} from './canvas-runtime-retirement';

describe('frontend canvas runtime retirement coordinator', () => {
  test('retires every registered runtime and forgets completed registrations', async () => {
    const coordinator = createFrontendCanvasRuntimeRetirementCoordinator();
    const calls: string[] = [];
    coordinator.registration.register(async () => { calls.push('canvas-a'); });
    coordinator.registration.register(async () => { calls.push('canvas-b'); });

    await coordinator.retireAll();
    await coordinator.retireAll();

    expect(calls).toEqual(['canvas-a', 'canvas-b']);
  });

  test('does not retire a released registration', async () => {
    const coordinator = createFrontendCanvasRuntimeRetirementCoordinator();
    const calls: string[] = [];
    const release = coordinator.registration.register(async () => {
      calls.push('released');
    });

    release();
    release();
    await coordinator.retireAll();

    expect(calls).toEqual([]);
  });

  test('drains a runtime registered while another retirement is deferred', async () => {
    const coordinator = createFrontendCanvasRuntimeRetirementCoordinator();
    let releaseCanvasA!: () => void;
    let markCanvasAStarted!: () => void;
    const canvasABlocked = new Promise<void>((resolve) => {
      releaseCanvasA = resolve;
    });
    const canvasAStarted = new Promise<void>((resolve) => {
      markCanvasAStarted = resolve;
    });
    const calls: string[] = [];
    coordinator.registration.register(async () => {
      calls.push('canvas-a:start');
      markCanvasAStarted();
      await canvasABlocked;
      calls.push('canvas-a:complete');
    });

    const retiring = coordinator.retireAll();
    await canvasAStarted;
    coordinator.registration.register(async () => {
      calls.push('canvas-b');
    });
    expect(calls).toEqual(['canvas-a:start']);

    releaseCanvasA();
    await retiring;

    expect(calls).toEqual([
      'canvas-a:start',
      'canvas-a:complete',
      'canvas-b',
    ]);
  });
});

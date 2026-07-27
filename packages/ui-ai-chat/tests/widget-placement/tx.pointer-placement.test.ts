import { afterEach, describe, expect, test, vi } from 'vitest';
import { txCreateWidgetPointerPlacement } from '../../src/widget-placement/tx.pointer-placement';

function pointerEvent(
  type: string,
  values: Readonly<{
    pointerId: number;
    clientX: number;
    clientY: number;
    button?: number;
    isPrimary?: boolean;
  }>,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: values.button ?? 0,
    clientX: values.clientX,
    clientY: values.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    isPrimary: { value: values.isPrimary ?? true },
  });
  return event as PointerEvent;
}

function fixture() {
  const replace = vi.fn();
  const clear = vi.fn();
  const destroy = vi.fn();
  const createOwner = vi.fn(() => ({ replace, clear, destroy }));
  const commit = vi.fn(async () => undefined);
  const onError = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: 500,
    bottom: 400,
    left: 0,
    width: 500,
    height: 400,
    toJSON: () => undefined,
  });
  const placement = txCreateWidgetPointerPlacement({
    camera: {
      clientToViewport: (point: { x: number; y: number }) => point,
      viewportToWorld: (point: { x: number; y: number }) => point,
      visibleWorldBounds: () => ({
        minX: 0,
        minY: 0,
        maxX: 500,
        maxY: 400,
      }),
    } as never,
    container,
    document,
    transients: { createOwner } as never,
    commit,
    onError,
  }, {
    dragThreshold: 6,
    ownerId: 'test:widget-placement',
  });
  const request = {
    reference: {
      source: 'published' as const,
      name: 'published:definition',
      revision: 'revision',
    },
    bounds: { width: 120, height: 80 },
    label: 'Counter',
    event: pointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    }),
    onDragStart,
    onDragEnd,
  };
  return {
    placement,
    request,
    replace,
    clear,
    destroy,
    createOwner,
    commit,
    onError,
    onDragStart,
    onDragEnd,
  };
}

afterEach(() => {
  document.body.style.userSelect = '';
});

describe('widget pointer placement transaction', () => {
  test('previews and commits one widget at its clamped drop position', async () => {
    const value = fixture();
    expect(value.placement.beginPointerSession(value.request)).toBe(true);

    document.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1,
      clientX: 24,
      clientY: 23,
    }));
    expect(value.onDragStart).not.toHaveBeenCalled();

    document.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1,
      clientX: 490,
      clientY: 390,
    }));
    expect(value.onDragStart).toHaveBeenCalledOnce();
    expect(value.replace).toHaveBeenCalledWith(expect.objectContaining({
      band: 'world-overlay',
      hitTest: 'none',
      nodes: [expect.objectContaining({
        kind: 'widget-frame',
        transform: expect.objectContaining({
          position: { x: 380, y: 320 },
        }),
      })],
    }));

    document.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 1,
      clientX: 490,
      clientY: 390,
    }));
    await vi.waitFor(() => expect(value.commit).toHaveBeenCalledOnce());
    expect(value.commit).toHaveBeenCalledWith({
      reference: value.request.reference,
      bounds: value.request.bounds,
      label: 'Counter',
      position: { x: 380, y: 320 },
    });
    expect(value.onDragEnd).toHaveBeenCalledOnce();
    expect(value.clear).toHaveBeenCalled();

    value.placement.destroy();
    expect(value.destroy).toHaveBeenCalledOnce();
  });

  test('does not commit when the pointer is released outside the canvas', () => {
    const value = fixture();
    value.placement.beginPointerSession(value.request);
    document.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1,
      clientX: 80,
      clientY: 80,
    }));
    document.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 1,
      clientX: 600,
      clientY: 500,
    }));

    expect(value.commit).not.toHaveBeenCalled();
    expect(value.onDragStart).toHaveBeenCalledOnce();
    expect(value.onDragEnd).toHaveBeenCalledOnce();
    value.placement.destroy();
  });

  test('places the keyboard action at the viewport center', async () => {
    const value = fixture();
    await value.placement.addToCanvas({
      reference: value.request.reference,
      bounds: value.request.bounds,
      label: value.request.label,
    });

    expect(value.commit).toHaveBeenCalledWith({
      reference: value.request.reference,
      bounds: value.request.bounds,
      label: 'Counter',
      position: { x: 190, y: 160 },
    });
    value.placement.destroy();
  });
});

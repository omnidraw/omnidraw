import type { TPortalGeometry } from '@omnidraw/cangine';
import { describe, expect, test } from 'vitest';
import {
  fxWidgetCapsuleViewport,
} from '../../src/canvas-extension/fx.capsule-portal-viewport';

function geometry(
  zoom: number,
  devicePixelRatio: number,
): TPortalGeometry {
  return {
    nodeId: 'widget-a',
    viewportMatrix: [
      zoom, 0, 0,
      0, zoom, 0,
      0, 0, 1,
    ],
    viewportBounds: {
      minX: 0,
      minY: 0,
      maxX: 552 * zoom,
      maxY: 874 * zoom,
    },
    visibleWorldBounds: {
      minX: 0,
      minY: 0,
      maxX: 2_000,
      maxY: 2_000,
    },
    clipped: true,
    interactive: true,
    devicePixelRatio,
  };
}

function hostSize(
  host: HTMLElement,
  width: number,
  height: number,
): void {
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
}

describe('fxWidgetCapsuleViewport', () => {
  test('keeps guest layout intrinsic across zoom and changes it on host resize', () => {
    const host = document.createElement('div');
    hostSize(host, 552, 874);
    const portal = {
      readClientWidth: (element: HTMLElement) => element.clientWidth,
      readClientHeight: (element: HTMLElement) => element.clientHeight,
    };

    const zoomedOut = fxWidgetCapsuleViewport(portal, {
      host,
      geometry: geometry(0.75, 2),
      visible: true,
    });
    const zoomedIn = fxWidgetCapsuleViewport(portal, {
      host,
      geometry: geometry(1.5, 2),
      visible: true,
    });

    expect(zoomedOut).toMatchObject({
      width: 552,
      height: 874,
      scale: 2,
      visibility: 'visible',
    });
    expect(zoomedIn).toEqual(zoomedOut);

    hostSize(host, 720, 480);
    expect(fxWidgetCapsuleViewport(portal, {
      host,
      geometry: geometry(1.5, 2),
      visible: true,
    })).toMatchObject({
      width: 720,
      height: 480,
      scale: 2,
    });
  });

  test('maps visibility and tolerates mount ordering without host or geometry', () => {
    const portal = {
      readClientWidth: (element: HTMLElement) => element.clientWidth,
      readClientHeight: (element: HTMLElement) => element.clientHeight,
    };

    expect(fxWidgetCapsuleViewport(portal, {
      host: null,
      geometry: null,
      visible: false,
    })).toEqual({
      width: 0,
      height: 0,
      scale: 1,
      visibility: 'hidden',
      distance: 0,
      priority: 0,
      occlusion: 0,
    });
  });
});

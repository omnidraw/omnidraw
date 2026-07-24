// @vitest-environment jsdom
import type { TPortalGeometry } from "@omnidraw/cangine";
import { describe, expect, it, vi } from "vitest";
import type {
  TCanvasPortalViewportState,
  TCanvasProjectedPortal,
} from "../../../src/engine/typed";
import {
  PortalContentBridge,
} from "../../../src/engine/projection-runtime/PortalContentBridge";

const PORTAL: TCanvasProjectedPortal = {
  portalId: "portal:widget",
  nodeId: "widget:render",
  elementId: "widget",
  scaleMode: "world",
  interactive: true,
  suspendWhenOffscreen: true,
  content: {
    type: "ui-widget",
    kind: "weather",
  },
};

const GEOMETRY: TPortalGeometry = {
  nodeId: PORTAL.nodeId,
  viewportMatrix: [1.5, 0, 0, 0, 1.5, 0, 0, 0, 1],
  viewportBounds: {
    minX: 900,
    minY: 100,
    maxX: 1_100,
    maxY: 300,
  },
  visibleWorldBounds: {
    minX: 0,
    minY: 0,
    maxX: 500,
    maxY: 400,
  },
  clipped: true,
  interactive: true,
  devicePixelRatio: 2,
};

describe("PortalContentBridge viewport lifecycle", () => {
  it("forwards authoritative engine geometry and cleans up idempotently", async () => {
    const viewports: TCanvasPortalViewportState[] = [];
    const disposeContent = vi.fn();
    const bridge = new PortalContentBridge({
      readViewportSize: () => ({ width: 1_000, height: 800 }),
      mountContent: (args) => {
        expect(args.initialViewport.visible).toBe(false);
        args.onViewportUpdate((viewport) => {
          viewports.push(viewport);
        });
        return disposeContent;
      },
    });
    const stage = bridge.stage([PORTAL]);
    await stage.prepare();
    await stage.commit();
    const owned = bridge.ownedPortal(PORTAL);
    const host = document.createElement("div");
    host.style.width = "320px";
    host.style.height = "180px";
    const cleanup = await owned.mount({
      portalId: PORTAL.portalId,
      host,
    });

    owned.onVisibilityChange?.(true);
    owned.onGeometryChange?.(GEOMETRY);
    expect(viewports.at(-1)).toEqual({
      width: 320,
      height: 180,
      scale: 3,
      visible: true,
      distance: 0,
      occlusion: 0.5,
      interactive: true,
    });

    cleanup?.();
    cleanup?.();
    owned.onVisibilityChange?.(false);
    expect(disposeContent).toHaveBeenCalledOnce();
    expect(viewports.at(-1)?.visible).toBe(true);

    bridge.destroy();
    bridge.destroy();
  });
});

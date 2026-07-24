import { describe, expect, it } from "vitest";
import {
  fnWidgetCapsuleCanvasLifecycle,
} from "../../src/widget/fn.widget-capsule-lifecycle";

const VISIBLE_VIEWPORT = {
  width: 319.6,
  height: 179.4,
  scale: 2,
  visible: true,
  distance: 0,
  occlusion: 0.25,
  interactive: true,
} as const;

describe("fnWidgetCapsuleCanvasLifecycle", () => {
  it("maps real portal state into a bounded focused Capsule viewport", () => {
    expect(fnWidgetCapsuleCanvasLifecycle({
      viewport: VISIBLE_VIEWPORT,
      focused: true,
      collapsed: false,
      fullscreen: false,
    })).toEqual({
      viewport: {
        width: 320,
        height: 179,
        scale: 2,
        visibility: "visible",
        distance: 0,
        priority: 90,
        occlusion: 0.25,
      },
      focused: true,
      frozen: false,
      collapsed: false,
      fullscreen: false,
    });
  });

  it("hard-freezes only collapsed widgets and prioritizes fullscreen", () => {
    expect(fnWidgetCapsuleCanvasLifecycle({
      viewport: VISIBLE_VIEWPORT,
      focused: true,
      collapsed: true,
      fullscreen: false,
    })).toMatchObject({
      viewport: {
        visibility: "hidden",
        priority: -100,
        occlusion: 1,
      },
      focused: false,
      frozen: true,
      collapsed: true,
    });

    expect(fnWidgetCapsuleCanvasLifecycle({
      viewport: {
        ...VISIBLE_VIEWPORT,
        visible: false,
        distance: 80,
        occlusion: 1,
        interactive: false,
      },
      focused: false,
      collapsed: false,
      fullscreen: false,
    })).toMatchObject({
      viewport: {
        visibility: "hidden",
        distance: 80,
        priority: -50,
        occlusion: 1,
      },
      frozen: false,
    });

    expect(fnWidgetCapsuleCanvasLifecycle({
      viewport: VISIBLE_VIEWPORT,
      focused: false,
      collapsed: false,
      fullscreen: true,
    })).toMatchObject({
      viewport: {
        visibility: "visible",
        priority: 100,
      },
      frozen: false,
      fullscreen: true,
    });
  });
});

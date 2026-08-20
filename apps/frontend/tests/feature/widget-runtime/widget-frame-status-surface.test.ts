import { describe, expect, it, vi } from "vitest";
import {
  fnCreateWidgetPreviewState,
  fnTransitionWidgetPreviewState,
} from "../../../src/core/widgets/fn.widget-preview-state";
import { createWidgetFrameStatusSurface } from "../../../src/shell/framework/feature/canvas-extension/widget-frame-status-surface";

describe("widget frame status surface", () => {
  it("fills a cold published frame with accessible loading copy", () => {
    const state = fnTransitionWidgetPreviewState(
      fnCreateWidgetPreviewState("published"),
      { type: "request", requestId: 1 },
    );
    const surface = createWidgetFrameStatusSurface({
      document,
      state,
      onRetry: vi.fn(),
      onRemove: vi.fn(),
    });

    expect(surface?.getAttribute("role")).toBe("status");
    expect(surface?.getAttribute("aria-label")).toBe("Loading widget");
    expect(surface?.dataset.omnidrawWidgetRuntimePhase).toBe("loading");
    expect(surface?.style.height).toBe("100%");
    expect(surface?.textContent).toContain("Resolving and verifying the published widget");
  });

  it("renders a non-blocking replacement overlay and routes runtime retry to Reload", () => {
    const onRetry = vi.fn();
    let state = fnCreateWidgetPreviewState();
    state = fnTransitionWidgetPreviewState(state, { type: "request", requestId: 1 });
    state = fnTransitionWidgetPreviewState(state, { type: "candidate-ready", requestId: 1 });
    state = fnTransitionWidgetPreviewState(state, { type: "request", requestId: 2 });
    state = fnTransitionWidgetPreviewState(state, {
      type: "load-failed",
      requestId: 2,
      message: "Capsule did not become ready.",
    });
    const surface = createWidgetFrameStatusSurface({
      document,
      state,
      onRetry,
      onRemove: vi.fn(),
    });

    expect(surface?.style.pointerEvents).toBe("none");
    const reload = surface?.querySelector("button");
    expect(reload?.textContent).toBe("Reload");
    reload?.click();
    expect(onRetry).toHaveBeenCalledWith("reload");
  });
});

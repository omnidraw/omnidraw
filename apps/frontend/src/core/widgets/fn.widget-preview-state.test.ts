import { describe, expect, test } from "bun:test";

import {
  fnCreateWidgetPreviewState,
  fnTransitionWidgetPreviewState,
  fnWidgetPreviewPresentation,
} from "./fn.widget-preview-state";

function transition(
  state: ReturnType<typeof fnCreateWidgetPreviewState>,
  ...events: Parameters<typeof fnTransitionWidgetPreviewState>[1][]
) {
  return events.reduce(fnTransitionWidgetPreviewState, state);
}

describe("widget Preview lifecycle state machine", () => {
  test("moves a new request through build, transpile, mount, and ready", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "build-phase", requestId: 1, phase: "transpiling" },
      { type: "artifact-ready", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
    );

    expect(state).toEqual({
      phase: "ready",
      activeRequestId: 1,
      displayedRequestId: 1,
      errorMessage: null,
    });
    expect(fnWidgetPreviewPresentation(state)).toBeNull();
  });

  test("keeps the last-good request displayed when a newer build fails", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
      { type: "request", requestId: 2 },
      { type: "failed", requestId: 2, message: "transpile failed" },
    );
    const presentation = fnWidgetPreviewPresentation(state);

    expect(state.displayedRequestId).toBe(1);
    expect(state.phase).toBe("failed");
    expect(presentation?.title).toBe("Build failed");
    expect(presentation?.message).toContain("transpile failed");
    expect(presentation?.message).toContain("The last working Preview is still shown.");
    expect(presentation?.keepsDisplayedContent).toBe(true);
  });

  test("recovers from a failed replacement onto a newer ready request", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
      { type: "request", requestId: 2 },
      { type: "failed", requestId: 2, message: "transpile failed" },
      { type: "request", requestId: 3 },
      { type: "candidate-ready", requestId: 3 },
    );

    expect(state).toEqual({
      phase: "ready",
      activeRequestId: 3,
      displayedRequestId: 3,
      errorMessage: null,
    });
    expect(fnWidgetPreviewPresentation(state)).toBeNull();
  });

  test("ignores stale results from an older request", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
      { type: "request", requestId: 2 },
      { type: "build-phase", requestId: 1, phase: "transpiling" },
      { type: "candidate-ready", requestId: 1 },
    );

    expect(state.phase).toBe("building");
    expect(state.activeRequestId).toBe(2);
    expect(state.displayedRequestId).toBe(1);
  });

  test("shows an explicit first-build surface when no content exists", () => {
    const state = fnTransitionWidgetPreviewState(
      fnCreateWidgetPreviewState(),
      { type: "request", requestId: 7 },
    );
    const presentation = fnWidgetPreviewPresentation(state);

    expect(presentation).toMatchObject({
      title: "Building Preview",
      tone: "working",
      keepsDisplayedContent: false,
    });
  });
});

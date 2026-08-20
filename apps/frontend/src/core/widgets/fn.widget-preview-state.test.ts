import { describe, expect, test } from "bun:test";

import {
  fnCreateWidgetPreviewState,
  fnShouldRebuildWidgetPreview,
  fnTransitionWidgetPreviewState,
  fnWidgetPreviewPresentation,
} from "./fn.widget-preview-state";

function transition(
  state: ReturnType<typeof fnCreateWidgetPreviewState>,
  ...events: Parameters<typeof fnTransitionWidgetPreviewState>[1][]
) {
  return events.reduce(fnTransitionWidgetPreviewState, state);
}

describe("widget frame lifecycle state machines", () => {
  test("allows build-required fallback only for automatic mount requests", () => {
    expect(fnShouldRebuildWidgetPreview({
      allowBuildFallback: true,
      phase: "build_required",
    })).toBe(true);
    expect(fnShouldRebuildWidgetPreview({
      allowBuildFallback: false,
      phase: "build_required",
    })).toBe(false);
  });

  test("starts an ordinary Preview request in runtime loading, not building", () => {
    const state = fnTransitionWidgetPreviewState(
      fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
    );

    expect(state.buildAdmission.phase).toBe("idle");
    expect(state.runtime.phase).toBe("loading");
    expect(fnWidgetPreviewPresentation(state)).toMatchObject({
      title: "Starting Preview",
      tone: "working",
      keepsDisplayedContent: false,
    });
  });

  test("reports cold accepted-generation admission as restoring rather than compilation", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "build-phase", requestId: 1, phase: "restoring" },
      { type: "build-accepted", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
    );

    expect(state.buildAdmission.phase).toBe("accepted");
    expect(state.runtime.phase).toBe("ready");
    expect(fnWidgetPreviewPresentation(state)).toBeNull();
  });

  test("keeps build and runtime failures distinct and actionable", () => {
    const buildFailure = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "build-phase", requestId: 1, phase: "building" },
      { type: "build-failed", requestId: 1, message: "portable build failed" },
    );
    const loadFailure = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "build-accepted", requestId: 1 },
      { type: "load-failed", requestId: 1, message: "artifact verification failed" },
    );

    expect(fnWidgetPreviewPresentation(buildFailure)).toMatchObject({
      title: "Preview build failed",
      retryAction: "rebuild",
    });
    expect(fnWidgetPreviewPresentation(loadFailure)).toMatchObject({
      title: "Preview failed",
      retryAction: "reload",
    });
  });

  test("keeps the last-good request displayed and interactive during replacement", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
      { type: "request", requestId: 2 },
    );
    const presentation = fnWidgetPreviewPresentation(state);

    expect(state.displayedRequestId).toBe(1);
    expect(state.runtime.phase).toBe("loading");
    expect(presentation).toMatchObject({
      title: "Starting Preview",
      keepsDisplayedContent: true,
    });
    expect(presentation?.message).toContain("stays interactive");
  });

  test("ignores stale build and mount results from an older request", () => {
    const state = transition(fnCreateWidgetPreviewState(),
      { type: "request", requestId: 1 },
      { type: "candidate-ready", requestId: 1 },
      { type: "request", requestId: 2 },
      { type: "build-phase", requestId: 1, phase: "building" },
      { type: "candidate-ready", requestId: 1 },
    );

    expect(state.activeRequestId).toBe(2);
    expect(state.displayedRequestId).toBe(1);
    expect(state.buildAdmission.phase).toBe("idle");
    expect(state.runtime.phase).toBe("loading");
  });

  test("gives published frames the shared cold loading and runtime-failure surface", () => {
    const loading = fnTransitionWidgetPreviewState(
      fnCreateWidgetPreviewState("published"),
      { type: "request", requestId: 7 },
    );
    const failed = fnTransitionWidgetPreviewState(
      loading,
      { type: "load-failed", requestId: 7, message: "signature rejected" },
    );

    expect(fnWidgetPreviewPresentation(loading)).toMatchObject({
      title: "Loading widget",
      keepsDisplayedContent: false,
    });
    expect(fnWidgetPreviewPresentation(failed)).toMatchObject({
      title: "Widget failed",
      retryAction: "reload",
    });
  });
});

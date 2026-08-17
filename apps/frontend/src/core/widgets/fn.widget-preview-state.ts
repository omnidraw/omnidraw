export type TWidgetPreviewPhase =
  | "idle"
  | "building"
  | "transpiling"
  | "mounting"
  | "ready"
  | "failed";

export type TWidgetPreviewState = Readonly<{
  phase: TWidgetPreviewPhase;
  activeRequestId: number | null;
  displayedRequestId: number | null;
  errorMessage: string | null;
}>;

export type TWidgetPreviewEvent =
  | Readonly<{ type: "request"; requestId: number }>
  | Readonly<{ type: "build-phase"; requestId: number; phase: "building" | "transpiling" }>
  | Readonly<{ type: "artifact-ready"; requestId: number }>
  | Readonly<{ type: "candidate-ready"; requestId: number }>
  | Readonly<{ type: "failed"; requestId: number; message: string }>;

export function fnCreateWidgetPreviewState(): TWidgetPreviewState {
  return Object.freeze({
    phase: "idle",
    activeRequestId: null,
    displayedRequestId: null,
    errorMessage: null,
  });
}

function isActiveRequest(
  state: TWidgetPreviewState,
  requestId: number,
): boolean {
  return state.activeRequestId === requestId;
}

/**
 * Revision-fenced Preview lifecycle reducer.
 *
 * A request owns every subsequent build/mount result. Late results from an
 * older request are intentionally ignored, and a failed request never clears
 * the request that is currently displayed.
 */
export function fnTransitionWidgetPreviewState(
  state: TWidgetPreviewState,
  event: TWidgetPreviewEvent,
): TWidgetPreviewState {
  if (event.type === "request") {
    if (event.requestId <= (state.activeRequestId ?? 0)) return state;
    return Object.freeze({
      phase: "building",
      activeRequestId: event.requestId,
      displayedRequestId: state.displayedRequestId,
      errorMessage: null,
    });
  }

  if (!isActiveRequest(state, event.requestId)) return state;

  switch (event.type) {
    case "build-phase":
      return Object.freeze({
        ...state,
        phase: event.phase,
        errorMessage: null,
      });
    case "artifact-ready":
      return Object.freeze({
        ...state,
        phase: "mounting",
        errorMessage: null,
      });
    case "candidate-ready":
      return Object.freeze({
        ...state,
        phase: "ready",
        displayedRequestId: event.requestId,
        errorMessage: null,
      });
    case "failed":
      return Object.freeze({
        ...state,
        phase: "failed",
        errorMessage: event.message,
      });
  }
}

export type TWidgetPreviewPresentation = Readonly<{
  title: string;
  message: string;
  tone: "working" | "failed";
  keepsDisplayedContent: boolean;
}>;

export function fnWidgetPreviewPresentation(
  state: TWidgetPreviewState,
): TWidgetPreviewPresentation | null {
  const keepsDisplayedContent = state.displayedRequestId !== null;
  switch (state.phase) {
    case "idle":
    case "ready":
      return null;
    case "building":
      return Object.freeze({
        title: "Building Preview",
        message: keepsDisplayedContent
          ? "Your current Preview stays live while the next build is prepared."
          : "Preparing the widget source and dependencies.",
        tone: "working",
        keepsDisplayedContent,
      });
    case "transpiling":
      return Object.freeze({
        title: "Compiling Preview",
        message: keepsDisplayedContent
          ? "Transpiling and validating the latest code. Your current Preview is still live."
          : "Transpiling and validating the latest widget code.",
        tone: "working",
        keepsDisplayedContent,
      });
    case "mounting":
      return Object.freeze({
        title: "Starting Preview",
        message: keepsDisplayedContent
          ? "The new build is ready. Checking it before swapping it into view."
          : "Loading the accepted build into the Preview frame.",
        tone: "working",
        keepsDisplayedContent,
      });
    case "failed": {
      const failureDetail = state.errorMessage
        ?? "The Preview could not be built. Repair the latest changes and retry.";
      return Object.freeze({
        title: keepsDisplayedContent ? "Build failed" : "Preview build failed",
        message: keepsDisplayedContent
          ? `${failureDetail} The last working Preview is still shown.`
          : failureDetail,
        tone: "failed",
        keepsDisplayedContent,
      });
    }
  }
}

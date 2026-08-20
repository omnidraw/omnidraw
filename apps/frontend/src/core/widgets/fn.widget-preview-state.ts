export type TWidgetFrameKind = "preview" | "published";

export type TWidgetBuildAdmissionPhase =
  | "idle"
  | "restoring"
  | "build_required"
  | "building"
  | "validating"
  | "accepted"
  | "failed";

export type TWidgetFrameRuntimePhase = "idle" | "loading" | "ready" | "failed";

export function fnShouldRebuildWidgetPreview(args: Readonly<{
  allowBuildFallback: boolean;
  phase: string;
}>): boolean {
  return args.allowBuildFallback
    && (args.phase === "unbuilt" || args.phase === "build_required");
}

export type TWidgetPreviewState = Readonly<{
  kind: TWidgetFrameKind;
  activeRequestId: number | null;
  displayedRequestId: number | null;
  buildAdmission: Readonly<{
    phase: TWidgetBuildAdmissionPhase;
    requestId: number | null;
    errorMessage: string | null;
  }>;
  runtime: Readonly<{
    phase: TWidgetFrameRuntimePhase;
    requestId: number | null;
    errorMessage: string | null;
  }>;
}>;

export type TWidgetPreviewEvent =
  | Readonly<{ type: "request"; requestId: number }>
  | Readonly<{
      type: "build-phase";
      requestId: number;
      phase: "restoring" | "build_required" | "building" | "validating";
    }>
  | Readonly<{ type: "build-accepted"; requestId: number }>
  | Readonly<{ type: "candidate-ready"; requestId: number }>
  | Readonly<{ type: "display-retired"; requestId: number }>
  | Readonly<{ type: "build-failed"; requestId: number; message: string }>
  | Readonly<{ type: "load-failed"; requestId: number; message: string }>;

export function fnCreateWidgetPreviewState(
  kind: TWidgetFrameKind = "preview",
): TWidgetPreviewState {
  return Object.freeze({
    kind,
    activeRequestId: null,
    displayedRequestId: null,
    buildAdmission: Object.freeze({
      phase: "idle",
      requestId: null,
      errorMessage: null,
    }),
    runtime: Object.freeze({
      phase: "idle",
      requestId: null,
      errorMessage: null,
    }),
  });
}

function isActiveRequest(
  state: TWidgetPreviewState,
  requestId: number,
): boolean {
  return state.activeRequestId === requestId;
}

/**
 * Request-fenced widget lifecycle reducer.
 *
 * Draft build admission and browser runtime loading are deliberately separate.
 * A request always starts as runtime loading; only an observed host build phase
 * can move build admission into restoring/building/validating. Late results
 * from older requests are ignored and never replace the displayed candidate.
 */
export function fnTransitionWidgetPreviewState(
  state: TWidgetPreviewState,
  event: TWidgetPreviewEvent,
): TWidgetPreviewState {
  if (event.type === "request") {
    if (event.requestId <= (state.activeRequestId ?? 0)) return state;
    return Object.freeze({
      ...state,
      activeRequestId: event.requestId,
      buildAdmission: Object.freeze({
        phase: "idle" as const,
        requestId: event.requestId,
        errorMessage: null,
      }),
      runtime: Object.freeze({
        phase: "loading" as const,
        requestId: event.requestId,
        errorMessage: null,
      }),
    });
  }

  if (!isActiveRequest(state, event.requestId)) return state;

  switch (event.type) {
    case "build-phase":
      return Object.freeze({
        ...state,
        buildAdmission: Object.freeze({
          phase: event.phase,
          requestId: event.requestId,
          errorMessage: null,
        }),
      });
    case "build-accepted":
      return Object.freeze({
        ...state,
        buildAdmission: Object.freeze({
          phase: "accepted" as const,
          requestId: event.requestId,
          errorMessage: null,
        }),
      });
    case "candidate-ready":
      return Object.freeze({
        ...state,
        displayedRequestId: event.requestId,
        buildAdmission: Object.freeze({
          phase: state.kind === "preview" ? "accepted" as const : "idle" as const,
          requestId: event.requestId,
          errorMessage: null,
        }),
        runtime: Object.freeze({
          phase: "ready" as const,
          requestId: event.requestId,
          errorMessage: null,
        }),
      });
    case "display-retired":
      if (state.displayedRequestId !== event.requestId) return state;
      return Object.freeze({
        ...state,
        displayedRequestId: null,
        runtime: Object.freeze({
          phase: "idle" as const,
          requestId: event.requestId,
          errorMessage: null,
        }),
      });
    case "build-failed":
      return Object.freeze({
        ...state,
        buildAdmission: Object.freeze({
          phase: "failed" as const,
          requestId: event.requestId,
          errorMessage: event.message,
        }),
        runtime: Object.freeze({
          phase: state.displayedRequestId === null ? "idle" as const : "ready" as const,
          requestId: state.displayedRequestId,
          errorMessage: null,
        }),
      });
    case "load-failed":
      return Object.freeze({
        ...state,
        runtime: Object.freeze({
          phase: "failed" as const,
          requestId: event.requestId,
          errorMessage: event.message,
        }),
      });
  }
}

export type TWidgetPreviewPresentation = Readonly<{
  title: string;
  message: string;
  tone: "working" | "action" | "failed";
  keepsDisplayedContent: boolean;
  retryAction: "reload" | "rebuild" | null;
}>;

export function fnWidgetPreviewPresentation(
  state: TWidgetPreviewState,
): TWidgetPreviewPresentation | null {
  const keepsDisplayedContent = state.displayedRequestId !== null;
  const working = (title: string, message: string): TWidgetPreviewPresentation => Object.freeze({
    title,
    message,
    tone: "working",
    keepsDisplayedContent,
    retryAction: null,
  });
  if (state.kind === "preview") {
    switch (state.buildAdmission.phase) {
      case "restoring":
        return working(
          "Restoring Preview",
          keepsDisplayedContent
            ? "The accepted build is being verified and admitted. Your current Preview stays live."
            : "Verifying and admitting the accepted build without rebuilding it.",
        );
      case "build_required":
        return Object.freeze({
          title: "Build required",
          message: keepsDisplayedContent
            ? "The draft changed. Rebuild it when you are ready; the last working Preview stays live."
            : "This draft has no accepted build for its current files.",
          tone: "action",
          keepsDisplayedContent,
          retryAction: "rebuild",
        });
      case "building":
        return working(
          "Building Preview",
          keepsDisplayedContent
            ? "Your current Preview stays live while the portable build runs."
            : "Building the widget source and dependencies.",
        );
      case "validating":
        return working(
          "Admitting Preview build",
          keepsDisplayedContent
            ? "The portable output is being validated. Your current Preview stays live."
            : "Validating the portable output before the Preview can start.",
        );
      case "failed": {
        const detail = state.buildAdmission.errorMessage
          ?? "The Preview build failed. Repair the latest changes and rebuild it.";
        return Object.freeze({
          title: keepsDisplayedContent ? "Build failed" : "Preview build failed",
          message: keepsDisplayedContent
            ? `${detail} The last working Preview is still shown.`
            : detail,
          tone: "failed",
          keepsDisplayedContent,
          retryAction: "rebuild",
        });
      }
      case "idle":
      case "accepted":
        break;
    }
  }

  switch (state.runtime.phase) {
    case "idle":
    case "ready":
      return null;
    case "loading":
      return working(
        state.kind === "preview" ? "Starting Preview" : "Loading widget",
        keepsDisplayedContent
          ? state.kind === "preview"
            ? "The accepted Preview is loading. The current Preview stays interactive until it is ready."
            : "The updated widget is loading. The current widget stays interactive until it is ready."
          : state.kind === "preview"
            ? "Loading the accepted build and waiting for the Preview to be ready."
            : "Resolving and verifying the published widget, then waiting for it to be ready.",
      );
    case "failed": {
      const detail = state.runtime.errorMessage
        ?? (state.kind === "preview"
          ? "The accepted Preview could not start."
          : "The published widget could not start.");
      return Object.freeze({
        title: state.kind === "preview" ? "Preview failed" : "Widget failed",
        message: keepsDisplayedContent
          ? `${detail} The last working ${state.kind === "preview" ? "Preview" : "widget"} is still shown.`
          : detail,
        tone: "failed",
        keepsDisplayedContent,
        retryAction: "reload",
      });
    }
  }
}

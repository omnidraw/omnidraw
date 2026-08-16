import type { CapsuleMountErrorEvent } from "@omnidraw/capsule";

import type {
  TWidgetHostDiagnostic,
  TWidgetHostDiagnosticCategory,
} from "../contracts/types";

function diagnosticCategory(event: CapsuleMountErrorEvent): TWidgetHostDiagnosticCategory {
  if ([
    "PAYLOAD_LIMIT",
    "RATE_LIMIT",
    "CONCURRENCY_LIMIT",
    "DEADLINE_EXCEEDED",
    "STREAM_OVERFLOW",
    "HANDLE_LIMIT",
    "HANDLE_QUOTA",
  ].includes(event.code)) return "budget";
  switch (event.category) {
    case "capability": return "capability";
    case "lifecycle": return "lifecycle";
    case "vm": return "guest";
    case "dom":
    case "host": return "host";
  }
}

function isGuestReportedError(event: CapsuleMountErrorEvent): boolean {
  return event.category === "vm"
    && event.source === "guest.console"
    && event.code === "GUEST_REPORTED_ERROR"
    && event.fatal === false;
}

/** Maps Capsule's bounded event union without retaining guest-controlled values. */
export function fnCapsuleMountErrorDiagnostic(
  event: CapsuleMountErrorEvent,
): TWidgetHostDiagnostic {
  const category = diagnosticCategory(event);
  const message = isGuestReportedError(event)
    ? "The widget reported a runtime error."
    : category === "budget"
      ? "The widget exceeded a browser runtime budget."
      : category === "capability"
        ? "A widget capability was denied or failed."
        : category === "guest"
          ? "The widget runtime failed."
          : category === "lifecycle"
            ? "The widget lifecycle operation failed."
            : category === "internal"
              ? "The browser widget runtime failed safely."
              : "The browser widget host rejected the operation.";
  const details = event as unknown as Readonly<Record<string, unknown>>;
  return Object.freeze({
    format: "omnidraw.widget-host-diagnostic.v1",
    phase: "runtime",
    category,
    code: event.code,
    fatal: event.fatal,
    message,
    ...(typeof details.capabilityId === "string" ? { capability: details.capabilityId } : {}),
    ...(typeof details.operation === "string" ? { operation: details.operation } : {}),
  });
}

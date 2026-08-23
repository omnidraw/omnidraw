import type { TWidgetHostDiagnostic } from "@omnidraw/sdk";

export function fnIsWidgetGuestReportedError(
  diagnostic: TWidgetHostDiagnostic,
): boolean {
  return diagnostic.phase === "runtime"
    && diagnostic.category === "guest"
    && diagnostic.code === "GUEST_REPORTED_ERROR"
    && diagnostic.fatal === false;
}

/** Creates a content-free Preview notice; diagnostic message text is never rendered. */
export function createWidgetGuestReportedErrorSurface(
  document: Document,
  diagnostic: TWidgetHostDiagnostic,
): HTMLElement {
  if (!fnIsWidgetGuestReportedError(diagnostic)) {
    throw new TypeError("A guest-reported error diagnostic is required.");
  }
  const surface = document.createElement("section");
  surface.dataset.omnidrawWidgetPreviewDiagnostic = "GUEST_REPORTED_ERROR";
  surface.setAttribute("role", "status");
  surface.setAttribute("aria-live", "polite");
  surface.setAttribute("aria-atomic", "true");
  surface.setAttribute("aria-label", "Widget reported an error");
  Object.assign(surface.style, {
    alignItems: "flex-start",
    alignSelf: "start",
    background: "var(--omnidraw-color-surface, #fff)",
    border: "1px solid var(--omnidraw-color-border, #d4d4d4)",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
    boxSizing: "border-box",
    color: "var(--omnidraw-color-text, #171717)",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    gridArea: "1 / 1",
    justifySelf: "stretch",
    margin: "8px",
    maxWidth: "calc(100% - 16px)",
    padding: "8px 10px",
    pointerEvents: "none",
    zIndex: "3",
  });
  const title = document.createElement("strong");
  title.textContent = "Widget reported an error";
  title.style.cssText = "font:600 12px/16px system-ui,sans-serif;margin:0";
  const message = document.createElement("span");
  message.textContent = "Preview may be incomplete. Repair and rebuild the widget if the problem persists.";
  message.style.cssText = "font:400 11px/15px system-ui,sans-serif;margin:0;overflow-wrap:anywhere";
  surface.append(title, message);
  return surface;
}

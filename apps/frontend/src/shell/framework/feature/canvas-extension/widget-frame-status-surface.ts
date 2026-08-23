import {
  fnWidgetPreviewPresentation,
  type TWidgetPreviewState,
} from "@/core/widgets/fn.widget-preview-state";

export function createWidgetFrameStatusSurface(args: Readonly<{
  document: Document;
  state: TWidgetPreviewState;
  onRetry(action: "reload" | "rebuild"): void;
  onRemove(): void;
}>): HTMLElement | null {
  const presentation = fnWidgetPreviewPresentation(args.state);
  if (presentation === null) return null;
  const surface = args.document.createElement("section");
  surface.dataset.omnidrawWidgetFrameStatus = args.state.kind;
  surface.dataset.omnidrawWidgetBuildPhase = args.state.buildAdmission.phase;
  surface.dataset.omnidrawWidgetRuntimePhase = args.state.runtime.phase;
  if (args.state.kind === "preview") {
    surface.dataset.omnidrawWidgetPreviewPhase = args.state.buildAdmission.phase === "idle"
      || args.state.buildAdmission.phase === "accepted"
        ? args.state.runtime.phase
        : args.state.buildAdmission.phase;
    if (presentation.tone !== "working") {
      surface.dataset.omnidrawWidgetPreviewFailure = "";
    }
  }
  surface.setAttribute("role", presentation.tone === "failed" ? "alert" : "status");
  surface.setAttribute("aria-live", "polite");
  surface.setAttribute("aria-atomic", "true");
  surface.setAttribute("aria-label", presentation.title);
  Object.assign(surface.style, presentation.keepsDisplayedContent
    ? {
        alignItems: "flex-start",
        alignSelf: "start",
        background: "linear-gradient(var(--omnidraw-color-surface, #fff), transparent)",
        boxSizing: "border-box",
        color: "var(--omnidraw-color-text, #171717)",
        display: "flex",
        gap: "8px",
        gridArea: "1 / 1",
        justifySelf: "stretch",
        padding: "10px 12px",
        pointerEvents: "none",
        width: "100%",
        zIndex: "4",
      }
    : {
        alignItems: "center",
        background: "var(--omnidraw-color-surface, #fff)",
        boxSizing: "border-box",
        color: "var(--omnidraw-color-text, #171717)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        gridArea: "1 / 1",
        height: "100%",
        justifyContent: "center",
        minHeight: "0",
        padding: "24px",
        textAlign: "center",
        width: "100%",
        zIndex: "4",
      });
  const spinner = args.document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  Object.assign(spinner.style, {
    animation: presentation.tone === "working" ? "omnidraw-widget-preview-spin 900ms linear infinite" : "none",
    border: "2px solid currentColor",
    borderRadius: "999px",
    borderRightColor: presentation.tone === "working" ? "transparent" : "currentColor",
    flex: "0 0 auto",
    height: "14px",
    opacity: "0.72",
    width: "14px",
  });
  const copy = args.document.createElement("div");
  copy.style.cssText = "display:flex;flex:1;flex-direction:column;gap:2px;min-width:0";
  const title = args.document.createElement("h3");
  title.textContent = presentation.title;
  title.style.cssText = "font:600 12px/16px system-ui,sans-serif;margin:0";
  const message = args.document.createElement("span");
  message.textContent = presentation.message;
  message.style.cssText = "font:400 11px/15px system-ui,sans-serif;margin:0;overflow-wrap:anywhere";
  copy.append(title, message);
  surface.append(spinner, copy);
  if (presentation.retryAction !== null) {
    const retryAction = presentation.retryAction;
    const controls = args.document.createElement("div");
    controls.style.cssText = "display:flex;flex:0 0 auto;gap:6px;pointer-events:auto";
    const retry = args.document.createElement("button");
    retry.type = "button";
    retry.textContent = retryAction === "rebuild" ? "Rebuild" : "Reload";
    retry.addEventListener("click", () => args.onRetry(retryAction));
    retry.style.cssText = "appearance:none;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:600 11px/15px system-ui,sans-serif;padding:4px 8px";
    const remove = args.document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", args.onRemove);
    remove.style.cssText = retry.style.cssText;
    controls.append(retry, remove);
    surface.append(controls);
  }
  return surface;
}

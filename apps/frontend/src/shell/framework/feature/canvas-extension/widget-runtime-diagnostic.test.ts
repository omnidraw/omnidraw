import { describe, expect, test } from "bun:test";
// @ts-expect-error jsdom intentionally has no bundled declarations in this workspace.
import { JSDOM } from "jsdom";
import type { TWidgetHostDiagnostic } from "@omnidraw/sdk";

import {
  createWidgetGuestReportedErrorSurface,
  fnIsWidgetGuestReportedError,
} from "./widget-runtime-diagnostic";

function diagnostic(overrides: Partial<TWidgetHostDiagnostic> = {}): TWidgetHostDiagnostic {
  return Object.freeze({
    format: "omnidraw.widget-host-diagnostic.v1",
    phase: "runtime",
    category: "guest",
    code: "GUEST_REPORTED_ERROR",
    fatal: false,
    message: "The widget reported a runtime error.",
    ...overrides,
  });
}

describe("widget Preview guest-reported error presentation", () => {
  test("recognizes only the exact nonfatal runtime diagnostic", () => {
    expect(fnIsWidgetGuestReportedError(diagnostic())).toBe(true);
    expect(fnIsWidgetGuestReportedError(diagnostic({ fatal: true }))).toBe(false);
    expect(fnIsWidgetGuestReportedError(diagnostic({ code: "GUEST_EXCEPTION" }))).toBe(false);
    expect(fnIsWidgetGuestReportedError(diagnostic({ category: "host" }))).toBe(false);
  });

  test("creates one durable accessible notice without intercepting widget input", () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    const surface = createWidgetGuestReportedErrorSurface(dom.window.document, diagnostic({
      message: "secret guest message",
    }));

    expect(surface.dataset.omnidrawWidgetPreviewDiagnostic).toBe("GUEST_REPORTED_ERROR");
    expect(surface.getAttribute("role")).toBe("status");
    expect(surface.getAttribute("aria-live")).toBe("polite");
    expect(surface.style.pointerEvents).toBe("none");
    expect(surface.textContent).toContain("Widget reported an error");
    expect(surface.textContent).toContain("Preview may be incomplete");
    expect(surface.textContent).not.toContain("secret");
  });
});

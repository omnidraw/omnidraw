import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Toaster,
  showErrorToast,
  showSuccessToast,
  showToast,
  showWarningToast,
  toaster,
} from "../../src/shell/framework/components/ui/Toast";
import { settleSolidUpdate } from "../settled";

const cleanups: Array<() => void> = [];

function mountToaster(): () => void {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <Toaster />, host);
  const cleanup = () => {
    dispose();
    host.remove();
  };
  cleanups.push(cleanup);
  return cleanup;
}

function findToast(title: string): HTMLElement | null {
  return [...document.body.querySelectorAll<HTMLElement>("[data-omnidraw-toast-variant]")]
    .find((toast) => toast.textContent?.includes(title)) ?? null;
}

beforeEach(() => {
  toaster.clear();
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  toaster.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("owned toast region", () => {
  test("mounts an accessible region and emits no Solid untracked-read diagnostics", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mountToaster();
    await settleSolidUpdate();

    const region = document.body.querySelector<HTMLElement>('[role="region"]');
    expect(region?.getAttribute("aria-label")).toBe("Notifications (Alt+T)");
    const list = region?.querySelector<HTMLOListElement>("ol");
    expect(list).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      code: "KeyT",
      key: "t",
    }));
    expect(document.activeElement).toBe(list);

    showToast("Canvas ready", "The document is synchronized.");
    await settleSolidUpdate();
    const toast = findToast("Canvas ready")!;
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(document.getElementById(toast.getAttribute("aria-labelledby")!)?.textContent)
      .toBe("Canvas ready");
    expect(document.getElementById(toast.getAttribute("aria-describedby")!)?.textContent)
      .toBe("The document is synchronized.");

    const diagnostics = [...warnings.mock.calls, ...errors.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED");
  });

  test("renders every semantic variant while keeping the visible queue bounded", async () => {
    mountToaster();
    const defaultId = showToast("Default notice");
    showErrorToast("Error notice");
    showSuccessToast("Success notice");
    showWarningToast("Warning notice");
    await settleSolidUpdate();

    expect(document.body.querySelectorAll("[data-omnidraw-toast-variant]")).toHaveLength(3);
    expect(findToast("Default notice")?.dataset.omnidrawToastVariant).toBe("default");
    expect(findToast("Default notice")?.getAttribute("role")).toBe("status");
    expect(findToast("Error notice")?.dataset.omnidrawToastVariant).toBe("error");
    expect(findToast("Error notice")?.getAttribute("role")).toBe("alert");
    expect(findToast("Error notice")?.getAttribute("aria-live")).toBe("assertive");
    expect(findToast("Success notice")?.dataset.omnidrawToastVariant).toBe("success");
    expect(findToast("Warning notice")).toBeNull();

    toaster.dismiss(defaultId);
    await settleSolidUpdate();
    expect(findToast("Default notice")).toBeNull();
    expect(findToast("Warning notice")?.dataset.omnidrawToastVariant).toBe("warning");
    expect(document.body.querySelectorAll("[data-omnidraw-toast-variant]")).toHaveLength(3);
  });

  test("supports close-button and Escape dismissal", async () => {
    mountToaster();
    showToast("Close me");
    await settleSolidUpdate();
    const first = findToast("Close me")!;
    const close = first.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    close.click();
    await settleSolidUpdate();
    expect(findToast("Close me")).toBeNull();

    showSuccessToast("Escape me");
    await settleSolidUpdate();
    const second = findToast("Escape me")!;
    second.focus();
    second.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await settleSolidUpdate();
    expect(findToast("Escape me")).toBeNull();
  });

  test("resumes every toast timer after the focused toast is removed", async () => {
    mountToaster();
    showToast("Focused notice");
    showSuccessToast("Waiting notice");
    await settleSolidUpdate();

    const focused = findToast("Focused notice")!;
    focused.focus();
    await settleSolidUpdate();
    focused.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await settleSolidUpdate();
    expect(findToast("Focused notice")).toBeNull();

    showWarningToast("New notice");
    await settleSolidUpdate();
    vi.advanceTimersByTime(5_001);
    await settleSolidUpdate();
    expect(findToast("Waiting notice")).toBeNull();
    expect(findToast("New notice")).toBeNull();
  });

  test("tracks remaining lifetime, pauses interaction, expires, and clears timers on unmount", async () => {
    const cleanup = mountToaster();
    showWarningToast("Timed notice");
    await settleSolidUpdate();
    const toast = findToast("Timed notice")!;
    const progress = toast.querySelector<HTMLElement>('[aria-hidden="true"] > div')!;
    expect(Number.parseFloat(progress.style.width)).toBe(100);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    vi.advanceTimersByTime(2_000);
    await settleSolidUpdate();
    expect(Number.parseFloat(progress.style.width)).toBeCloseTo(60, 0);

    const list = document.body.querySelector<HTMLOListElement>("ol")!;
    list.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settleSolidUpdate();
    const pausedWidth = Number.parseFloat(progress.style.width);
    vi.advanceTimersByTime(2_000);
    await settleSolidUpdate();
    expect(findToast("Timed notice")).not.toBeNull();
    expect(Number.parseFloat(progress.style.width)).toBeCloseTo(pausedWidth, 5);

    list.dispatchEvent(new MouseEvent("pointerleave"));
    await settleSolidUpdate();
    vi.advanceTimersByTime(3_000);
    await settleSolidUpdate();
    expect(findToast("Timed notice")).toBeNull();

    showToast("Cleanup notice");
    await settleSolidUpdate();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();
    cleanups.splice(cleanups.indexOf(cleanup), 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

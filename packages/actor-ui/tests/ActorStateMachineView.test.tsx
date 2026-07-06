import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { ActorStateMachineView } from "../src";
import type { TVibecanvasJson } from "../src";

const MANIFEST = {
  slug: "test-actor",
  name: "Test Actor",
  actor: {
    relFunctionPath: "actors/test",
    initialState: "ready",
    initialData: null,
    inputMsgSchema: {
      inspect: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
        },
        required: ["repoPath"],
      },
    },
    states: {
      ready: {
        on: {
          inspect: {
            func: ["fx.load", "fn.pickNext"],
            allowedTargetStates: ["busy.inspecting"],
          },
        },
      },
      "busy.inspecting": {
        on: {
          complete: {
            func: ["tx.save"],
            allowedTargetStates: ["ready"],
          },
        },
      },
    },
  },
  widget: {
    relWidgetDir: "widgets/test",
    tool: {
      label: "Test",
      behavior: { type: "modal" },
    },
  },
} satisfies TVibecanvasJson;

let disposeRendered: (() => void) | undefined;
let container: HTMLDivElement | undefined;

function renderView(manifest: TVibecanvasJson = MANIFEST) {
  container = document.createElement("div");
  document.body.appendChild(container);
  disposeRendered = render(() => <ActorStateMachineView manifest={manifest} />, container);
  return container;
}

afterEach(() => {
  disposeRendered?.();
  disposeRendered = undefined;
  container?.remove();
  container = undefined;
});

describe("ActorStateMachineView", () => {
  it("renders state nodes, transition labels, function names, and initial state", () => {
    const root = renderView();

    expect(root.querySelectorAll(".vc-actor-ui__node")).toHaveLength(4);
    expect(root.querySelectorAll(".vc-actor-ui__edge")).toHaveLength(3);
    expect(root.querySelectorAll(".vc-actor-ui__edge--implicit")).toHaveLength(1);
    expect(root.querySelector(".vc-actor-ui__node--initial")?.textContent).toContain("ready");
    expect(root.querySelector(".vc-actor-ui__initial-dot")).toBeNull();
    expect(root.textContent).toContain("booting");
    expect(root.textContent).toContain("error");
    expect(root.textContent).toContain("inspect");
    expect(root.textContent).toContain("busy.inspecting");
    expect(root.textContent).toContain("fx.load");
    expect(root.textContent).toContain("tx.save");
    expect(root.querySelector(".vc-actor-ui")?.getAttribute("data-transition-count")).toBe("2");
  });

  it("renders implicit booting and error states when actor states are missing", () => {
    const root = renderView({
      ...MANIFEST,
      actor: {
        ...MANIFEST.actor,
        states: {},
      },
    });

    expect(root.querySelector(".vc-actor-ui__empty")).toBeNull();
    expect(root.querySelectorAll(".vc-actor-ui__node")).toHaveLength(3);
    expect(root.querySelectorAll(".vc-actor-ui__edge--implicit")).toHaveLength(1);
    expect(root.textContent).toContain("booting");
    expect(root.textContent).toContain("ready");
    expect(root.textContent).toContain("error");
    expect(root.querySelector(".vc-actor-ui")?.getAttribute("data-state-count")).toBe("3");
  });

  it("opens transition details from a message label", () => {
    const root = renderView();
    const inspectButton = root.querySelector<HTMLButtonElement>(".vc-actor-ui__edge-label[aria-label='Open inspect transition details']");

    expect(inspectButton).not.toBeNull();
    inspectButton?.click();

    expect(root.querySelector("[role='dialog']")?.textContent).toContain("inspect");
    expect(root.querySelector("[role='dialog']")?.textContent).toContain("fx.load");
    expect(root.querySelector("[role='dialog']")?.textContent).toContain("fn.pickNext");
    expect(root.querySelector("[role='dialog']")?.textContent).toContain("repoPath");

    root.querySelector<HTMLButtonElement>(".vc-actor-ui__popover-close")?.click();
    expect(root.querySelector("[role='dialog']")).toBeNull();
  });

  it("focuses outgoing transitions for the active state and closes popovers on clickaway", () => {
    const root = renderView();
    const inspectButton = root.querySelector<HTMLButtonElement>(".vc-actor-ui__edge-label[aria-label='Open inspect transition details']");
    const completeButton = root.querySelector<HTMLButtonElement>(".vc-actor-ui__edge-label[aria-label='Open complete transition details']");

    expect(inspectButton?.classList.contains("vc-actor-ui__edge-label--muted")).toBe(false);
    expect(completeButton?.classList.contains("vc-actor-ui__edge-label--muted")).toBe(true);

    inspectButton?.click();
    expect(root.querySelector("[role='dialog']")).not.toBeNull();

    root.querySelector<HTMLElement>("[aria-label='Set active state busy.inspecting']")?.click();

    expect(root.querySelector("[role='dialog']")).toBeNull();
    expect(inspectButton?.classList.contains("vc-actor-ui__edge-label--muted")).toBe(true);
    expect(completeButton?.classList.contains("vc-actor-ui__edge-label--muted")).toBe(false);
  });
});

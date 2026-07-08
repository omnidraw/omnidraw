import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it } from "vitest"
import { ActorTab } from "../../../../src/components/AiWizzard/tabs/ActorTab"

const MANIFEST: TVibecanvasJson = {
  slug: "loaded-widget",
  name: "Loaded Widget",
  description: "Already published widget",
  actor: {
    relFunctionPath: "./actor/functions.ts",
    initialState: "ready",
    initialData: { count: 2 },
    dataSchema: {
      type: "object",
      properties: {
        count: { type: "number" },
      },
    },
    states: {},
  },
  widget: {
    relWidgetDir: "./widget",
    tool: {
      label: "Loaded Widget",
      behavior: { type: "action" },
    },
  },
}

let disposeRendered: (() => void) | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  container?.remove()
  container = undefined
})

describe("ActorTab rendered manifest", () => {
  it("initializes editable fields from an already-loaded actor", () => {
    container = document.createElement("div")
    document.body.appendChild(container)

    const apiService = {
      api: {
        agent: {
          wizzard: {
            draftManifest: {
              read: () => new Promise(() => {}),
              patch: async () => [undefined, { ok: true, manifest: MANIFEST }],
            },
          },
        },
      },
    }

    disposeRendered = render(() => ActorTab({
      actor: MANIFEST,
      apiService: apiService as never,
      sessionId: "session",
      widgetId: "widget",
      isApproving: false,
      onApprove: async () => {},
      onManifestChange: () => {},
    }), container)

    expect((container.querySelector("input") as HTMLInputElement | null)?.value).toBe("Loaded Widget")
    expect((container.querySelectorAll("input")[1] as HTMLInputElement | undefined)?.value).toBe("ready")
    expect((container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("Already published widget")
    expect(container.textContent).not.toContain("Invalid JSON")
    expect(container.textContent).toContain("Loaded Widget")
  })
})

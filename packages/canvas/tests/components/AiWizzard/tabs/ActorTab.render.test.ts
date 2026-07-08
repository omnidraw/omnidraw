import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActorTab } from "../../../../src/components/AiWizzard/tabs/ActorTab"

vi.mock("@vibecanvas/actor-ui", () => ({
  ActorStateMachineView: (props: { manifest?: TVibecanvasJson }) => {
    const element = document.createElement("div")
    element.dataset.testid = "actor-state-machine"
    element.textContent = props.manifest?.name ?? ""
    return element
  },
}))

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

const CANDIDATE_MANIFEST = {
  slug: "counter-actor",
  name: "Counter Actor",
  description: "Counts button presses.",
  actor: {
    relFunctionPath: "actor/functions.ts",
    initialState: "idle",
    initialData: { count: 0 },
    dataSchema: true,
    states: {
      idle: {
        on: {},
      },
    },
  },
  widget: {
    relWidgetDir: "widget",
    tool: {
      label: "Counter",
    },
  },
} as unknown as TVibecanvasJson

let disposeRendered: (() => void) | undefined
let container: HTMLDivElement | undefined

function createApiService() {
  return {
    api: {
      agent: {
        wizzard: {
          draftManifest: {
            read: vi.fn(() => new Promise<never>(() => {})),
            patch: vi.fn(),
          },
        },
      },
    },
  }
}

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  container?.remove()
  container = undefined
})

describe("ActorTab rendered manifest", () => {
  it("reactively swaps from empty state to the latest actor candidate", () => {
    const [actor, setActor] = createSignal<TVibecanvasJson | null>(null)
    const [actorSource, setActorSource] = createSignal<"file" | "actor-candidate" | "connected">("connected")
    const props = {
      apiService: createApiService() as never,
      sessionId: "session-1",
      widgetId: "widget-1",
      isApproving: false,
      onApprove: async () => {},
      onManifestChange: () => {},
    }

    Object.defineProperties(props, {
      actor: {
        get: actor,
      },
      actorSource: {
        get: actorSource,
      },
    })

    container = document.createElement("div")
    document.body.appendChild(container)
    disposeRendered = render(() => ActorTab(props as never), container)

    expect(container.textContent).toContain("No actor loaded")

    setActorSource("actor-candidate")
    setActor(CANDIDATE_MANIFEST)

    expect(container.textContent).toContain("Draft actor candidate")
    expect(container.textContent).toContain("Counter Actor")
    expect(container.textContent).toContain("Approve + implement")
    expect(container.querySelector("[data-testid='actor-state-machine']")?.textContent).toBe("Counter Actor")
  })

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
      actorSource: "file",
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

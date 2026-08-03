import type { TWidgetDetail } from "@omnidraw/orpc-client"
import { afterEach, describe, expect, test, vi } from "vitest"
import { mountWidgetPublicationDialog } from "../../src/publication/mount"
import type { TWidgetPublicationTarget } from "../../src/publication/interface"
import type { TWidgetTitleBarActionState, TWidgetTitleBarPortal } from "../../src/widget/interface"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"
const PREVIEW_SELECTION: TWidgetPublicationTarget = {
  draftId: DRAFT_ID,
  previewId: "40000000-0000-4000-8000-000000000001",
  canvasId: "canvas-one",
  frameNodeId: "frame-one",
  label: "Main canvas · Companion Preview · frame frame-one",
}

function detail(args: { revision?: string; published?: boolean } = {}): TWidgetDetail {
  const variant: TWidgetDetail["variant"] = {
    draftId: DRAFT_ID,
    source: "draft",
    displayName: "Weather board",
    kind: "notes-widget",
    slug: "weather",
    description: null,
    revision: args.revision ?? "rev-2",
    contentFingerprint: null,
    updatedAt: null,
    tool: { label: "Weather", icon: null, group: null, priority: null, behaviorType: "action" },
    validation: null,
  }
  return {
    name: "Weather",
    source: "draft",
    relation: args.published ? "different" : "draft-only",
    sibling: args.published ? { ...variant, draftId: null, source: "published" } : null,
    manifest: null,
    problem: null,
    variant,
  }
}

function authoritativePublicationDetail(
  current: TWidgetDetail,
  revision = current.variant.revision,
): TWidgetDetail {
  return {
    ...current,
    relation: "same",
    variant: { ...current.variant, revision },
    sibling: {
      ...current.variant,
      draftId: null,
      source: "published",
      revision,
    },
  }
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)
}

function setup(args: {
  current?: TWidgetDetail
  detailResponses?: readonly TWidgetDetail[]
  authoritativeDetail?: TWidgetDetail | null
  previewSelection?: TWidgetPublicationTarget | null
  getPreviewSelection?: () => TWidgetPublicationTarget | null
  publishResult?: unknown
  publishDelay?: Promise<void>
  events?: () => Promise<unknown>
} = {}) {
  let action = () => undefined
  const states: TWidgetTitleBarActionState[] = []
  const titleBar: TWidgetTitleBarPortal = {
    onAction: (_id, handler) => { action = handler; return () => { action = () => undefined } },
    setActionState: (_id, state) => states.push(state),
  }
  const current = args.current ?? detail()
  const detailResponses = args.detailResponses ?? [current]
  let detailResponseIndex = 0
  let publicationCommitted = false
  const detailApi = vi.fn(async () => {
    if (publicationCommitted) {
      return [
        undefined,
        args.authoritativeDetail === undefined
          ? authoritativePublicationDetail(current)
          : args.authoritativeDetail,
      ] as const
    }
    const response = detailResponses[Math.min(detailResponseIndex, detailResponses.length - 1)]!
    detailResponseIndex += 1
    return [undefined, response] as const
  })
  const publish = vi.fn(async () => {
    await args.publishDelay
    const result = args.publishResult ?? {
    published: true,
    draftId: DRAFT_ID,
    definitionId: "20000000-0000-4000-8000-000000000001",
    revision: current.variant.revision,
    publishedRevisionId: "30000000-0000-4000-8000-000000000001",
    manifest: {
      schemaVersion: 3,
      name: "Weather",
      slug: "weather",
      ui: {
        runtime: "capsule",
        entry: "ui/main.ts",
        apis: ["DOM"],
      },
    },
    }
    if (typeof result === "object" && result !== null && "published" in result && result.published === true) {
      publicationCommitted = true
    }
    return [undefined, result] as const
  })
  const published = vi.fn(async () => undefined)
  const createIdempotencyKey = vi.fn(() => "publication-attempt-1")
  const dispose = mountWidgetPublicationDialog({
    document,
    api: {
      ...(args.events ? { events: args.events } : {}),
      widgets: { detail: detailApi },
      widgetPublish: { publish },
    } as never,
    draftId: DRAFT_ID,
    draftName: "Weather",
    createIdempotencyKey,
    getPreviewSelection: args.getPreviewSelection ?? (() =>
      args.previewSelection === undefined
        ? PREVIEW_SELECTION
        : args.previewSelection),
    titleBar,
    onPublished: published,
  })
  return {
    invokeAction: () => action(),
    states,
    detailApi,
    publish,
    published,
    createIdempotencyKey,
    dispose,
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("mounted publication coordinator", () => {
  test("requires a title action click and confirmation before publishing the current revision", async () => {
    const mounted = setup()
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({ disabled: false, label: "Publish" }))
    expect(mounted.publish).not.toHaveBeenCalled()

    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Publish Weather board?"))
    expect(document.body.textContent).not.toContain("Expected draft revision")
    expect(document.body.textContent).toContain("Current source at Publish time")
    expect(mounted.publish).not.toHaveBeenCalled()
    button("Publish current draft")?.click()

    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledWith({
      idempotencyKey: "publication-attempt-1",
      draftId: DRAFT_ID,
      previewId: PREVIEW_SELECTION.previewId,
      canvasId: PREVIEW_SELECTION.canvasId,
      frameNodeId: PREVIEW_SELECTION.frameNodeId,
    }))
    await vi.waitFor(() => expect(mounted.published).toHaveBeenCalledOnce())
    expect(document.body.textContent).toContain("Widget published")
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({ label: "Republish" }))
    mounted.dispose()
  })

  test("uses authoritative published-sibling copy and leaves a failed result open", async () => {
    const mounted = setup({
      current: detail({ published: true }),
      publishResult: {
        published: false,
        draftId: "Weather",
        reason: "validation-failed",
        message: "The draft is invalid.",
        errors: ["Missing widget state"],
        warnings: [],
      },
    })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({ disabled: false, label: "Republish" }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("remain pinned to their current revision"))
    expect(document.body.textContent).toContain("Republish Weather board?")
    button("Republish current draft")?.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Draft validation failed"))
    expect(document.body.textContent).toContain("Missing widget state")
    expect(button("Cancel")).toBeDefined()
    expect(mounted.published).not.toHaveBeenCalled()
    mounted.dispose()
  })

  test("reuses one idempotency key when a lost publication response is retried", async () => {
    const mounted = setup()
    mounted.publish.mockRejectedValueOnce(new Error("connection lost"))
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.invokeAction()
    await vi.waitFor(() => {
      expect(button("Publish current draft")).toBeDefined()
      expect(button("Publish current draft")?.disabled).toBe(false)
    })

    button("Publish current draft")?.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("connection lost"))
    expect(mounted.publish).toHaveBeenCalledOnce()

    button("Publish current draft")?.click()
    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledTimes(2))
    expect(mounted.publish.mock.calls[0]?.[0].idempotencyKey)
      .toBe("publication-attempt-1")
    expect(mounted.publish.mock.calls[1]?.[0].idempotencyKey)
      .toBe("publication-attempt-1")
    expect(mounted.createIdempotencyKey).toHaveBeenCalledOnce()
    mounted.dispose()
  })

  test("fails closed when the loaded detail belongs to another draft", async () => {
    const current = detail()
    const mounted = setup({
      current: {
        ...current,
        variant: { ...current.variant, draftId: "10000000-0000-4000-8000-000000000002" },
      },
    })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({
      disabled: true,
      label: "Preview unavailable",
    }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Widget draft identity changed"))
    expect(button("Needs Preview frame")?.disabled).toBe(true)
    expect(mounted.publish).not.toHaveBeenCalled()
    mounted.dispose()
  })

  test("does not freeze the loaded draft revision into the publication request", async () => {
    const current = detail()
    const mismatched = {
      ...current,
      variant: { ...current.variant, draftId: "10000000-0000-4000-8000-000000000002" },
    }
    const mounted = setup({
      current,
      detailResponses: [current, current, mismatched],
    })
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Publish Weather board?"))
    button("Publish current draft")?.click()
    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledOnce())
    expect(mounted.publish.mock.calls[0]?.[0]).not.toHaveProperty("expectedRevision")
    mounted.dispose()
  })

  test("reports authoritative published metadata when source advances during publication", async () => {
    const current = detail({ revision: "rev-before-confirmation" })
    const publishedBase = authoritativePublicationDetail(
      current,
      "rev-published-current-source",
    )
    const published = {
      ...publishedBase,
      variant: { ...publishedBase.variant, displayName: "Current weather board" },
    }
    const mounted = setup({
      current,
      authoritativeDetail: published,
      publishResult: {
        published: true,
        draftId: DRAFT_ID,
        definitionId: "20000000-0000-4000-8000-000000000001",
        revision: published.variant.revision,
        publishedRevisionId: "30000000-0000-4000-8000-000000000001",
        manifest: {
          schemaVersion: 3,
          name: "Weather",
          slug: "weather",
          displayName: "Current weather board",
          ui: { runtime: "capsule", entry: "ui/main.ts", apis: ["DOM"] },
        },
      },
    })
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.invokeAction()
    const confirm = await vi.waitFor(() => {
      const currentButton = button("Publish current draft")
      expect(currentButton).toBeDefined()
      expect(currentButton?.disabled).toBe(false)
      return currentButton!
    })
    confirm.click()

    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(document.body.textContent).toContain("Widget published"))
    await vi.waitFor(() => expect(mounted.published).toHaveBeenCalledOnce())
    expect(mounted.published.mock.calls[0]?.[0].detail).toEqual(published)
    mounted.dispose()
  })

  test("keeps the title-bar publication action disabled without an exact ready Preview", async () => {
    const mounted = setup({ previewSelection: null })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({
      disabled: true,
      label: "Preview unavailable",
    }))
    mounted.invokeAction()
    expect(mounted.publish).not.toHaveBeenCalled()
    mounted.dispose()
  })

  test("keeps publication available when frame metadata refreshes before confirmation", async () => {
    let selection = PREVIEW_SELECTION
    const mounted = setup({ getPreviewSelection: () => selection })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({
      disabled: false,
      label: "Publish",
    }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Current source at Publish time"))
    const confirm = await vi.waitFor(() => {
      const current = button("Publish current draft")
      expect(current).toBeDefined()
      expect(current?.disabled).toBe(false)
      return current!
    })
    selection = {
      ...selection,
      label: "Renamed frame",
    }
    confirm.click()

    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledOnce())
    mounted.dispose()
  })

  test("shows only the selected owner's live publication phase", async () => {
    let releasePublish!: () => void
    const publishDelay = new Promise<void>((resolve) => { releasePublish = resolve })
    const queued: unknown[] = []
    let wake: (() => void) | undefined
    const stream = {
      [Symbol.asyncIterator]() {
        let closed = false
        return {
          async next() {
            while (!closed && queued.length === 0) {
              await new Promise<void>((resolve) => { wake = resolve })
            }
            return closed
              ? { done: true as const, value: undefined }
              : { done: false as const, value: queued.shift() }
          },
          async return() {
            closed = true
            wake?.()
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    const events = vi.fn(async () => [undefined, stream] as const)
    const push = (value: unknown) => {
      queued.push(value)
      wake?.()
      wake = undefined
    }
    const mounted = setup({ events, publishDelay })
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.invokeAction()
    await vi.waitFor(() => {
      expect(button("Publish current draft")).toBeDefined()
      expect(button("Publish current draft")?.disabled).toBe(false)
    })
    button("Publish current draft")?.click()
    await vi.waitFor(() => expect(events).toHaveBeenCalledOnce())

    push({
      kind: "widget-preview",
      type: "progress",
      previewId: "another-preview",
      phase: "validating",
    })
    push({
      kind: "widget-preview",
      type: "progress",
      previewId: PREVIEW_SELECTION.previewId,
      phase: "installing",
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain("Installing current draft…"))

    releasePublish()
    await vi.waitFor(() => expect(mounted.published).toHaveBeenCalledOnce())
    mounted.dispose()
  })

  test("cleans up the action handler and dialog host", async () => {
    const mounted = setup()
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.dispose()
    mounted.invokeAction()
    expect(document.querySelector("[data-widget-publication-dialog-for='Weather']")).toBeNull()
  })
})

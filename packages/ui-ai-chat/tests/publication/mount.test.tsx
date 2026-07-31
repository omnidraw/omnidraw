import type { TWidgetDetail } from "@omnidraw/orpc-client"
import { afterEach, describe, expect, test, vi } from "vitest"
import { mountWidgetPublicationDialog } from "../../src/publication/mount"
import type { TWidgetPublicationPreviewSelection } from "../../src/publication/interface"
import type { TWidgetTitleBarActionState, TWidgetTitleBarPortal } from "../../src/widget/interface"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"
const PREVIEW_SELECTION: TWidgetPublicationPreviewSelection = {
  previewId: "40000000-0000-4000-8000-000000000001",
  previewRevisionId: "preview-revision-1",
  expectedBindingRevision: 3,
  expectedBindingPlanDigestSha256: "a".repeat(64),
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

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)
}

function setup(args: {
  pinnedRevision?: string
  current?: TWidgetDetail
  detailResponses?: readonly TWidgetDetail[]
  previewSelection?: TWidgetPublicationPreviewSelection | null
  getPreviewSelection?: () => TWidgetPublicationPreviewSelection | null
  publishResult?: unknown
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
  const detailApi = vi.fn(async () => {
    const response = detailResponses[Math.min(detailResponseIndex, detailResponses.length - 1)]!
    detailResponseIndex += 1
    return [undefined, response] as const
  })
  const publish = vi.fn(async () => [undefined, args.publishResult ?? {
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
  }] as const)
  const refreshPreview = vi.fn(async () => undefined)
  const published = vi.fn(async () => undefined)
  const createIdempotencyKey = vi.fn(() => "publication-attempt-1")
  const dispose = mountWidgetPublicationDialog({
    document,
    api: { widgets: { detail: detailApi }, widgetPublish: { publish } } as never,
    draftId: DRAFT_ID,
    draftName: "Weather",
    createIdempotencyKey,
    getPinnedRevision: () => args.pinnedRevision ?? current.variant.revision,
    getPreviewSelection: args.getPreviewSelection ?? (() =>
      args.previewSelection === undefined
        ? PREVIEW_SELECTION
        : args.previewSelection),
    titleBar,
    onPublished: published,
    onRequestPreviewRefresh: refreshPreview,
  })
  return {
    invokeAction: () => action(),
    states,
    detailApi,
    publish,
    published,
    refreshPreview,
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
    expect(document.body.textContent).toContain("Draft digest rev-2")
    expect(mounted.publish).not.toHaveBeenCalled()
    button("Publish")?.click()

    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledWith({
      idempotencyKey: "publication-attempt-1",
      draftId: DRAFT_ID,
      expectedRevision: "rev-2",
      previewId: PREVIEW_SELECTION.previewId,
      previewRevisionId: PREVIEW_SELECTION.previewRevisionId,
      expectedBindingRevision: PREVIEW_SELECTION.expectedBindingRevision,
      expectedBindingPlanDigestSha256:
        PREVIEW_SELECTION.expectedBindingPlanDigestSha256,
      canvasId: PREVIEW_SELECTION.canvasId,
      frameNodeId: PREVIEW_SELECTION.frameNodeId,
    }))
    expect(mounted.published).toHaveBeenCalledOnce()
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
    button("Republish")?.click()
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
      expect(button("Publish")).toBeDefined()
      expect(button("Publish")?.disabled).toBe(false)
    })

    button("Publish")?.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("connection lost"))
    expect(mounted.publish).toHaveBeenCalledOnce()

    button("Publish")?.click()
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
      label: "Preview not ready",
    }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Widget draft identity changed"))
    expect(button("Needs Preview")?.disabled).toBe(true)
    expect(mounted.publish).not.toHaveBeenCalled()
    mounted.dispose()
  })

  test("rechecks exact draft identity immediately before submission", async () => {
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
    button("Publish")?.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Draft identity changed before publication"))
    expect(mounted.publish).not.toHaveBeenCalled()
    expect(button("Publish")?.disabled).toBe(true)
    mounted.dispose()
  })

  test("blocks a stale pinned Preview until the user refreshes and reconfirms", async () => {
    const mounted = setup({ pinnedRevision: "rev-1", current: detail({ revision: "rev-2" }) })
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Preview revision is stale"))
    expect(button("Publish")).toBeUndefined()
    button("Refresh Preview")?.click()
    await vi.waitFor(() => expect(mounted.refreshPreview).toHaveBeenCalledOnce())
    expect(mounted.publish).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Preview revision is stale"))
    mounted.dispose()
  })

  test("keeps the title-bar publication action disabled without an exact ready Preview", async () => {
    const mounted = setup({ previewSelection: null })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({
      disabled: true,
      label: "Preview not ready",
    }))
    mounted.invokeAction()
    expect(mounted.publish).not.toHaveBeenCalled()
    mounted.dispose()
  })

  test("rechecks the exact binding plan and fails closed when it advances before confirmation", async () => {
    let selection = PREVIEW_SELECTION
    const mounted = setup({ getPreviewSelection: () => selection })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({
      disabled: false,
      label: "Publish",
    }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("binding revision 3"))
    const confirm = await vi.waitFor(() => {
      const current = button("Publish")
      expect(current).toBeDefined()
      expect(current?.disabled).toBe(false)
      return current!
    })
    selection = {
      ...selection,
      expectedBindingPlanDigestSha256: "b".repeat(64),
    }
    confirm.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain("Preview changed before publication"))
    expect(document.body.textContent).toContain("binding plan bbbbbbbbbbbb")
    expect(mounted.publish).not.toHaveBeenCalled()
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

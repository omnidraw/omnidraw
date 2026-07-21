import type { TWidgetDetail } from "@vibecanvas/orpc-client"
import { afterEach, describe, expect, test, vi } from "vitest"
import { mountWidgetPublicationDialog } from "../../src/publication/mount"
import type { TWidgetTitleBarActionState, TWidgetTitleBarPortal } from "../../src/widget/interface"

function detail(args: { revision?: string; published?: boolean } = {}): TWidgetDetail {
  const variant: TWidgetDetail["variant"] = {
    source: "draft",
    displayName: "Weather board",
    kind: "actor-widget",
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
    sibling: args.published ? { ...variant, source: "published" } : null,
    manifest: null,
    problem: null,
    variant,
  }
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)
}

function setup(args: { pinnedRevision?: string; current?: TWidgetDetail; publishResult?: unknown } = {}) {
  let action = () => undefined
  const states: TWidgetTitleBarActionState[] = []
  const titleBar: TWidgetTitleBarPortal = {
    onAction: (_id, handler) => { action = handler; return () => { action = () => undefined } },
    setActionState: (_id, state) => states.push(state),
  }
  const current = args.current ?? detail()
  const detailApi = vi.fn(async () => [undefined, current] as const)
  const publish = vi.fn(async () => [undefined, args.publishResult ?? {
    published: true,
    draftId: "Weather",
    revision: current.variant.revision,
    definitionName: "Weather",
    manifest: {},
  }] as const)
  const refreshPreview = vi.fn(async () => undefined)
  const published = vi.fn(async () => undefined)
  const dispose = mountWidgetPublicationDialog({
    document,
    api: { widgets: { detail: detailApi }, widgetPublish: { publish } } as never,
    draftId: "Weather",
    getPinnedRevision: () => args.pinnedRevision ?? current.variant.revision,
    titleBar,
    onPublished: published,
    onRequestPreviewRefresh: refreshPreview,
  })
  return { invokeAction: () => action(), states, detailApi, publish, published, refreshPreview, dispose }
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
    expect(document.body.textContent).not.toContain("rev-2")
    expect(mounted.publish).not.toHaveBeenCalled()
    button("Publish")?.click()

    await vi.waitFor(() => expect(mounted.publish).toHaveBeenCalledWith({ draftId: "Weather", expectedRevision: "rev-2" }))
    expect(mounted.published).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain("Widget published")
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
        errors: ["Missing actor state"],
        warnings: [],
      },
    })
    await vi.waitFor(() => expect(mounted.states.at(-1)).toMatchObject({ disabled: false, label: "Republish" }))
    mounted.invokeAction()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Every existing canvas instance"))
    expect(document.body.textContent).toContain("Republish Weather board?")
    button("Republish")?.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Draft validation failed"))
    expect(document.body.textContent).toContain("Missing actor state")
    expect(button("Cancel")).toBeDefined()
    expect(mounted.published).not.toHaveBeenCalled()
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

  test("cleans up the action handler and dialog host", async () => {
    const mounted = setup()
    await vi.waitFor(() => expect(mounted.states.at(-1)?.disabled).toBe(false))
    mounted.dispose()
    mounted.invokeAction()
    expect(document.querySelector("[data-widget-publication-dialog-for='Weather']")).toBeNull()
  })
})

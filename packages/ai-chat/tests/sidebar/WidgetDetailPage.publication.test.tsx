import type { TWidgetCatalog, TWidgetDetail, TWidgetVariantSummary } from "@vibecanvas/orpc-client"
import { render } from "solid-js/web"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createCatalogInvalidation } from "../../src/sidebar/ports"
import { WidgetCatalogProvider } from "../../src/sidebar/widgets/WidgetCatalogProvider"
import { WidgetDetailPage } from "../../src/sidebar/widgets/WidgetDetailPage"

let dispose: (() => void) | undefined

const variant: TWidgetVariantSummary = {
  source: "draft",
  displayName: "Blobby",
  kind: "actor-widget",
  slug: "blobby",
  description: "A test widget.",
  revision: "draft-revision",
  contentFingerprint: "draft-fingerprint",
  updatedAt: null,
  tool: { label: "Blobby", icon: null, group: null, priority: null, behaviorType: "mode" },
  validation: { status: "valid", errors: [], warnings: [], validatedRevision: "draft-revision" },
  placement: null,
}

const detail: TWidgetDetail = {
  name: "Blobby",
  source: "draft",
  relation: "draft-only",
  sibling: null,
  manifest: null,
  problem: null,
  variant,
}

const catalog: TWidgetCatalog = {
  generation: "draft-generation",
  groups: [],
  widgets: [{ name: "Blobby", relation: "draft-only", published: null, draft: variant, problem: null }],
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe("WidgetDetailPage publication", () => {
  test("refreshes the catalog and replaces the consumed draft route with published detail", async () => {
    const navigate = vi.fn()
    const refreshCatalog = vi.fn(async () => [undefined, catalog] as const)
    const publish = vi.fn(async () => [undefined, {
      published: true,
      draftId: "Blobby",
      revision: "draft-revision",
      definitionName: "Blobby",
      manifest: {},
    }] as const)
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [undefined, { async *[Symbol.asyncIterator]() {} }]),
            widgets: {
              catalog: refreshCatalog,
              detail: vi.fn(async () => [undefined, detail] as const),
            },
            widgetPublish: { publish },
          },
        },
      },
      invalidation: createCatalogInvalidation(),
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      application: {
        pathname: () => "/widgets/draft/Blobby",
        navigate,
        notifySuccess: vi.fn(),
        notifyError: vi.fn(),
        toggleSidebar: vi.fn(),
      },
    } as never
    const query = {
      tab: () => "overview",
      path: () => undefined,
      set: vi.fn(),
    } as never
    const host = document.createElement("div")
    document.body.appendChild(host)
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetDetailPage source="draft" name="Blobby" controller={controller} query={query} />
      </WidgetCatalogProvider>
    ), host)

    const openPublish = await vi.waitFor(() => {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent === "Publish")
      expect(button).toBeDefined()
      return button!
    })
    openPublish.click()
    const confirm = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
        .find((candidate) => candidate.textContent === "Publish")
      expect(button).toBeDefined()
      expect(button?.disabled).toBe(false)
      return button!
    })
    confirm.click()

    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({ draftId: "Blobby", expectedRevision: "draft-revision" }))
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/widgets/published/Blobby?tab=overview", { replace: true }))
    expect(refreshCatalog.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

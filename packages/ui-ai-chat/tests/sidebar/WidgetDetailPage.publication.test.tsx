import type { TWidgetCatalog, TWidgetDetail, TWidgetVariantSummary } from "@vibecanvas/orpc-client"
import { render } from "solid-js/web"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createCatalogInvalidation } from "../../src/sidebar/ports"
import { WidgetCatalogProvider } from "../../src/sidebar/widgets/WidgetCatalogProvider"
import { WidgetDetailPage } from "../../src/sidebar/widgets/WidgetDetailPage"

let dispose: (() => void) | undefined

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"

const variant: TWidgetVariantSummary = {
  draftId: DRAFT_ID,
  source: "draft",
  displayName: "Blobby",
  kind: "notes-widget",
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
  functions: [],
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
  test("shows a stable recovery action instead of checking forever when draft identity is missing", async () => {
    const orphanDetail: TWidgetDetail = {
      ...detail,
      problem: {
        code: "DRAFT_IDENTITY_UNAVAILABLE",
        message: "Validate this widget again from its owning AI chat before publishing or placing it.",
      },
      variant: {
        ...variant,
        draftId: null,
        validation: null,
      },
    }
    const orphanCatalog: TWidgetCatalog = {
      ...catalog,
      widgets: [{
        ...catalog.widgets[0]!,
        draft: orphanDetail.variant,
        problem: orphanDetail.problem,
      }],
    }
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [undefined, { async *[Symbol.asyncIterator]() {} }]),
            widgets: {
              catalog: vi.fn(async () => [undefined, orphanCatalog] as const),
              detail: vi.fn(async () => [undefined, orphanDetail] as const),
            },
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
        navigate: vi.fn(),
        notifySuccess: vi.fn(),
        notifyError: vi.fn(),
        toggleSidebar: vi.fn(),
      },
    } as never
    const host = document.createElement("div")
    document.body.appendChild(host)
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetDetailPage
          source="draft"
          name="Blobby"
          controller={controller}
          query={{ tab: () => "overview", path: () => undefined, set: vi.fn() } as never}
        />
      </WidgetCatalogProvider>
    ), host)

    const recovery = await vi.waitFor(() => {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent === "Needs validation")
      expect(button).toBeDefined()
      return button!
    })
    expect(recovery.disabled).toBe(true)
    expect(recovery.title).toBe("Validate this widget again from its owning AI chat before publishing.")
    expect(host.textContent).not.toContain("Checking…")
  })

  test("refreshes the catalog and replaces the consumed draft route with published detail", async () => {
    const navigate = vi.fn()
    const refreshCatalog = vi.fn(async () => [undefined, catalog] as const)
    const detailApi = vi.fn(async () => [undefined, detail] as const)
    const publish = vi.fn(async () => [undefined, {
      published: true,
      draftId: DRAFT_ID,
      definitionId: "20000000-0000-4000-8000-000000000001",
      revision: "draft-revision",
      publishedRevisionId: "30000000-0000-4000-8000-000000000001",
      manifest: {
        schemaVersion: 3,
        name: "Blobby",
        slug: "blobby",
        ui: {
          runtime: "capsule",
          entry: "ui/main.ts",
          target: {
            runtimeAbi: "quickjs-release-sync-v1",
            domProfile: "dom-core-v2",
            featureProfiles: [],
          },
        },
      },
    }] as const)
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [undefined, { async *[Symbol.asyncIterator]() {} }]),
            widgets: {
              catalog: refreshCatalog,
              detail: detailApi,
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

    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({ draftId: DRAFT_ID, expectedRevision: "draft-revision" }))
    expect(detailApi).toHaveBeenCalledWith({ name: "Blobby", source: "draft" })
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/widgets/published/Blobby?tab=overview", { replace: true }))
    expect(refreshCatalog.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test("describes published deletion as archival and keeps pinned canvas instances", async () => {
    const publishedVariant: TWidgetVariantSummary = {
      ...variant,
      draftId: null,
      source: "published",
      kind: "widget",
      revision: "30000000-0000-4000-8000-000000000001",
      validation: null,
    }
    const publishedDetail: TWidgetDetail = {
      ...detail,
      source: "published",
      relation: "published-only",
      variant: publishedVariant,
      manifest: {
        schemaVersion: 3,
        name: "Blobby",
        slug: "blobby",
        ui: {
          runtime: "capsule",
          entry: "ui/main.ts",
          target: {
            runtimeAbi: "quickjs-release-sync-v1",
            domProfile: "dom-core-v2",
            featureProfiles: [],
          },
        },
      },
    }
    const publishedCatalog: TWidgetCatalog = {
      generation: "published-generation",
      groups: [],
      widgets: [{
        name: "Blobby",
        relation: "published-only",
        published: publishedVariant,
        draft: null,
        problem: null,
      }],
    }
    const remove = vi.fn(async () => [undefined, {
      name: "Blobby",
      source: "published",
      deletedDefinition: true,
      deletedPublished: true,
      deletedDraft: true,
      deletedInstances: false,
      issues: [],
    }] as const)
    const notifySuccess = vi.fn()
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [undefined, { async *[Symbol.asyncIterator]() {} }]),
            widgets: {
              catalog: vi.fn(async () => [undefined, publishedCatalog] as const),
              detail: vi.fn(async () => [undefined, publishedDetail] as const),
              delete: remove,
            },
          },
        },
      },
      invalidation: createCatalogInvalidation(),
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      application: {
        pathname: () => "/widgets/published/Blobby",
        navigate: vi.fn(),
        notifySuccess,
        notifyError: vi.fn(),
        toggleSidebar: vi.fn(),
      },
    } as never
    const host = document.createElement("div")
    document.body.appendChild(host)
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetDetailPage
          source="published"
          name="Blobby"
          controller={controller}
          query={{ tab: () => "overview", path: () => undefined, set: vi.fn() } as never}
        />
      </WidgetCatalogProvider>
    ), host)

    const archive = await vi.waitFor(() => {
      expect(host.textContent).toContain("Existing canvas instances stay pinned")
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent?.includes("Archive publication"))
      expect(button).toBeDefined()
      return button!
    })
    archive.click()
    const confirm = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
        .find((candidate) => candidate.textContent === "Archive publication")
      expect(button).toBeDefined()
      return button!
    })
    confirm.click()

    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith({ name: "Blobby", source: "published" }))
    expect(notifySuccess).toHaveBeenCalledWith("Published widget archived")
  })
})

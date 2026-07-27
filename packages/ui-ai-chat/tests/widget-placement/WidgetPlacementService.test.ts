import { describe, expect, test, vi } from "vitest"
import { WidgetPlacementService } from "../../src/widget-placement/WidgetPlacementService"

const DEFINITION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7"
const DRAFT_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2"
const DRAFT_REVISION = "d".repeat(64)

function serviceFixture() {
  const resolvePlacement = vi.fn(async () => [undefined, {
    ok: true as const,
    descriptor: {
      kind: "preview" as const,
      draftId: DRAFT_ID,
      reference: { source: "draft" as const, name: "Weather", revision: DRAFT_REVISION },
      bounds: { width: 420, height: 300 },
      definitionId: null,
      revisionId: null,
      definitionName: null,
      definitionSlug: null,
    },
  }] as const)
  const detail = vi.fn(async () => [undefined, {
    name: "Weather",
    source: "draft" as const,
    variant: {
      source: "draft" as const,
      draftId: DRAFT_ID,
      revision: DRAFT_REVISION,
      validation: {
        status: "valid" as const,
        errors: [],
        warnings: [],
        validatedRevision: DRAFT_REVISION,
      },
    },
  }] as const)
  const placeWidgetInstance = vi.fn()
  const placePreview = vi.fn(async () => undefined)
  const resolveWorldBounds = vi.fn(() => ({ x: 40, y: 50, width: 420, height: 300 }))
  const showError = vi.fn()
  const service = new WidgetPlacementService({
    api: { api: { agent: { widgets: { detail, resolvePlacement } } } } as never,
    browser: {} as never,
    coordinator: { register: vi.fn(() => () => undefined) } as never,
    dropPlacement: { resolveWorldBounds } as never,
    previewFrames: { place: placePreview } as never,
    widgetManager: { placeWidgetInstance } as never,
  })
  service.start({ config: { notification: { showError } } } as never)
  return { service, detail, resolvePlacement, placeWidgetInstance, placePreview, showError }
}

describe("WidgetPlacementService", () => {
  test("places an immutable published revision directly from its catalog identity", () => {
    const fixture = serviceFixture()
    const reference = {
      source: "published" as const,
      name: `published:${DEFINITION_ID}`,
      revision: REVISION_ID,
    }
    fixture.service.createDropRequest({
      reference,
      bounds: { width: 420, height: 300 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 420, height: 300 },
      clientPoint: { x: 10, y: 20 },
    })

    expect(fixture.placeWidgetInstance).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    })
    expect(fixture.resolvePlacement).not.toHaveBeenCalled()
  })

  test("resolves a draft owner and places a stateless Preview frame", async () => {
    const fixture = serviceFixture()
    const reference = { source: "draft" as const, name: "Weather", revision: DRAFT_REVISION }
    await fixture.service.createDropRequest({
      reference,
      bounds: { width: 420, height: 300 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 420, height: 300 },
      clientPoint: { x: 10, y: 20 },
    })

    await vi.waitFor(() => expect(fixture.placePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      expectedRevision: DRAFT_REVISION,
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    }))
    expect(fixture.resolvePlacement).toHaveBeenCalledWith({
      reference,
      expectedDraftId: DRAFT_ID,
    })
  })

  test("explains that a filesystem-only orphan must be validated instead of resolving placement", async () => {
    const fixture = serviceFixture()
    fixture.detail.mockResolvedValueOnce([undefined, {
      name: "Weather",
      source: "draft",
      variant: { source: "draft", draftId: null, revision: DRAFT_REVISION },
    }] as never)
    const reference = { source: "draft" as const, name: "Weather", revision: DRAFT_REVISION }

    await fixture.service.createDropRequest({
      reference,
      bounds: { width: 420, height: 300 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 420, height: 300 },
      clientPoint: { x: 10, y: 20 },
    })

    expect(fixture.resolvePlacement).not.toHaveBeenCalled()
    expect(fixture.placePreview).not.toHaveBeenCalled()
    expect(fixture.showError).toHaveBeenCalledWith(
      "Widget placement failed",
      "Validate this widget again from its owning AI chat before placing it.",
    )
  })

  test("does not resolve placement for a revision whose trusted UI build is invalid", async () => {
    const fixture = serviceFixture()
    fixture.detail.mockResolvedValueOnce([undefined, {
      name: "Weather",
      source: "draft",
      variant: {
        source: "draft",
        draftId: DRAFT_ID,
        revision: DRAFT_REVISION,
        validation: {
          status: "invalid",
          errors: ["Widget ui build failed."],
          warnings: [],
          validatedRevision: DRAFT_REVISION,
        },
      },
    }] as never)
    const reference = { source: "draft" as const, name: "Weather", revision: DRAFT_REVISION }

    await fixture.service.createDropRequest({
      reference,
      bounds: { width: 420, height: 300 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 420, height: 300 },
      clientPoint: { x: 10, y: 20 },
    })

    expect(fixture.resolvePlacement).not.toHaveBeenCalled()
    expect(fixture.placePreview).not.toHaveBeenCalled()
    expect(fixture.showError).toHaveBeenCalledWith(
      "Widget placement failed",
      "This widget cannot be placed because its current UI build is invalid.",
    )
  })
})

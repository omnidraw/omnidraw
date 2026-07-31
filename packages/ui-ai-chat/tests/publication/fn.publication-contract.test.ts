import type { TWidgetDetail } from "@omnidraw/orpc-client"
import { describe, expect, test } from "vitest"
import {
  fnIsExactPublicationDraftDetail,
  fnPublicationContract,
  fnPublicationFailureTitle,
} from "../../src/publication/fn.publication-contract"

function detail(sibling: TWidgetDetail["sibling"]): TWidgetDetail {
  return {
    name: "Weather",
    source: "draft",
    relation: sibling ? "different" : "draft-only",
    sibling,
    manifest: null,
    problem: null,
    variant: {
      draftId: "10000000-0000-4000-8000-000000000001",
      source: "draft",
      displayName: "Weather board",
      kind: "notes-widget",
      slug: "weather",
      description: null,
      revision: "rev-current",
      contentFingerprint: null,
      updatedAt: null,
      tool: { label: "Weather", icon: null, group: null, priority: null, behaviorType: "action" },
      validation: null,
    },
  }
}

describe("publication contract", () => {
  test("explains first publication without an existing-instance warning", () => {
    const contract = fnPublicationContract(detail(null))
    expect(contract.isUpdate).toBe(false)
    expect(contract.actionLabel).toBe("Publish")
    expect(contract.description).toContain("sidebar")
    expect(contract.description).not.toContain("existing canvas instance")
  })

  test("explains that existing instances stay pinned across republishing", () => {
    const published = { ...detail(null).variant, draftId: null, source: "published" as const }
    const contract = fnPublicationContract(detail(published))
    expect(contract.isUpdate).toBe(true)
    expect(contract.actionLabel).toBe("Republish")
    expect(contract.title).toBe("Republish Weather board?")
    expect(contract.description).toContain("remain pinned to their current revision")
    expect(contract.description).toContain("explicit remount or runtime policy")
    expect(contract.description).not.toContain("will reload")
  })

  test("binds publication detail to the exact draft identity", () => {
    const current = detail(null)
    expect(fnIsExactPublicationDraftDetail(current, {
      draftId: current.variant.draftId!,
      draftName: current.name,
    })).toBe(true)
    expect(fnIsExactPublicationDraftDetail({
      ...current,
      variant: { ...current.variant, draftId: "10000000-0000-4000-8000-000000000002" },
    }, {
      draftId: current.variant.draftId!,
      draftName: current.name,
    })).toBe(false)
  })

  test("keeps result reasons distinguishable", () => {
    expect(fnPublicationFailureTitle("validation-failed")).toBe("Draft validation failed")
    expect(fnPublicationFailureTitle("resource-binding-invalid")).toBe("Resource bindings are invalid")
    expect(fnPublicationFailureTitle("publication-conflict")).toBe("Widget publication conflicted")
  })
})

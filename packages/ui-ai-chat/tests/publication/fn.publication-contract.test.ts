import type { TWidgetDetail } from "@vibecanvas/orpc-client"
import { describe, expect, test } from "vitest"
import { fnPublicationContract, fnPublicationFailureTitle } from "../../src/publication/fn.publication-contract"

function detail(sibling: TWidgetDetail["sibling"]): TWidgetDetail {
  return {
    name: "Weather",
    source: "draft",
    relation: sibling ? "different" : "draft-only",
    sibling,
    manifest: null,
    problem: null,
    variant: {
      source: "draft",
      displayName: "Weather board",
      kind: "actor-widget",
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
    expect(contract.description).toContain("canvas toolbar")
    expect(contract.description).not.toContain("existing canvas instance")
  })

  test("warns that republishing updates existing instances while preserving their data", () => {
    const published = { ...detail(null).variant, source: "published" as const }
    const contract = fnPublicationContract(detail(published))
    expect(contract.isUpdate).toBe(true)
    expect(contract.actionLabel).toBe("Republish")
    expect(contract.title).toBe("Republish Weather board?")
    expect(contract.description).toContain("Every existing canvas instance")
    expect(contract.description).toContain("preserving its instance identity and data")
  })

  test("keeps result reasons distinguishable", () => {
    expect(fnPublicationFailureTitle("validation-failed")).toBe("Draft validation failed")
    expect(fnPublicationFailureTitle("permission-failed")).toBe("Publication permission denied")
    expect(fnPublicationFailureTitle("recovery-failed")).toBe("Publication recovery failed")
  })
})

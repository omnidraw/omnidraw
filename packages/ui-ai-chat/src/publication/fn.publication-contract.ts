import type { TWidgetDetail } from "@vibecanvas/orpc-client"

export type TPublicationContract = {
  displayName: string
  isUpdate: boolean
  actionLabel: "Publish" | "Republish"
  title: string
  description: string
}

export function fnIsExactPublicationDraftDetail(
  detail: TWidgetDetail | null | undefined,
  expected: Readonly<{ draftId: string; draftName: string }>,
): detail is TWidgetDetail {
  return detail?.name === expected.draftName
    && detail.source === "draft"
    && detail.variant.source === "draft"
    && detail.variant.draftId === expected.draftId
}

export function fnPublicationContract(detail: TWidgetDetail): TPublicationContract {
  const displayName = detail.variant.displayName
  const isUpdate = detail.sibling?.source === "published"
  return {
    displayName,
    isUpdate,
    actionLabel: isUpdate ? "Republish" : "Publish",
    title: isUpdate ? `Republish ${displayName}?` : `Publish ${displayName}?`,
    description: isUpdate
      ? `Validation will run before a new immutable revision becomes the published default. Existing canvas instances remain pinned to their current revision until an explicit remount or runtime policy advances them, preserving their instance identity and data.`
      : `Validation will run first. If it passes, this draft will become a published widget definition available from the canvas toolbar.`,
  }
}

export function fnPublicationFailureTitle(reason: string): string {
  if (reason === "stale-revision") return "Draft changed before publication"
  if (reason === "validation-failed") return "Draft validation failed"
  if (reason === "resource-binding-invalid") return "Resource bindings are invalid"
  if (reason === "publication-conflict") return "Widget publication conflicted"
  if (reason === "publication-failed") return "Widget publication failed"
  if (reason === "not-found") return "Widget draft not found"
  return "Could not publish widget"
}

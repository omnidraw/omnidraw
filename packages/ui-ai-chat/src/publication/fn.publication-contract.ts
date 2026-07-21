import type { TWidgetDetail } from "@vibecanvas/orpc-client"

export type TPublicationContract = {
  displayName: string
  isUpdate: boolean
  actionLabel: "Publish" | "Republish"
  title: string
  description: string
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
      ? `Validation will run before the existing published widget definition is replaced. Every existing canvas instance will reload with the new definition while preserving its instance identity and data.`
      : `Validation will run first. If it passes, this draft will become a published widget definition available from the canvas toolbar.`,
  }
}

export function fnPublicationFailureTitle(reason: string): string {
  if (reason === "stale-revision") return "Draft changed before publication"
  if (reason === "validation-failed") return "Draft validation failed"
  if (reason === "permission-failed") return "Publication permission denied"
  if (reason === "recovery-failed") return "Publication recovery failed"
  if (reason === "publication-failed") return "Widget publication failed"
  if (reason === "not-found") return "Widget draft not found"
  return "Could not publish widget"
}

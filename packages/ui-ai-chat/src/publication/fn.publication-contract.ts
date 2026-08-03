import type { TWidgetDetail } from "@omnidraw/orpc-client"
import type { TWidgetPublicationPhase } from "./interface"

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
      ? `The current draft will be built and validated before a new immutable revision becomes the published default. Existing canvas instances remain pinned to their current revision until an explicit remount or runtime policy advances them, preserving their instance identity and data.`
      : `The current draft will be built and validated first. If it passes, it becomes a published widget definition available from the sidebar.`,
  }
}

export function fnPublicationFailureTitle(reason: string): string {
  if (reason === "draft-still-changing") return "Draft is still changing"
  if (reason === "validation-failed") return "Draft validation failed"
  if (reason === "resource-binding-invalid") return "Resource bindings are invalid"
  if (reason === "build-failed") return "Draft build failed"
  if (reason === "publication-conflict") return "Widget publication conflicted"
  if (reason === "publication-failed") return "Widget publication failed"
  if (reason === "not-found") return "Widget draft not found"
  return "Could not publish widget"
}

export function fnPublicationPhaseLabel(
  phase: TWidgetPublicationPhase,
): string {
  if (phase === "queued") return "Publication build queued…"
  if (phase === "installing") return "Installing current draft…"
  if (phase === "building") return "Building current draft…"
  if (phase === "validating") return "Validating current draft…"
  if (phase === "publishing") return "Signing and publishing…"
  if (phase === "success") return "Published"
  if (phase === "failed") return "Publication failed"
  return "Publish current draft"
}

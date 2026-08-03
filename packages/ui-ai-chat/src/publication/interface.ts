import type { TOrpcSafeClient, TWidgetDetail } from "@omnidraw/orpc-client"

type TAgentApi = TOrpcSafeClient["api"]["agent"]

export type TWidgetPublicationApi = {
  events?: TAgentApi["events"]
  widgets: Pick<TAgentApi["widgets"], "detail">
  widgetPublish: Pick<TAgentApi["widgetPublish"], "publish">
}

export type TWidgetPublicationPhase =
  | "idle"
  | "queued"
  | "installing"
  | "building"
  | "validating"
  | "publishing"
  | "success"
  | "failed"

export type TWidgetPublicationTarget = Readonly<{
  draftId: string
  previewId: string
  canvasId: string
  frameNodeId: string
  label: string
}>

export type TResolveWidgetPublicationTargets = (
) => readonly TWidgetPublicationTarget[]
  | Promise<readonly TWidgetPublicationTarget[]>

export type TWidgetPublicationState = {
  open: boolean
  loading: boolean
  publishing: boolean
  previewAvailable: boolean
  previewSelected: boolean
  phase: TWidgetPublicationPhase
  actionLabel: "Publish" | "Republish"
}

export type TWidgetPublicationSuccess = {
  detail: TWidgetDetail | null
  result: Extract<Awaited<ReturnType<TAgentApi["widgetPublish"]["publish"]>>[1], { published: true }>
}

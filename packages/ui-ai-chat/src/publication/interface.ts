import type { TOrpcSafeClient, TWidgetDetail } from "@omnidraw/orpc-client"

type TAgentApi = TOrpcSafeClient["api"]["agent"]

export type TWidgetPublicationApi = {
  widgets: Pick<TAgentApi["widgets"], "detail">
  widgetPublish: Pick<TAgentApi["widgetPublish"], "publish">
}

export type TWidgetPublicationPreviewSelection = Readonly<{
  previewId: string
  previewRevisionId: string
  expectedBindingRevision: number
  expectedBindingPlanDigestSha256: string
  canvasId: string
  frameNodeId: string
  label: string
}>

export type TResolveWidgetPublicationPreviewSelections = (
) => readonly TWidgetPublicationPreviewSelection[]
  | Promise<readonly TWidgetPublicationPreviewSelection[]>

export type TWidgetPublicationState = {
  open: boolean
  loading: boolean
  publishing: boolean
  previewAvailable: boolean
  previewSelected: boolean
  actionLabel: "Publish" | "Republish"
}

export type TWidgetPublicationSuccess = {
  detail: TWidgetDetail
  result: Extract<Awaited<ReturnType<TAgentApi["widgetPublish"]["publish"]>>[1], { published: true }>
}

import type { TOrpcSafeClient, TWidgetDetail } from "@vibecanvas/orpc-client"

type TAgentApi = TOrpcSafeClient["api"]["agent"]

export type TWidgetPublicationApi = {
  widgets: Pick<TAgentApi["widgets"], "detail">
  widgetPublish: Pick<TAgentApi["widgetPublish"], "publish">
}

export type TWidgetPublicationState = {
  open: boolean
  loading: boolean
  publishing: boolean
  actionLabel: "Publish" | "Republish"
}

export type TWidgetPublicationSuccess = {
  detail: TWidgetDetail
  result: Extract<Awaited<ReturnType<TAgentApi["widgetPublish"]["publish"]>>[1], { published: true }>
}

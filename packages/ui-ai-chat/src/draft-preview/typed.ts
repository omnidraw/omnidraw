import type {
  TWidgetDraftSummary,
  TWidgetPreviewResult,
} from "@vibecanvas/orpc-client"
import type {
  TWidgetUiArtifactMountPort,
} from "../widget-runtime/interface"
import type { TAiChatApiPort, TWidgetBrowserPort } from "../ports"

export type TDraftPreviewPayload = {
  draftId: string
  draftName: string
  originChatElementId?: string
}

export type TDraftPreviewSummary = Pick<
  TWidgetDraftSummary,
  "draftId" | "definitionId" | "name" | "displayName" | "revision"
>

type TBackendDraftPreviewFailure = Extract<TWidgetPreviewResult, { ready: false }>

export type TDraftPreviewReady = Extract<TWidgetPreviewResult, { ready: true }>
export type TDraftPreviewFailure = TBackendDraftPreviewFailure | Readonly<{
  ready: false
  draftId: string
  revision?: string
  reason: "transport-failed" | "artifact-invalid"
  message: string
  diagnostics: readonly string[]
}>
export type TDraftPreviewResult = TDraftPreviewReady | TDraftPreviewFailure

export type TDraftPreviewRuntime = {
  refresh: (summary?: TDraftPreviewSummary) => Promise<void>
  reset: () => Promise<void>
  dispose: () => Promise<void>
  getCurrentRevision: () => string
}

export type TMountDraftPreviewArgs = {
  root: HTMLDivElement
  api: TAiChatApiPort
  browser: TWidgetBrowserPort
  payload: TDraftPreviewPayload
  initialResult?: TDraftPreviewResult
  mountArtifact: TWidgetUiArtifactMountPort
  onResetStateChange?: (state: { disabled: boolean }) => void
  onLogError: (error: unknown) => void
}

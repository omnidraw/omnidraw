import type {
  TWidgetDraftSummary,
  TWidgetPreviewResult,
  TWidgetPreviewSendResult,
} from "@vibecanvas/orpc-client"
import type { TAiChatApiPort } from "../ports"
import type { TArrowSandboxBridge, mountArrowSandboxBridge } from "../widget/mount-arrow-sandbox"

export type TDraftPreviewPayload = {
  draftId: string
  pinnedRevision: string
  originChatElementId?: string
}

export type TDraftPreviewSummary = Pick<TWidgetDraftSummary, "draftId" | "name" | "displayName" | "revision">

type TBackendDraftPreviewFailure = Extract<TWidgetPreviewResult, { ready: false }>

export type TDraftPreviewReady = Extract<TWidgetPreviewResult, { ready: true }>
export type TDraftPreviewFailure = TBackendDraftPreviewFailure | (
  Omit<TBackendDraftPreviewFailure, "reason"> & { reason: "transport-failed" }
)
export type TDraftPreviewResult = TDraftPreviewReady | TDraftPreviewFailure
export type TDraftPreviewSendResult = TWidgetPreviewSendResult

export type TDraftPreviewSandboxMount = typeof mountArrowSandboxBridge

export type TDraftPreviewRuntime = {
  refresh: (summary?: TDraftPreviewSummary) => Promise<void>
  reset: () => Promise<void>
  dispose: () => Promise<void>
  getOwnedRevision: () => string
}

export type TMountDraftPreviewArgs = {
  root: HTMLDivElement
  api: TAiChatApiPort
  previewId: string
  payload: TDraftPreviewPayload
  initialResult?: TDraftPreviewResult
  mountSandbox: TDraftPreviewSandboxMount
  onPersistRevision: (revision: string) => void
  onReleaseRevision: (revision: string) => void
  onLogError: (error: unknown) => void
}

export type TDraftPreviewBridge = TArrowSandboxBridge

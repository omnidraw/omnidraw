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
  draftRevision: string
  previewId: string
  previewRevisionId: string
  originChatElementId?: string
}

export type TDraftPreviewOwnership = Readonly<{
  draftRevision: string
  previewRevisionId: string
}>

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
  currentRevision?: string
  previewId?: string
  previewRevisionId?: string
  reason: "transport-failed" | "artifact-invalid"
  message: string
  diagnostics: readonly string[]
}>
export type TDraftPreviewResult = TDraftPreviewReady | TDraftPreviewFailure

export type TDraftPreviewRuntime = {
  refresh: (summary?: TDraftPreviewSummary) => Promise<void>
  reset: () => Promise<void>
  dispose: () => Promise<void>
  getOwnedRevision: () => string
  getOwnedPreviewRevisionId: () => string
}

export type TMountDraftPreviewArgs = {
  root: HTMLDivElement
  api: TAiChatApiPort
  browser: TWidgetBrowserPort
  payload: TDraftPreviewPayload
  initialResult?: TDraftPreviewResult
  mountArtifact: TWidgetUiArtifactMountPort
  onPersistOwnership: (ownership: TDraftPreviewOwnership) => void
  onReleaseOwnership: (ownership: TDraftPreviewOwnership) => void
  onResetStateChange?: (state: { disabled: boolean }) => void
  onLogError: (error: unknown) => void
}

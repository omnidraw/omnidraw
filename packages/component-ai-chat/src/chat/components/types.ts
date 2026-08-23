export type TAiChatApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "stale"
  | "executing"
  | "executed"
  | "failed"

import type { TAiChatApproval as TInjectedAiChatApproval } from "../../contracts.js"

export type TAiChatApproval = TInjectedAiChatApproval & Readonly<{
  status: TAiChatApprovalStatus
  statusMessage?: string
  resourceId?: string
}>

export type TAiChatWidgetErrorKind =
  | "connection"
  | "stream"
  | "prompt"
  | "cancel"
  | "attachment"
  | "approval"

export type TAiChatWidgetError = {
  kind: TAiChatWidgetErrorKind
  title: string
  message: string
  isAuthenticationError: boolean
}

export type TAiChatAssistantError = {
  message: string
  provider?: string
  model?: string
  diagnosticCode?: string
  isAuthenticationError: boolean
}

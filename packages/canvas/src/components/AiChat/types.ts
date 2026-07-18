export type TAiChatApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "stale"
  | "executing"
  | "executed"
  | "failed"

export type TAiChatApproval = {
  id: string
  chatId: string
  toolCallId: string
  kind: "resource-create" | "resource-update" | "resource-delete" | "resource-data-write"
  summary: string
  risk: "medium" | "high"
  warnings: string[]
  details: unknown
  createdAt: string
  expiresAt: string
  status: TAiChatApprovalStatus
  statusMessage?: string
  resourceId?: string
}

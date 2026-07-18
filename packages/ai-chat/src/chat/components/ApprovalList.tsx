import { For, Show, createSignal } from "solid-js"
import { fnRedactApprovalDetails } from "./fn.approval-details"
import type { TAiChatApproval } from "./types"
import type { TAiChatBrowserPort } from "../../ports"

interface IProps {
  approvals: readonly TAiChatApproval[]
  browser: TAiChatBrowserPort
  onResolve: (approvalId: string, decision: "approve" | "reject") => Promise<void>
  onOpenResource?: (resourceId: string) => void
  variant?: "inline" | "floating"
}

function approvalKindLabel(kind: TAiChatApproval["kind"]) {
  switch (kind) {
    case "resource-create": return "Create resource"
    case "resource-update": return "Update resource"
    case "resource-delete": return "Delete resource"
    case "resource-data-write": return "Write resource data"
  }
}

function ApprovalCard(props: {
  approval: TAiChatApproval
  onResolve: IProps["onResolve"]
  onOpenResource?: IProps["onOpenResource"]
  browser: TAiChatBrowserPort
}) {
  const [isExpanded, setIsExpanded] = createSignal(false)
  const details = () => JSON.stringify(fnRedactApprovalDetails(props.approval.details), null, 2)

  return (
    <article class="ai-chat-approval" data-status={props.approval.status} aria-label="Protected resource operation">
      <header class="ai-chat-approval__header">
        <div>
          <span>{approvalKindLabel(props.approval.kind)}</span>
          <strong>{props.approval.summary}</strong>
        </div>
        <span class="ai-chat-approval__status">{props.approval.status}</span>
      </header>
      <div class="ai-chat-approval__meta">
        <span>Risk: {props.approval.risk}</span>
        <span>Expires {props.browser.formatTime(props.approval.expiresAt)}</span>
      </div>
      <Show when={props.approval.warnings.length > 0}>
        <ul><For each={props.approval.warnings}>{(warning) => <li>{warning}</li>}</For></ul>
      </Show>
      <Show when={details() && details() !== "{}"}>
        <button type="button" class="ai-chat-approval__details-toggle" onClick={() => setIsExpanded((value) => !value)}>
          {isExpanded() ? "Hide operation details" : "Show operation details"}
        </button>
        <Show when={isExpanded()}><pre><code>{details()}</code></pre></Show>
      </Show>
      <Show when={props.approval.statusMessage}>
        <p class="ai-chat-approval__message" role={props.approval.status === "failed" || props.approval.status === "stale" ? "alert" : "status"}>
          {props.approval.statusMessage}
        </p>
      </Show>
      <Show when={!props.onOpenResource || props.approval.kind === "resource-delete" ? undefined : props.approval.resourceId}>
        {(resourceId) => (
          <div class="ai-chat-approval__resource-action">
            <button type="button" onClick={() => props.onOpenResource?.(resourceId())}>Open resource</button>
          </div>
        )}
      </Show>
      <Show when={props.approval.status === "pending"}>
        <div class="ai-chat-approval__actions">
          <button type="button" onClick={() => void props.onResolve(props.approval.id, "reject")}>Reject</button>
          <button type="button" class="ai-chat-primary-button" onClick={() => void props.onResolve(props.approval.id, "approve")}>Approve</button>
        </div>
      </Show>
    </article>
  )
}

export function ApprovalList(props: IProps) {
  return (
    <Show when={props.approvals.length > 0}>
      <section class={`ai-chat-approvals ai-chat-approvals--${props.variant ?? "inline"}`} aria-label="Protected operations">
        <For each={props.approvals}>{(approval) => (
          <ApprovalCard approval={approval} browser={props.browser} onResolve={props.onResolve} onOpenResource={props.onOpenResource} />
        )}</For>
      </section>
    </Show>
  )
}

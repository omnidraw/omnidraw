interface IProps {
  variant: "loading" | "error"
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

export function AsyncStateView(props: IProps) {
  return (
    <div class="omnidraw-ai-chat-async-state" role={props.variant === "error" ? "alert" : "status"} aria-live="polite">
      <div class={`omnidraw-ai-chat-async-state__icon omnidraw-ai-chat-async-state__icon--${props.variant}`} aria-hidden="true">
        {props.variant === "loading" ? "…" : "!"}
      </div>
      <div class="omnidraw-ai-chat-async-state__body">
        <strong>{props.title}</strong>
        {props.message ? <p>{props.message}</p> : null}
      </div>
      {props.actionLabel && props.onAction ? (
        <button class="omnidraw-ai-chat-async-state__action" type="button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  )
}

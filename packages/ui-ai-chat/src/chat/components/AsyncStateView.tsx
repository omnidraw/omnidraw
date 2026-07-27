interface IProps {
  variant: "loading" | "error"
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

export function AsyncStateView(props: IProps) {
  return (
    <div class="vc-async-state" role={props.variant === "error" ? "alert" : "status"} aria-live="polite">
      <div class={`vc-async-state__icon vc-async-state__icon--${props.variant}`} aria-hidden="true">
        {props.variant === "loading" ? "…" : "!"}
      </div>
      <div class="vc-async-state__body">
        <strong>{props.title}</strong>
        {props.message ? <p>{props.message}</p> : null}
      </div>
      {props.actionLabel && props.onAction ? (
        <button class="vc-async-state__action" type="button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  )
}

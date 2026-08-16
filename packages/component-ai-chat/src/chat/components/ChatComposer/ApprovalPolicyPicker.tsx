import Bot from "lucide-solid/icons/bot"
import Hand from "lucide-solid/icons/hand"
import ShieldAlert from "lucide-solid/icons/shield-alert"
import ShieldCheck from "lucide-solid/icons/shield-check"
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import type { TAiChatApprovalPolicy } from "../../../contracts.js"
import type { TChatComposerModel } from "./interface"

type TProps = Readonly<{
  open: boolean
  policy: TAiChatApprovalPolicy
  reviewerModels: readonly TChatComposerModel[]
  onOpenChange(open: boolean): void
  onChange?(policy: TAiChatApprovalPolicy): Promise<boolean>
}>

const MODE_LABELS = Object.freeze({
  manual: "Manual approval",
  "ai-review": "Approve for me",
  "always-approve": "Always approve",
})

function modelKey(model: Readonly<{ provider: string; modelId: string }>): string {
  return JSON.stringify([model.provider, model.modelId])
}

export function ApprovalPolicyPicker(props: TProps) {
  let root!: HTMLDivElement
  let trigger!: HTMLButtonElement
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal(false)
  const reviewerAvailable = createMemo(() => {
    const policy = props.policy
    return policy.mode !== "ai-review" || props.reviewerModels.some((model) => (
      model.provider === policy.reviewerModel.provider
      && model.id === policy.reviewerModel.modelId
    ))
  })
  const label = createMemo(() => `${MODE_LABELS[props.policy.mode]}${reviewerAvailable() ? "" : " (reviewer unavailable)"}`)

  const save = async (policy: TAiChatApprovalPolicy, keepOpen = false) => {
    if (saving() || !props.onChange) return
    setSaving(true)
    setError(false)
    const saved = await props.onChange(policy).catch(() => false)
    setSaving(false)
    setError(!saved)
    if (saved && !keepOpen) {
      props.onOpenChange(false)
      trigger.focus()
    }
  }

  const selectMode = (mode: TAiChatApprovalPolicy["mode"]) => {
    if (mode === "ai-review") {
      const current = props.policy.mode === "ai-review" && reviewerAvailable()
        ? props.policy.reviewerModel
        : props.reviewerModels[0]
          ? { provider: props.reviewerModels[0].provider, modelId: props.reviewerModels[0].id }
          : undefined
      if (current) void save({ mode, reviewerModel: current }, true)
      return
    }
    void save({ mode })
  }

  const menuButtons = () => Array.from(root.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']:not(:disabled)"))
  const moveFocus = (current: EventTarget | null, direction: 1 | -1) => {
    const buttons = menuButtons()
    if (buttons.length === 0) return
    const index = Math.max(0, buttons.indexOf(current as HTMLButtonElement))
    buttons[(index + direction + buttons.length) % buttons.length]?.focus()
  }

  return (
    <div ref={root} class="omnidraw-ai-chat-composer__approval-picker">
      <button
        ref={trigger}
        class="omnidraw-ai-chat-composer__icon-button omnidraw-ai-chat-composer__approval-button"
        type="button"
        title={`Protected operations: ${label()}`}
        aria-label={`Protected operations approval mode: ${label()}`}
        aria-haspopup="menu"
        aria-expanded={props.open}
        data-mode={props.policy.mode}
        onClick={(event) => {
          event.stopPropagation()
          setError(false)
          props.onOpenChange(!props.open)
        }}
      >
        <Switch>
          <Match when={props.policy.mode === "manual"}><Hand size={18} aria-hidden="true" /></Match>
          <Match when={props.policy.mode === "ai-review"}><ShieldCheck size={18} aria-hidden="true" /></Match>
          <Match when={props.policy.mode === "always-approve"}><ShieldAlert size={18} aria-hidden="true" /></Match>
        </Switch>
        <span class="omnidraw-ai-chat-visually-hidden">{label()}</span>
      </button>

      <Show when={props.open}>
        <div
          class="omnidraw-ai-chat-composer__approval-menu"
          role="menu"
          aria-label="Protected operations approval mode"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onOpenChange(false)
              trigger.focus()
              return
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              moveFocus(event.target, event.key === "ArrowDown" ? 1 : -1)
              return
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault()
              const buttons = menuButtons()
              buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus()
            }
          }}
        >
          <div class="omnidraw-ai-chat-composer__approval-heading">Approval mode</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={props.policy.mode === "manual"}
            disabled={saving()}
            onClick={() => selectMode("manual")}
          >
            <Hand size={16} aria-hidden="true" />
            <span><strong>Manual approval</strong><small>Ask in this chat every time</small></span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={props.policy.mode === "ai-review"}
            aria-disabled={props.reviewerModels.length === 0}
            disabled={saving() || props.reviewerModels.length === 0}
            onClick={() => selectMode("ai-review")}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span><strong>Approve for me</strong><small>Independent review; falls back to manual</small></span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={props.policy.mode === "always-approve"}
            disabled={saving()}
            onClick={() => selectMode("always-approve")}
          >
            <ShieldAlert size={16} aria-hidden="true" />
            <span><strong>Always approve</strong><small>Still rechecks current authorization</small></span>
          </button>

          <Show when={props.policy.mode === "ai-review"}>
            <div class="omnidraw-ai-chat-composer__approval-heading omnidraw-ai-chat-composer__approval-heading--reviewer">Reviewer model</div>
            <Show when={props.reviewerModels.length > 0} fallback={(
              <p role="status">Connect a provider before selecting an AI reviewer.</p>
            )}>
              <For each={props.reviewerModels}>{(model) => {
                const selected = () => props.policy.mode === "ai-review"
                  && modelKey(props.policy.reviewerModel) === modelKey({ provider: model.provider, modelId: model.id })
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-label={`Reviewer model: ${model.name}, ${model.provider}`}
                    aria-checked={selected()}
                    disabled={saving()}
                    onClick={() => void save({
                      mode: "ai-review",
                      reviewerModel: { provider: model.provider, modelId: model.id },
                    })}
                  >
                    <Bot size={16} aria-hidden="true" />
                    <span><strong>{model.name}</strong><small>{model.provider}</small></span>
                  </button>
                )
              }}</For>
            </Show>
            <Show when={!reviewerAvailable()}>
              <p role="status">The saved reviewer is unavailable. Choose another model; protected requests fall back to manual approval.</p>
            </Show>
          </Show>
          <Show when={saving()}><p role="status">Saving approval mode…</p></Show>
          <Show when={error()}><p role="alert">Approval mode could not be saved.</p></Show>
        </div>
      </Show>
    </div>
  )
}

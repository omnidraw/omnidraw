import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { TAiChatApprovalPolicy } from "../../../contracts.js"
import type { TAiChatBrowserPort } from "../../../ports"
import { Bot, Hand, ShieldAlert, ShieldCheck } from "../icons"
import { AnchoredMenu } from "./AnchoredMenu"
import type { TChatComposerModel } from "./interface"

type TProps = Readonly<{
  browser: TAiChatBrowserPort
  open: boolean
  policy: TAiChatApprovalPolicy
  reviewerModels: readonly TChatComposerModel[]
  onOpenChange(open: boolean): void
  onChange?(policy: TAiChatApprovalPolicy): Promise<boolean>
  onMenuElement?(element: HTMLDivElement | undefined): void
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
  let menu: HTMLDivElement | undefined
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal(false)
  let focusIntent: "first" | "last" | "selected" = "selected"
  let onMenuElement = untrack(() => props.onMenuElement)
  let disposed = false
  let openGeneration = 0
  let saveInFlight = false
  const reviewerAvailable = createMemo(() => {
    const policy = props.policy
    return policy.mode !== "ai-review" || props.reviewerModels.some((model) => (
      model.provider === policy.reviewerModel.provider
      && model.id === policy.reviewerModel.modelId
    ))
  })
  const label = createMemo(() => `${MODE_LABELS[props.policy.mode]}${reviewerAvailable() ? "" : " (reviewer unavailable)"}`)

  createEffect(
    () => props.open,
    (open) => {
      openGeneration += 1
      saveInFlight = false
      setSaving(false)
      if (open) setError(false)
    },
  )

  createEffect(
    () => props.onMenuElement,
    (handler) => { onMenuElement = handler },
  )

  onCleanup(() => {
    disposed = true
    openGeneration += 1
    saveInFlight = false
  })

  const save = async (policy: TAiChatApprovalPolicy, keepOpen = false) => {
    const onChange = props.onChange
    if (saveInFlight || !onChange) return
    saveInFlight = true
    const requestGeneration = openGeneration
    const onOpenChange = props.onOpenChange
    setSaving(true)
    setError(false)
    const saved = await onChange(policy).catch(() => false)
    if (disposed || requestGeneration !== openGeneration) return
    saveInFlight = false
    setSaving(false)
    setError(!saved)
    if (saved && !keepOpen) {
      onOpenChange(false)
      if (trigger.isConnected) trigger.focus()
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

  const menuButtons = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']:not(:disabled)") ?? [])
  const moveFocus = (current: EventTarget | null, direction: 1 | -1) => {
    const buttons = menuButtons()
    if (buttons.length === 0) return
    const index = Math.max(0, buttons.indexOf(current as HTMLButtonElement))
    buttons[(index + direction + buttons.length) % buttons.length]?.focus()
  }

  const focusMenu = (intent: "first" | "last" | "selected") => {
    const buttons = menuButtons()
    if (buttons.length === 0) return
    const target = intent === "first"
      ? buttons[0]
      : intent === "last"
        ? buttons.at(-1)
        : buttons.find((button) => button.getAttribute("aria-checked") === "true") ?? buttons[0]
    target?.focus()
  }

  createEffect(
    () => props.open,
    (open) => {
      if (open) focusMenu(focusIntent)
    },
  )

  return (
    <div ref={root} class="omnidraw-ai-chat-composer__approval-picker">
      <button
        ref={trigger}
        class="omnidraw-ai-chat-composer__icon-button omnidraw-ai-chat-composer__approval-button"
        type="button"
        title={`Protected operations: ${label()}`}
        aria-label={`Protected operations approval mode: ${label()}`}
        aria-haspopup="menu"
        aria-expanded={props.open ? "true" : "false"}
        data-mode={props.policy.mode}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          event.stopPropagation()
          setError(false)
          const intent = event.key === "ArrowDown" ? "first" : "last"
          focusIntent = intent
          if (props.open) focusMenu(intent)
          else props.onOpenChange(true)
        }}
        onClick={(event) => {
          event.stopPropagation()
          setError(false)
          if (!props.open) focusIntent = "selected"
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
        <AnchoredMenu
          anchor={trigger}
          browser={props.browser}
          class="omnidraw-ai-chat-composer__approval-menu"
          root={root}
          role="menu"
          ariaLabel="Protected operations approval mode"
          onElement={(element) => {
            menu = element
            onMenuElement?.(element)
            if (element) focusMenu(focusIntent)
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onOpenChange(false)
              trigger.focus()
              return
            }
            if (event.key === "Tab") {
              props.onOpenChange(false)
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
          <div role="group" aria-label="Approval modes">
            <div class="omnidraw-ai-chat-composer__approval-heading">Approval mode</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.policy.mode === "manual" ? "true" : "false"}
              tabindex={-1}
              disabled={saving()}
              onClick={() => selectMode("manual")}
            >
              <Hand size={16} aria-hidden="true" />
              <span><strong>Manual approval</strong><small>Ask in this chat every time</small></span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.policy.mode === "ai-review" ? "true" : "false"}
              aria-disabled={props.reviewerModels.length === 0 ? "true" : "false"}
              disabled={saving() || props.reviewerModels.length === 0}
              tabindex={-1}
              onClick={() => selectMode("ai-review")}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Approve for me</strong><small>Independent review; falls back to manual</small></span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.policy.mode === "always-approve" ? "true" : "false"}
              disabled={saving()}
              tabindex={-1}
              onClick={() => selectMode("always-approve")}
            >
              <ShieldAlert size={16} aria-hidden="true" />
              <span><strong>Always approve</strong><small>Still rechecks current authorization</small></span>
            </button>
          </div>

          <Show when={props.policy.mode === "ai-review"}>
            <div role="group" aria-label="Reviewer models">
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
                      aria-checked={selected() ? "true" : "false"}
                      disabled={saving()}
                      tabindex={-1}
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
            </div>
          </Show>
          <Show when={saving()}><p role="status">Saving approval mode…</p></Show>
          <Show when={error()}><p role="alert">Approval mode could not be saved.</p></Show>
        </AnchoredMenu>
      </Show>
    </div>
  )
}

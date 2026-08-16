import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TAiChatApprovalPolicy } from "../../../src/contracts"
import { ApprovalPolicyPicker } from "../../../src/chat/components/ChatComposer/ApprovalPolicyPicker"

let dispose: (() => void) | undefined
let container: HTMLDivElement | undefined

function mount(initial: TAiChatApprovalPolicy, reviewerModels = [{
  id: "reviewer-1",
  input: ["text"] as const,
  provider: "openai",
  name: "Reviewer One",
}]) {
  container = document.createElement("div")
  document.body.append(container)
  const [open, setOpen] = createSignal(false)
  const [policy, setPolicy] = createSignal<TAiChatApprovalPolicy>(initial)
  const onChange = vi.fn(async (next: TAiChatApprovalPolicy) => {
    setPolicy(next)
    return true
  })
  dispose = render(() => (
    <ApprovalPolicyPicker
      open={open()}
      policy={policy()}
      reviewerModels={reviewerModels}
      onOpenChange={setOpen}
      onChange={onChange}
    />
  ), container)
  return { onChange, policy }
}

function key(target: HTMLElement, value: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  }))
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  container?.remove()
  container = undefined
})

describe("ApprovalPolicyPicker", () => {
  it("reports the collapsed mode without color and exposes keyboard-reachable modes and reviewer models", async () => {
    const { onChange, policy } = mount({ mode: "manual" })
    const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")
    expect(trigger).not.toBeNull()
    expect(trigger?.classList).toContain("omnidraw-ai-chat-composer__icon-button")
    expect(trigger?.dataset.mode).toBe("manual")
    expect(trigger?.getAttribute("aria-label")).toContain("Manual approval")
    expect(trigger?.title).toContain("Manual approval")
    expect(trigger?.querySelectorAll("svg")).toHaveLength(1)

    trigger?.click()
    const menu = await vi.waitFor(() => {
      const value = container?.querySelector<HTMLElement>("[role='menu']")
      expect(value).not.toBeNull()
      return value!
    })
    const modes = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].slice(0, 3)
    expect(modes).toHaveLength(3)
    expect(modes.map((button) => button.getAttribute("aria-checked"))).toEqual(["true", "false", "false"])

    modes[0]?.focus()
    key(modes[0]!, "ArrowDown")
    expect(document.activeElement).toBe(modes[1])
    modes[1]?.click()

    await vi.waitFor(() => expect(policy()).toEqual({
      mode: "ai-review",
      reviewerModel: { provider: "openai", modelId: "reviewer-1" },
    }))
    const reviewer = container?.querySelector<HTMLButtonElement>("[aria-label='Reviewer model: Reviewer One, openai']")
    expect(reviewer).not.toBeNull()
    expect(reviewer?.getAttribute("aria-checked")).toBe("true")

    key(reviewer!, "Escape")
    expect(container?.querySelector("[role='menu']")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onChange).toHaveBeenCalledOnce()
    expect(trigger?.dataset.mode).toBe("ai-review")
    expect(trigger?.getAttribute("aria-label")).toContain("AI review")
  })

  it("announces an unavailable saved reviewer and permits a safe manual fallback", async () => {
    const { policy } = mount({
      mode: "ai-review",
      reviewerModel: { provider: "missing", modelId: "retired-model" },
    }, [])
    const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")
    expect(trigger?.getAttribute("aria-label")).toContain("reviewer unavailable")
    trigger?.click()

    const status = await vi.waitFor(() => {
      const values = [...container?.querySelectorAll<HTMLElement>("[role='status']") ?? []]
      expect(values.some((value) => value.textContent?.includes("saved reviewer is unavailable"))).toBe(true)
      return values
    })
    expect(status.some((value) => value.textContent?.includes("Connect a provider"))).toBe(true)
    const modeButtons = [...container?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []]
    expect(modeButtons[1]?.disabled).toBe(true)
    modeButtons[0]?.click()
    await vi.waitFor(() => expect(policy()).toEqual({ mode: "manual" }))
    await vi.waitFor(() => expect(container?.querySelector("[role='menu']")).toBeNull())
  })
})

import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TAiChatApprovalPolicy } from "../../../src/contracts"
import { ApprovalPolicyPicker } from "../../../src/chat/components/ChatComposer/ApprovalPolicyPicker"
import { createTestChatBrowser } from "../../test-setup"
import { settleSolidUpdate } from "../../settled"

let dispose: (() => void) | undefined
let container: HTMLDivElement | undefined

function mount(initial: TAiChatApprovalPolicy, reviewerModels = [{
  id: "reviewer-1",
  input: ["text"] as const,
  provider: "openai",
  name: "Reviewer One",
}], savePolicy: (next: TAiChatApprovalPolicy) => Promise<boolean> = async () => true) {
  container = document.createElement("div")
  document.body.append(container)
  const [open, setOpen] = createSignal(false)
  const [policy, setPolicy] = createSignal<TAiChatApprovalPolicy>(initial)
  const onChange = vi.fn(async (next: TAiChatApprovalPolicy) => {
    const saved = await savePolicy(next)
    if (saved) setPolicy(next)
    return saved
  })
  dispose = render(() => (
    <ApprovalPolicyPicker
      browser={createTestChatBrowser()}
      open={open()}
      policy={policy()}
      reviewerModels={reviewerModels}
      onOpenChange={setOpen}
      onChange={onChange}
    />
  ), container)
  return { onChange, policy, setOpen }
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
  it("opens the real anchored menu without a strict untracked ref read", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      mount({ mode: "manual" })
      const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!
      key(trigger, "ArrowUp")
      const menu = await vi.waitFor(() => {
        const value = container?.querySelector<HTMLElement>("[role='menu']")
        expect(value).not.toBeNull()
        return value!
      })
      const items = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")]
      await vi.waitFor(() => expect(document.activeElement).toBe(items.at(-1)))

      const diagnostics = [...warnings.mock.calls, ...errors.mock.calls]
        .flat()
        .map(String)
        .join("\n")
      expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED")
    } finally {
      warnings.mockRestore()
      errors.mockRestore()
    }
  })

  it("reports the collapsed mode without color and exposes keyboard-reachable modes and reviewer models", async () => {
    const { onChange, policy } = mount({ mode: "manual" })
    const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")
    expect(trigger).not.toBeNull()
    expect(trigger?.classList).toContain("omnidraw-ai-chat-composer__icon-button")
    expect(trigger?.dataset.mode).toBe("manual")
    expect(trigger?.getAttribute("aria-label")).toContain("Manual approval")
    expect(trigger?.title).toContain("Manual approval")
    expect(trigger?.querySelectorAll("svg")).toHaveLength(1)

    key(trigger!, "ArrowDown")
    await settleSolidUpdate()
    const menu = await vi.waitFor(() => {
      const value = container?.querySelector<HTMLElement>("[role='menu']")
      expect(value).not.toBeNull()
      return value!
    })
    const modes = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].slice(0, 3)
    expect(modes).toHaveLength(3)
    expect(modes.map((button) => button.getAttribute("aria-checked"))).toEqual(["true", "false", "false"])
    expect(document.activeElement).toBe(modes[0])

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
    const modeGroup = container?.querySelector<HTMLElement>("[role='group'][aria-label='Approval modes']")
    const reviewerGroup = container?.querySelector<HTMLElement>("[role='group'][aria-label='Reviewer models']")
    expect(modeGroup?.querySelectorAll("[aria-checked='true']")).toHaveLength(1)
    expect(reviewerGroup?.querySelectorAll("[aria-checked='true']")).toHaveLength(1)

    key(reviewer!, "Escape")
    await settleSolidUpdate()
    expect(container?.querySelector("[role='menu']")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onChange).toHaveBeenCalledOnce()
    expect(trigger?.dataset.mode).toBe("ai-review")
    expect(trigger?.getAttribute("aria-label")).toContain("Approve for me")
    expect(trigger?.querySelector(".lucide-shield-check")).not.toBeNull()

    key(trigger!, "ArrowUp")
    await settleSolidUpdate()
    const reopenedItems = [...container?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []]
    expect(document.activeElement).toBe(reopenedItems.at(-1))
    key(reopenedItems.at(-1)!, "Escape")
    await settleSolidUpdate()
    expect(document.activeElement).toBe(trigger)
  })

  it("uses the alert shield for always approve", () => {
    mount({ mode: "always-approve" })
    const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")
    expect(trigger?.getAttribute("aria-label")).toContain("Always approve")
    expect(trigger?.querySelector(".lucide-shield-alert")).not.toBeNull()
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

  it("does not let an old save close or disable a reopened menu", async () => {
    let resolveSave!: (saved: boolean) => void
    const pending = new Promise<boolean>((resolve) => { resolveSave = resolve })
    const { setOpen } = mount({ mode: "manual" }, undefined, () => pending)
    const trigger = container?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!

    trigger.click()
    await settleSolidUpdate()
    const automatic = [...container?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []]
      .find((button) => button.textContent?.includes("Always approve"))!
    automatic.click()
    await settleSolidUpdate()
    expect(container?.textContent).toContain("Saving approval mode")

    setOpen(false)
    await settleSolidUpdate()
    setOpen(true)
    await settleSolidUpdate()
    expect(container?.querySelector("[role='menu']")).not.toBeNull()
    expect(container?.textContent).not.toContain("Saving approval mode")
    expect([...container?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []]
      .every((button) => !button.disabled)).toBe(true)

    resolveSave(true)
    await pending
    await settleSolidUpdate()
    expect(container?.querySelector("[role='menu']")).not.toBeNull()
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })
})

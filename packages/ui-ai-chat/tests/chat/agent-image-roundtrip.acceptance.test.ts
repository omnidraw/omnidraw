import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { resolve } from "node:path"
import { OrpcWebsocketService } from "@omnidraw/orpc-client"
import { render } from "solid-js/web"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { AiChat } from "../../src/chat/components"
import { createTestApplication, createTestChatBrowser } from "../test-setup"

const SYNTHETIC_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg=="
const REPOSITORY_ROOT = resolve(process.cwd(), "../..")
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, "apps/cli/tests/fixtures/agent-image-chat-server.ts")

let fixture: ChildProcessWithoutNullStreams | undefined
let fixturePort = 0
let fixtureOutput = ""
let disposeRendered: (() => void) | undefined
let client: OrpcWebsocketService | undefined
let container: HTMLDivElement | undefined

function ensureComponentDomMocks() {
  vi.stubGlobal("WebSocket", NodeWebSocket)
  if (typeof ResizeObserver === "undefined") {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver)
  }

  if (typeof PointerEvent === "undefined") vi.stubGlobal("PointerEvent", MouseEvent)
  if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    })
  }
  if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => Object.assign([], { item: () => null }),
    })
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const reservation = createServer()
  reservation.listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const address = reservation.address()
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback test port.")
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function startFixture(): Promise<void> {
  fixturePort = await reserveLoopbackPort()
  fixture = spawn("bun", ["run", FIXTURE_PATH], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      OMNIDRAW_AGENT_IMAGE_TEST_PORT: String(fixturePort),
    },
    stdio: "pipe",
  })
  fixture.stdout.setEncoding("utf8")
  fixture.stderr.setEncoding("utf8")

  await new Promise<void>((resolve, reject) => {
    let pending = ""
    const fail = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)))
    fixture?.once("error", fail)
    fixture?.once("exit", (code, signal) => {
      fail(new Error(`Agent image fixture exited before ready (${code ?? signal}).\n${fixtureOutput}`))
    })
    fixture?.stderr.on("data", (chunk: string) => { fixtureOutput += chunk })
    fixture?.stdout.on("data", (chunk: string) => {
      fixtureOutput += chunk
      pending += chunk
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("OMNIDRAW_AGENT_IMAGE_READY ")) continue
        const ready = JSON.parse(line.slice("OMNIDRAW_AGENT_IMAGE_READY ".length)) as { port?: unknown }
        if (ready.port !== fixturePort) {
          fail(new Error(`Agent image fixture reported the wrong port.\n${fixtureOutput}`))
          return
        }
        resolve()
      }
    })
  })
}

async function stopFixture(): Promise<void> {
  const current = fixture
  fixture = undefined
  if (!current || current.exitCode !== null) return
  current.kill("SIGTERM")
  await Promise.race([
    once(current, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      `Agent image fixture did not stop.\n${fixtureOutput}`,
    )), 5_000)),
  ])
}

function renderChat() {
  client = new OrpcWebsocketService({ websocketUrl: `ws://127.0.0.1:${fixturePort}/api` })
  container = document.createElement("div")
  document.body.appendChild(container)
  disposeRendered = render(() => AiChat({
    apiService: client!.apiService,
    application: createTestApplication(),
    browser: createTestChatBrowser(),
    id: "surface-image-acceptance",
    titleBar: { onAction: () => () => {}, setActionState: () => {} },
    onResetSessionId: () => "conversation-image-reset",
    sessionId: "conversation-image-acceptance",
  }), container)
}

function disposeChat() {
  disposeRendered?.()
  disposeRendered = undefined
  client?.dispose()
  client = undefined
  container?.remove()
  container = undefined
}

async function sendPrompt(text: string): Promise<void> {
  const editor = await vi.waitFor(() => {
    const current = container?.querySelector<HTMLElement>(".ai-chat-composer__editor")
    expect(current).not.toBeNull()
    return current!
  })
  editor.focus()
  editor.innerHTML = `<p>${text}</p>`
  const textNode = editor.querySelector("p")?.firstChild
  if (textNode) {
    const range = document.createRange()
    range.setStart(textNode, textNode.textContent?.length ?? 0)
    range.collapse(true)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
  }
  editor.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: text,
    inputType: "insertText",
  }))
  const send = await vi.waitFor(() => {
    const current = container?.querySelector<HTMLButtonElement>("[aria-label='Send prompt']")
    expect(current).not.toBeNull()
    expect(current?.disabled).toBe(false)
    return current!
  })
  send.click()
}

async function waitForPromptIdle(): Promise<void> {
  await vi.waitFor(() => expect(
    container?.querySelector<HTMLButtonElement>("[aria-label='Send prompt']"),
  ).not.toBeNull())
}

beforeAll(async () => {
  ensureComponentDomMocks()
  await startFixture()
})

afterAll(async () => {
  disposeChat()
  vi.unstubAllGlobals()
  await stopFixture()
})

describe("agent PNG black-box round trip", () => {
  it("crosses Pi, AgentService, WebSocket oRPC, reconnect history, Chat failure, and cancellation boundaries", async () => {
    renderChat()
    await sendPrompt("Run the synthetic image success proof")

    await vi.waitFor(() => expect(container?.querySelectorAll(".ai-chat-history__image")).toHaveLength(1))
    expect(container?.querySelector<HTMLButtonElement>("[aria-label='Stop response']")).not.toBeNull()
    await vi.waitFor(() => expect(container?.textContent).toContain(
      "Model next turn received the PNG image safely.",
    ))
    const firstImage = container?.querySelector<HTMLImageElement>(".ai-chat-history__image")
    expect(firstImage?.alt).toBe("Image result from synthetic_image_transport_proof")
    expect(firstImage?.getAttribute("width")).toBe("2")
    expect(firstImage?.getAttribute("height")).toBe("2")
    expect(firstImage?.dataset.mimeType).toBe("image/png")
    expect(firstImage?.src).toBe(`data:image/png;base64,${SYNTHETIC_PNG_BASE64}`)
    expect(firstImage?.closest(".ai-chat-view")?.hasAttribute("hidden")).toBe(false)
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64)
    await waitForPromptIdle()

    disposeChat()
    renderChat()
    await vi.waitFor(() => expect(container?.querySelectorAll(".ai-chat-history__image")).toHaveLength(1))
    expect(container?.textContent).toContain("Model next turn received the PNG image safely.")
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64)

    await sendPrompt("Run the synthetic image failure proof")
    await vi.waitFor(() => expect(container?.textContent).toContain(
      "Model received the image-tool failure without an image.",
    ))
    expect(container?.querySelectorAll(".ai-chat-history__image")).toHaveLength(1)
    expect(container?.textContent).toContain("Tool error.")
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64)
    await waitForPromptIdle()

    await sendPrompt("Cancel this synthetic response")
    await vi.waitFor(() => expect(container?.textContent).toContain(
      "Synthetic response is waiting for cancellation.",
    ))
    const stop = await vi.waitFor(() => {
      const current = container?.querySelector<HTMLButtonElement>("[aria-label='Stop response']")
      expect(current).not.toBeNull()
      return current!
    })
    stop.click()
    await waitForPromptIdle()
    expect(container?.querySelectorAll(".ai-chat-history__image")).toHaveLength(1)
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64)

    disposeChat()
    renderChat()
    await vi.waitFor(() => expect(container?.querySelectorAll(".ai-chat-history__image")).toHaveLength(1))
    expect(container?.textContent).toContain("Model received the image-tool failure without an image.")
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64)
    expect(fixtureOutput).not.toContain(SYNTHETIC_PNG_BASE64)
  }, 30_000)
})

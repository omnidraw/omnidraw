import { describe, expect, it } from "vitest"
import { fnGetChatMessageParts } from "../../../src/chat/components/tabs/fn.chat-message-parts"

const SYNTHETIC_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg=="

describe("fnGetChatMessageParts", () => {
  it("extracts text from structured chat content", () => {
    expect(fnGetChatMessageParts({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    })).toEqual([{ kind: "text", text: "hello" }])
  })

  it("ignores metadata on text parts", () => {
    expect(fnGetChatMessageParts({
      role: "assistant",
      content: [{ type: "text", text: "Hello! How can I help?", textSignature: "{\"v\":1}" }],
    })).toEqual([{ kind: "text", text: "Hello! How can I help?" }])
  })

  it("extracts image URLs from common image part shapes", () => {
    expect(fnGetChatMessageParts({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/a.png" }, alt: "A" },
        { type: "image", url: "/files/b.png", name: "B" },
      ],
    })).toEqual([
      { kind: "image", src: "https://example.com/a.png", alt: "A" },
      { kind: "image", src: "/files/b.png", alt: "B" },
    ])
  })

  it("builds data image URLs from base64 source content", () => {
    expect(fnGetChatMessageParts({
      role: "assistant",
      content: [{ type: "image", source: { media_type: "image/png", data: "abc" } }],
    })).toEqual([{ kind: "image", src: "data:image/png;base64,abc", alt: "Chat image" }])
  })

  it("validates PNG tool results and exposes bounded image metadata", () => {
    expect(fnGetChatMessageParts({
      role: "toolResult",
      toolName: "od_widget_preview_inspect",
      content: [
        { type: "text", text: "Synthetic image transport proof." },
        { type: "image", mimeType: "image/png", data: SYNTHETIC_PNG_BASE64 },
      ],
    })).toEqual([
      { kind: "text", text: "Synthetic image transport proof." },
      {
        kind: "image",
        src: `data:image/png;base64,${SYNTHETIC_PNG_BASE64}`,
        alt: "Image result from od_widget_preview_inspect",
        mimeType: "image/png",
        byteSize: 76,
        width: 2,
        height: 2,
      },
    ])
  })

  it("drops invalid tool-result images without stringifying their raw payload", () => {
    expect(fnGetChatMessageParts({
      role: "toolResult",
      toolName: "untrusted_tool",
      content: [
        { type: "image", mimeType: "image/jpeg", data: SYNTHETIC_PNG_BASE64 },
        { type: "image", mimeType: "image/png", data: `A${SYNTHETIC_PNG_BASE64.slice(1)}` },
      ],
    })).toEqual([])
  })

  it("renders unfinished thinking parts as thinking ellipsis", () => {
    expect(fnGetChatMessageParts({
      role: "assistant",
      __omnidrawMessageFinished: false,
      content: [{ type: "thinking", thinking: "", thinkingSignature: "signature" }],
    })).toEqual([{ kind: "text", text: "thinking..." }])
  })

  it("skips finished thinking parts from loaded history", () => {
    expect(fnGetChatMessageParts({
      role: "assistant",
      __omnidrawMessageFinished: true,
      content: [{ type: "thinking", thinking: "", thinkingSignature: "signature" }],
    })).toEqual([])
  })

  it("filters stringified thinking blocks while preserving visible text", () => {
    expect(fnGetChatMessageParts({
      role: "assistant",
      __omnidrawMessageFinished: true,
      content: [
        JSON.stringify({ type: "thinking", thinking: "", thinkingSignature: "signature" }, null, 2),
        "Final answer",
      ].join("\n\n"),
    })).toEqual([{ kind: "text", text: "Final answer" }])
  })
})

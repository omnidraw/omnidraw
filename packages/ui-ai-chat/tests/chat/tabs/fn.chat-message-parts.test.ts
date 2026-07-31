import { describe, expect, it } from "vitest"
import { fnGetChatMessageParts } from "../../../src/chat/components/tabs/fn.chat-message-parts"

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

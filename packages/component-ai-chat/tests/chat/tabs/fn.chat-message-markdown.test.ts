import { describe, expect, it } from "vitest"
import { fnSerializeChatMessagesAsMarkdown } from "../../../src/chat/components/tabs/fn.chat-message-markdown"

describe("fnSerializeChatMessagesAsMarkdown", () => {
  it("serializes visible message parts as markdown sections", () => {
    expect(fnSerializeChatMessagesAsMarkdown([
      {
        role: "user",
        content: [
          { type: "text", text: "Make a dashboard" },
          { type: "image", url: "https://example.com/reference.png", alt: "Reference" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "```md\n# Draft\n\nDone\n```" }],
      },
      {
        role: "toolResult",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
      },
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "hidden" }],
      },
      {
        role: "custom",
        customType: "omnidraw.widgetMentions",
        display: false,
        content: "hidden widget identity",
      },
    ])).toBe([
      "## user",
      "",
      "Make a dashboard",
      "",
      "![Reference](https://example.com/reference.png)",
      "",
      "## assistant",
      "",
      "# Draft",
      "",
      "Done",
      "",
      "## toolResult - bash",
      "",
      "ok",
    ].join("\n"))
  })

  it("replaces embedded and tool-result image data with safe placeholders", () => {
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg=="
    const markdown = fnSerializeChatMessagesAsMarkdown([
      {
        role: "user",
        content: [{ type: "image", url: `data:image/png;base64,${pngBase64}`, alt: "Reference" }],
      },
      {
        role: "toolResult",
        toolName: "od_widget_preview_inspect",
        content: [{ type: "image", mimeType: "image/png", data: pngBase64 }],
      },
    ])

    expect(markdown).toContain("[Image omitted]")
    expect(markdown).toContain("[Tool-result image: image/png, 2x2, 76 bytes]")
    expect(markdown).not.toContain(pngBase64)
    expect(markdown).not.toContain("data:image")
  })
})

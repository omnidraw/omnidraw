import { describe, expect, it } from "vitest"
import { fnSerializeChatMessagesAsMarkdown } from "../../../../src/components/AiWizzard/tabs/fn.chat-message-markdown"

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
})

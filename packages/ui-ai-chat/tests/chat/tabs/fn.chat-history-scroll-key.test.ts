import { describe, expect, it } from "vitest"
import { fnGetChatHistoryScrollKey } from "../../../src/chat/components/tabs/fn.chat-history-scroll-key"

const PNG_SENTINEL = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0k"

describe("fnGetChatHistoryScrollKey", () => {
  it("returns a bounded structural key without image URLs or bytes", () => {
    const history = Array.from({ length: 80 }, (_, index) => ({
      entryId: `entry-${index}`,
      message: {
        role: "toolResult",
        toolName: "od_widget_preview_inspect",
        content: [
          { type: "text", text: `preview ${index}` },
          {
            type: "image",
            mimeType: "image/png",
            data: `${PNG_SENTINEL}${"A".repeat(index)}`,
            src: `data:image/png;base64,${PNG_SENTINEL}`,
            width: 640,
            height: 480,
          },
        ],
      },
    }))

    const key = fnGetChatHistoryScrollKey(history)

    expect(key.length).toBeLessThan(320)
    expect(key).not.toContain(PNG_SENTINEL)
    expect(key).not.toContain("data:image")
  })

  it("tracks bounded text changes but not same-sized image payload contents", () => {
    const createHistory = (text: string, data: string) => [{
      entryId: "entry-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text },
          { type: "image", mimeType: "image/png", data, width: 2, height: 2 },
        ],
      },
    }]

    expect(fnGetChatHistoryScrollKey(createHistory("hello", "AAAA")))
      .not.toBe(fnGetChatHistoryScrollKey(createHistory("world", "AAAA")))
    expect(fnGetChatHistoryScrollKey(createHistory("hello", "AAAA")))
      .toBe(fnGetChatHistoryScrollKey(createHistory("hello", "ZZZZ")))
  })
})

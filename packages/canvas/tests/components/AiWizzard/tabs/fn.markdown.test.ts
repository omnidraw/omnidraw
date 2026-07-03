import { describe, expect, it } from "vitest"
import { fnNormalizeAssistantMarkdown } from "../../../../src/components/AiWizzard/tabs/fn.markdown"

describe("fnNormalizeAssistantMarkdown", () => {
  it("unwraps a full md fence", () => {
    expect(fnNormalizeAssistantMarkdown("```md\n# Title\n\n- one\n```")).toBe("# Title\n\n- one")
  })

  it("unwraps a full markdown fence with wrapper blank lines", () => {
    expect(fnNormalizeAssistantMarkdown("\n\n```markdown\n**Done**\n```\n")).toBe("**Done**")
  })

  it("keeps non-wrapper code fences as markdown content", () => {
    const markdown = "Use this:\n\n```ts\nconst value = 1\n```"

    expect(fnNormalizeAssistantMarkdown(markdown)).toBe(markdown)
  })

  it("keeps non-markdown full fences literal", () => {
    const code = "```ts\nconst value = 1\n```"

    expect(fnNormalizeAssistantMarkdown(code)).toBe(code)
  })

  it("preserves nested code fences inside a markdown wrapper", () => {
    expect(fnNormalizeAssistantMarkdown("````md\n```ts\nconst value = 1\n```\n````")).toBe("```ts\nconst value = 1\n```")
  })
})

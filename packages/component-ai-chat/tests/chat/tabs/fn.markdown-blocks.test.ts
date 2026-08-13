import { describe, expect, it } from "vitest"
import { fnParseMarkdownBlocks, fnParseMarkdownInline } from "../../../src/chat/components/tabs/fn.markdown-blocks"

describe("fnParseMarkdownInline", () => {
  it("parses inline code, strong text, and safe links", () => {
    expect(fnParseMarkdownInline("Use `code`, **bold**, and [docs](https://example.com).")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "code" },
      { kind: "text", text: ", " },
      { kind: "strong", text: "bold" },
      { kind: "text", text: ", and " },
      { kind: "link", text: "docs", href: "https://example.com" },
      { kind: "text", text: "." },
    ])
  })

  it("blocks javascript links", () => {
    expect(fnParseMarkdownInline("[bad](javascript:alert)")).toEqual([
      { kind: "link", text: "bad", href: "#" },
    ])
  })
})

describe("fnParseMarkdownBlocks", () => {
  it("parses headings, paragraphs, lists, blockquotes, and code fences", () => {
    expect(fnParseMarkdownBlocks("# Title\n\nParagraph text\n\n- one\n- two\n\n> quoted\n\n```ts\nconst value = 1\n```")).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "Title" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "Paragraph text" }] },
      {
        kind: "list",
        ordered: false,
        items: [
          [{ kind: "text", text: "one" }],
          [{ kind: "text", text: "two" }],
        ],
      },
      { kind: "blockquote", children: [{ kind: "text", text: "quoted" }] },
      { kind: "code", language: "ts", code: "const value = 1" },
    ])
  })

  it("parses markdown tables with alignment", () => {
    expect(fnParseMarkdownBlocks("| Metric | Current | Target |\n| --- | ---: | :---: |\n| Signups | 1,248 | 1,500 |")).toEqual([
      {
        kind: "table",
        align: ["left", "right", "center"],
        headers: [
          [{ kind: "text", text: "Metric" }],
          [{ kind: "text", text: "Current" }],
          [{ kind: "text", text: "Target" }],
        ],
        rows: [
          [
            [{ kind: "text", text: "Signups" }],
            [{ kind: "text", text: "1,248" }],
            [{ kind: "text", text: "1,500" }],
          ],
        ],
      },
    ])
  })
})

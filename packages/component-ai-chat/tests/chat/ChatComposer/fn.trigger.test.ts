import { describe, expect, it } from "vitest"
import { fnFindPromptTrigger } from "../../../src/chat/components/ChatComposer/fn.trigger"

describe("fnFindPromptTrigger", () => {
  it("finds mention triggers after whitespace", () => {
    expect(fnFindPromptTrigger("Ask @des")).toEqual({
      kind: "mention",
      trigger: "@",
      from: 4,
      to: 8,
      query: "des",
    })
  })

  it("finds slash command triggers at the start of input", () => {
    expect(fnFindPromptTrigger("/wire")).toEqual({
      kind: "command",
      trigger: "/",
      from: 0,
      to: 5,
      query: "wire",
    })
  })

  it("ignores trigger characters inside words", () => {
    expect(fnFindPromptTrigger("mail@team")).toBeUndefined()
  })

  it("closes once query contains whitespace", () => {
    expect(fnFindPromptTrigger("Ask @design team")).toBeUndefined()
  })
})

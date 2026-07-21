import { describe, expect, it } from "vitest"
import {
  fnClampSuggestionIndex,
  fnGetSuggestionMenuMaxHeight,
  fnGetSuggestionPageSize,
  fnGetSuggestionScrollTop,
} from "../../../src/chat/components/ChatComposer/fn.suggestion-navigation"

describe("suggestion navigation", () => {
  it("clamps selection to a retained option", () => {
    expect(fnClampSuggestionIndex(-1, 4)).toBe(0)
    expect(fnClampSuggestionIndex(2, 4)).toBe(2)
    expect(fnClampSuggestionIndex(8, 4)).toBe(3)
    expect(fnClampSuggestionIndex(8, 0)).toBe(0)
  })

  it("counts only fully visible rows for page movement", () => {
    expect(fnGetSuggestionPageSize({
      rows: [
        { top: 0, height: 34 },
        { top: 34, height: 34 },
        { top: 68, height: 34 },
        { top: 102, height: 34 },
      ],
      scrollTop: 17,
      viewportHeight: 85,
    })).toBe(2)
    expect(fnGetSuggestionPageSize({ rows: [], scrollTop: 0, viewportHeight: 0 })).toBe(1)
  })

  it("returns the smallest menu-local scroll adjustment", () => {
    expect(fnGetSuggestionScrollTop({
      currentScrollTop: 34,
      viewportHeight: 102,
      optionTop: 0,
      optionHeight: 34,
    })).toBe(0)
    expect(fnGetSuggestionScrollTop({
      currentScrollTop: 34,
      viewportHeight: 102,
      optionTop: 102,
      optionHeight: 34,
    })).toBe(34)
    expect(fnGetSuggestionScrollTop({
      currentScrollTop: 34,
      viewportHeight: 102,
      optionTop: 136,
      optionHeight: 34,
    })).toBe(68)
  })

  it("bounds menu height to the containing chat surface", () => {
    expect(fnGetSuggestionMenuMaxHeight({
      boundaryTop: 200,
      menuBottom: 350,
      boundaryGap: 8,
      minHeight: 34,
      maxHeight: 240,
    })).toBe(142)
    expect(fnGetSuggestionMenuMaxHeight({
      boundaryTop: 0,
      menuBottom: 600,
      boundaryGap: 8,
      minHeight: 34,
      maxHeight: 240,
    })).toBe(240)
  })
})

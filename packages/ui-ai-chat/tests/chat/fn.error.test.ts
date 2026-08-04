import { describe, expect, it } from "vitest"
import { fnCreateAiChatWidgetError, fnGetAiChatAssistantError, fnGetAiChatErrorMessage } from "../../src/chat/components/fn.error"

describe("AI chat error helpers", () => {
  it("extracts safe presentation fields from a failed Pi assistant message", () => {
    expect(fnGetAiChatAssistantError({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "No API key for provider: openai-codex",
      provider: "openai-codex",
      model: "gpt-test",
      diagnostics: [{
        type: "provider-error",
        error: { code: 401, stack: "secret stack", message: "internal" },
        details: { token: "must-not-render" },
      }],
    })).toEqual({
      message: "No API key for provider: openai-codex",
      provider: "openai-codex",
      model: "gpt-test",
      diagnosticCode: "401",
      isAuthenticationError: true,
    })
  })

  it("does not turn normal or aborted assistant messages into failures", () => {
    expect(fnGetAiChatAssistantError({ role: "assistant", stopReason: "stop", errorMessage: "ignored" })).toBeUndefined()
    expect(fnGetAiChatAssistantError({ role: "assistant", stopReason: "aborted", errorMessage: "Canceled" })).toBeUndefined()
    expect(fnGetAiChatAssistantError({ role: "assistant", stopReason: "error", errorMessage: "  " })).toBeUndefined()
  })

  it("normalizes unknown operation errors with a useful fallback", () => {
    expect(fnGetAiChatErrorMessage({ message: "  socket closed  " }, "Fallback")).toBe("socket closed")
    expect(fnCreateAiChatWidgetError("stream", {})).toEqual({
      kind: "stream",
      title: "Chat updates disconnected",
      message: "The live chat update stream stopped unexpectedly.",
      isAuthenticationError: false,
    })
  })
})

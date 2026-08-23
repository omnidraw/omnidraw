import type { TAiChatAssistantError, TAiChatWidgetError, TAiChatWidgetErrorKind } from "./types"

function fnGetObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function fnGetNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function fnGetDiagnosticCode(diagnostics: unknown): string | undefined {
  if (!Array.isArray(diagnostics)) return undefined

  for (const diagnostic of diagnostics) {
    const error = fnGetObject(fnGetObject(diagnostic)?.error)
    const code = error?.code

    if (typeof code === "string" && code.trim()) return code.trim()
    if (typeof code === "number" && Number.isFinite(code)) return String(code)
  }

  return undefined
}

export function fnIsAiChatAuthenticationError(message: string): boolean {
  return /api[ -]?key|credentials?|authenticat(?:e|ed|ion)|unauthori[sz]ed|access token/i.test(message)
}

export function fnGetAiChatErrorMessage(error: unknown, fallback: string): string {
  const directMessage = fnGetNonEmptyString(error)
  if (directMessage) return directMessage

  const objectMessage = fnGetNonEmptyString(fnGetObject(error)?.message)
  return objectMessage ?? fallback
}

export function fnCreateAiChatWidgetError(kind: TAiChatWidgetErrorKind, error: unknown): TAiChatWidgetError {
  const details = {
    connection: ["Could not connect to AI chat", "The chat session could not be opened."],
    stream: ["Chat updates disconnected", "The live chat update stream stopped unexpectedly."],
    prompt: ["Could not send message", "The message was not accepted by the AI service."],
    cancel: ["Could not stop response", "The stop request could not be completed."],
    attachment: ["Could not attach image", "The selected image could not be prepared for the message."],
    approval: ["Could not load approvals", "Pending approval requests could not be loaded."],
  } satisfies Record<TAiChatWidgetErrorKind, readonly [string, string]>
  const [title, fallback] = details[kind]
  const message = fnGetAiChatErrorMessage(error, fallback)

  return {
    kind,
    title,
    message,
    isAuthenticationError: fnIsAiChatAuthenticationError(message),
  }
}

export function fnGetAiChatAssistantError(message: unknown): TAiChatAssistantError | undefined {
  const object = fnGetObject(message)
  const errorMessage = fnGetNonEmptyString(object?.errorMessage)

  if (object?.role !== "assistant" || object.stopReason !== "error" || !errorMessage) {
    return undefined
  }

  return {
    message: errorMessage,
    provider: fnGetNonEmptyString(object.provider),
    model: fnGetNonEmptyString(object.model),
    diagnosticCode: fnGetDiagnosticCode(object.diagnostics),
    isAuthenticationError: fnIsAiChatAuthenticationError(errorMessage),
  }
}

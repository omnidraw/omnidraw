export type TPromptTriggerKind = "mention" | "command"

export type TPromptTrigger = {
  kind: TPromptTriggerKind
  trigger: "@" | "/"
  from: number
  to: number
  query: string
}

const TRIGGER_CHARS = new Set(["@", "/"])

function fnIsBoundary(value: string) {
  return value.trim() === ""
}

function fnIsInvalidQuery(value: string) {
  return value.includes("\n") || value.includes("\r")
}

export function fnFindPromptTrigger(textBeforeCursor: string): TPromptTrigger | undefined {
  for (let index = textBeforeCursor.length - 1; index >= 0; index -= 1) {
    const char = textBeforeCursor[index]

    if (TRIGGER_CHARS.has(char)) {
      const before = textBeforeCursor[index - 1]
      const query = textBeforeCursor.slice(index + 1)

      if (before !== undefined && !fnIsBoundary(before)) {
        return undefined
      }

      if (fnIsInvalidQuery(query) || query.includes(" ")) {
        return undefined
      }

      return {
        kind: char === "@" ? "mention" : "command",
        trigger: char === "@" ? "@" : "/",
        from: index,
        to: textBeforeCursor.length,
        query,
      }
    }

    if (fnIsBoundary(char)) {
      return undefined
    }
  }

  return undefined
}

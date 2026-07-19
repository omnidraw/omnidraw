function fnGetObject(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return undefined
  }

  return value as Record<string, unknown>
}

function fnGetString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function fnGetChatMessageRole(message: unknown) {
  const object = fnGetObject(message)

  if (!object || !("role" in object)) {
    return "message"
  }

  return fnGetString(object.role) ?? "message"
}

export function fnIsChatMessageVisible(message: unknown) {
  const object = fnGetObject(message)
  return fnGetChatMessageRole(message) !== "custom" || object?.display !== false
}

export function fnGetChatMessageLabel(message: unknown) {
  const role = fnGetChatMessageRole(message)
  const object = fnGetObject(message)
  const toolName = object ? fnGetString(object.toolName) : undefined

  if (role === "toolResult" && toolName) {
    return `${role} - ${toolName}`
  }

  return role
}

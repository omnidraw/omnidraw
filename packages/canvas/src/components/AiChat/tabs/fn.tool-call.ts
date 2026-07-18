export type TChatToolCall = {
  id: string
  name: string
}

export type TChatResourceLink = {
  id: string
  name: string
  kind: "kv" | "secretStore" | "db"
}

export type TChatResourceSummary = TChatResourceLink & {
  status?: string
}

function getObject(value: unknown) {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getResource(value: unknown): TChatResourceLink | undefined {
  const object = getObject(value)
  const id = getString(object?.id)
  const name = getString(object?.name)
  const kind = getString(object?.kind)

  if (!id || !name || (kind !== "kv" && kind !== "secretStore" && kind !== "db")) {
    return undefined
  }

  return { id, name, kind }
}

export function fnGetChatToolCalls(message: unknown): TChatToolCall[] {
  const object = getObject(message)
  if (object?.role !== "assistant" || !Array.isArray(object.content)) return []

  return object.content.flatMap((part) => {
    const value = getObject(part)
    const type = getString(value?.type)?.toLowerCase()
    const id = getString(value?.id) ?? getString(value?.toolCallId)
    const name = getString(value?.name) ?? getString(value?.toolName)
    const isToolCall = type === "toolcall" || type === "tool-call" || type === "tool_call"

    return isToolCall && id && name ? [{ id, name }] : []
  })
}

export function fnGetToolResultResource(message: unknown): TChatResourceLink | undefined {
  const object = getObject(message)
  if (object?.role !== "toolResult" || object.isError === true) return undefined
  return getResource(getObject(object.details)?.resource)
}

export function fnGetApprovalResourceId(details: unknown): string | undefined {
  return getString(getObject(getObject(details)?.resource)?.id)
}

export function fnFindApprovalResourceId(
  details: unknown,
  resources: readonly TChatResourceSummary[],
): string | undefined {
  const directId = fnGetApprovalResourceId(details)
  if (directId) return directId

  const object = getObject(details)
  const name = getString(object?.name)
  const kind = getString(object?.kind)
  if (!name || !kind) return undefined

  return resources.find((resource) => resource.name === name && resource.kind === kind)?.id
}

export function fnGetToolNameLabel(toolName: string) {
  const label = toolName
    .replace(/^vc_/, "")
    .replaceAll("_", " ")
    .trim()

  return label.length > 0 ? label.charAt(0).toUpperCase() + label.slice(1) : toolName
}

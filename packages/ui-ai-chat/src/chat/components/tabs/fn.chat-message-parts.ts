import { fnValidateBoundedPngBase64 } from "@omnidraw/shared-functions/image/fn.png-base64"

export type TChatMessagePart =
  | {
    kind: "image"
    alt: string
    src: string
    mimeType?: "image/png"
    byteSize?: number
    width?: number
    height?: number
  }
  | { kind: "text"; text: string }

type TChatPartArgs = {
  showThinking: boolean
  toolResult?: { toolName?: string }
}

function fnStringifyUnknown(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  try {
    const json = JSON.stringify(value, null, 2)
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function fnGetObject(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return undefined
  }

  return value as Record<string, unknown>
}

function fnGetString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function fnGetContent(message: unknown) {
  const object = fnGetObject(message)

  if (!object || !("content" in object)) {
    return message
  }

  return object.content
}

function fnIsFinishedMessage(message: unknown) {
  const object = fnGetObject(message)

  if (!object || !("__omnidrawMessageFinished" in object)) {
    return true
  }

  return object.__omnidrawMessageFinished === true
}

function fnGetDataImageSrc(args: { data: unknown; mediaType: unknown }) {
  const data = fnGetString(args.data)
  const mediaType = fnGetString(args.mediaType)

  if (!data || !mediaType) {
    return undefined
  }

  if (data.startsWith("data:")) {
    return data
  }

  return `data:${mediaType};base64,${data}`
}

function fnIsToolResultImageCandidate(part: Record<string, unknown>) {
  const type = fnGetString(part.type)?.toLowerCase()
  const mimeType = fnGetString(part.mimeType)
    ?? fnGetString(part.mime_type)
    ?? fnGetString(part.media_type)

  return type?.includes("image") === true || mimeType?.startsWith("image/") === true
}

function fnGetToolResultImagePart(
  part: Record<string, unknown>,
  args: TChatPartArgs,
): Extract<TChatMessagePart, { kind: "image" }> | undefined {
  if (fnGetString(part.type)?.toLowerCase() !== "image") {
    return undefined
  }

  const validation = fnValidateBoundedPngBase64({
    mimeType: part.mimeType,
    data: part.data,
  })
  if (!validation.ok) {
    return undefined
  }

  const toolName = args.toolResult?.toolName
  return {
    kind: "image",
    src: `data:image/png;base64,${part.data as string}`,
    alt: toolName ? `Image result from ${toolName}` : "Image tool result",
    ...validation.metadata,
  }
}

function fnGetImageSrc(part: Record<string, unknown>) {
  const directUrl = fnGetString(part.url)
    ?? fnGetString(part.src)
    ?? fnGetString(part.imageUrl)
    ?? fnGetString(part.image_url)
    ?? fnGetString(part.dataUrl)

  if (directUrl) {
    return directUrl
  }

  const imageUrl = fnGetObject(part.image_url)
  const imageUrlValue = imageUrl ? fnGetString(imageUrl.url) : undefined

  if (imageUrlValue) {
    return imageUrlValue
  }

  const source = fnGetObject(part.source)
  const sourceUrl = source ? fnGetString(source.url) : undefined

  if (sourceUrl) {
    return sourceUrl
  }

  const sourceData = source
    ? fnGetDataImageSrc({ data: source.data, mediaType: source.media_type ?? source.mime_type })
    : undefined

  if (sourceData) {
    return sourceData
  }

  return fnGetDataImageSrc({ data: part.data ?? part.base64, mediaType: part.media_type ?? part.mime_type ?? part.mimeType })
}

function fnIsThinkingPartType(type: string | undefined) {
  return type === "thinking" || type === "reasoning"
}

function fnIsThinkingPart(part: Record<string, unknown>) {
  return fnIsThinkingPartType(fnGetString(part.type)?.toLowerCase()) || "thinkingSignature" in part
}

function fnIsToolCallPart(part: Record<string, unknown>) {
  const type = fnGetString(part.type)?.toLowerCase()
  return type === "toolcall" || type === "tool-call" || type === "tool_call"
}

function fnIsHiddenStructuredPart(part: Record<string, unknown>) {
  return fnIsThinkingPart(part) || fnIsToolCallPart(part)
}

function fnParseObjectString(value: string) {
  try {
    const parsed = JSON.parse(value)
    return fnGetObject(parsed)
  } catch {
    return undefined
  }
}

function fnGetTextBlocks(value: string) {
  return value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

function fnGetThinkingTextPart(value: string, args?: TChatPartArgs): TChatMessagePart | undefined {
  const blocks = fnGetTextBlocks(value)
  let hasThinkingBlock = false
  const visibleBlocks = blocks.filter((block) => {
    const object = block.startsWith("{") && block.endsWith("}") ? fnParseObjectString(block) : undefined

    if (!object) {
      return true
    }

    if (fnIsThinkingPart(object)) {
      hasThinkingBlock = true
    }

    return !fnIsHiddenStructuredPart(object)
  })

  if (visibleBlocks.length === blocks.length) {
    return { kind: "text", text: value }
  }

  if (args?.showThinking && hasThinkingBlock && visibleBlocks.length === 0) {
    return { kind: "text", text: "thinking..." }
  }

  const text = visibleBlocks.join("\n\n").trim()

  return text.length > 0 ? { kind: "text", text } : undefined
}

function fnGetThinkingPart(part: Record<string, unknown>, args?: TChatPartArgs): TChatMessagePart | undefined {
  if (!fnIsThinkingPart(part)) {
    return undefined
  }

  return args?.showThinking ? { kind: "text", text: "thinking..." } : undefined
}

function fnGetPartFromObject(part: Record<string, unknown>, args?: TChatPartArgs): TChatMessagePart | undefined {
  const thinkingPart = fnGetThinkingPart(part, args)

  if (thinkingPart || fnIsThinkingPart(part)) {
    return thinkingPart
  }

  if (fnIsToolCallPart(part)) {
    return undefined
  }

  const type = fnGetString(part.type)?.toLowerCase()

  if (args?.toolResult && fnIsToolResultImageCandidate(part)) {
    return fnGetToolResultImagePart(part, args)
  }

  const text = fnGetString(part.text)

  if (text !== undefined) {
    return { kind: "text", text }
  }

  if (type?.includes("image")) {
    const src = fnGetImageSrc(part)

    if (src) {
      return {
        kind: "image",
        src,
        alt: fnGetString(part.alt) ?? fnGetString(part.name) ?? "Chat image",
      }
    }
  }

  return undefined
}

function fnGetPart(value: unknown, args?: TChatPartArgs): TChatMessagePart | undefined {
  if (typeof value === "string") {
    return fnGetThinkingTextPart(value, args)
  }

  const object = fnGetObject(value)
  const objectPart = object ? fnGetPartFromObject(object, args) : undefined

  if (objectPart) {
    return objectPart
  }

  if (object && (fnIsHiddenStructuredPart(object)
    || (args?.toolResult && fnIsToolResultImageCandidate(object)))) {
    return undefined
  }

  return { kind: "text", text: fnStringifyUnknown(value) }
}

export function fnGetChatMessageParts(message: unknown): TChatMessagePart[] {
  const content = fnGetContent(message)
  const showThinking = !fnIsFinishedMessage(message)
  const messageObject = fnGetObject(message)
  const role = messageObject ? fnGetString(messageObject.role) : undefined
  const toolResult = role === "toolResult"
    ? { toolName: messageObject ? fnGetString(messageObject.toolName) : undefined }
    : undefined
  const args = { showThinking, toolResult }

  if (Array.isArray(content)) {
    return content.flatMap((part) => fnGetPart(part, args) ?? [])
  }

  const part = fnGetPart(content, args)

  return part ? [part] : []
}

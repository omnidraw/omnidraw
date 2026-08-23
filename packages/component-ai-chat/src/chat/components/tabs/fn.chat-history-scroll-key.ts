import type { TChatHistoryItem } from "./fn.chat-history-edit"

const MAX_KEY_ITEMS = 24
const MAX_KEY_PARTS = 12
const MAX_HASHED_STRING_CODE_UNITS = 96

function fnGetObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function fnMixHash(hash: number, value: number) {
  return ((hash << 5) - hash + value) >>> 0
}

function fnMixStringSample(hash: number, value: string) {
  let nextHash = fnMixHash(hash, value.length)

  if (value.length <= MAX_HASHED_STRING_CODE_UNITS) {
    for (let index = 0; index < value.length; index += 1) {
      nextHash = fnMixHash(nextHash, value.charCodeAt(index))
    }
    return nextHash
  }

  const edgeLength = MAX_HASHED_STRING_CODE_UNITS / 2
  for (let index = 0; index < edgeLength; index += 1) {
    nextHash = fnMixHash(nextHash, value.charCodeAt(index))
  }
  for (let index = value.length - edgeLength; index < value.length; index += 1) {
    nextHash = fnMixHash(nextHash, value.charCodeAt(index))
  }

  return nextHash
}

function fnMixOptionalString(hash: number, value: unknown) {
  return typeof value === "string"
    ? fnMixStringSample(fnMixHash(hash, 1), value)
    : fnMixHash(hash, 0)
}

function fnMixStringLength(hash: number, value: unknown) {
  return fnMixHash(hash, typeof value === "string" ? value.length + 1 : 0)
}

function fnMixOptionalNumber(hash: number, value: unknown) {
  return fnMixStringSample(hash, typeof value === "number" ? `${value}` : "")
}

function fnIsImagePart(part: Record<string, unknown>, type: string) {
  return type.toLowerCase().includes("image")
    || typeof part.dataUrl === "string"
    || typeof part.imageUrl === "string"
    || fnGetObject(part.image_url) !== undefined
    || fnGetObject(part.source) !== undefined
}

function fnMixImageStructure(hash: number, part: Record<string, unknown>) {
  const imageUrl = fnGetObject(part.image_url)
  const source = fnGetObject(part.source)
  let nextHash = fnMixOptionalString(hash, part.mimeType ?? part.mime_type ?? part.media_type)
  nextHash = fnMixStringLength(nextHash, part.data)
  nextHash = fnMixStringLength(nextHash, part.base64)
  nextHash = fnMixStringLength(nextHash, part.url)
  nextHash = fnMixStringLength(nextHash, part.src)
  nextHash = fnMixStringLength(nextHash, part.dataUrl)
  nextHash = fnMixStringLength(nextHash, part.imageUrl)
  nextHash = fnMixStringLength(nextHash, imageUrl?.url)
  nextHash = fnMixStringLength(nextHash, source?.data)
  nextHash = fnMixStringLength(nextHash, source?.url)
  nextHash = fnMixOptionalNumber(nextHash, part.width)
  nextHash = fnMixOptionalNumber(nextHash, part.height)
  return fnMixOptionalNumber(nextHash, part.byteSize)
}

function fnMixPart(hash: number, part: unknown) {
  if (typeof part === "string") {
    return fnMixStringSample(fnMixHash(hash, 1), part)
  }

  const object = fnGetObject(part)
  if (!object) {
    return fnMixHash(hash, 0)
  }

  const type = typeof object.type === "string" ? object.type : ""
  let nextHash = fnMixOptionalString(fnMixHash(hash, 2), type)

  if (fnIsImagePart(object, type)) {
    return fnMixImageStructure(fnMixHash(nextHash, 3), object)
  }

  nextHash = fnMixOptionalString(nextHash, object.text)
  return fnMixHash(nextHash, object.thinkingSignature === undefined ? 0 : 1)
}

function fnMixContent(hash: number, content: unknown) {
  if (typeof content === "string") {
    return fnMixStringSample(fnMixHash(hash, 1), content)
  }

  if (!Array.isArray(content)) {
    return content === undefined
      ? fnMixHash(hash, 0)
      : fnMixPart(fnMixHash(hash, 2), content)
  }

  let nextHash = fnMixHash(hash, content.length)
  const startIndex = content.length > MAX_KEY_PARTS ? content.length - MAX_KEY_PARTS : 0
  for (let index = startIndex; index < content.length; index += 1) {
    nextHash = fnMixPart(nextHash, content[index])
  }
  return nextHash
}

function fnGetItemFingerprint(item: TChatHistoryItem) {
  let hash = fnMixOptionalString(5381, item.entryId)
  const message = fnGetObject(item.message)

  if (!message) {
    return typeof item.message === "string"
      ? fnMixStringSample(hash, item.message).toString(36)
      : fnMixHash(hash, 0).toString(36)
  }

  hash = fnMixOptionalString(hash, message.role)
  hash = fnMixOptionalString(hash, message.toolName)
  hash = fnMixHash(hash, message.__omnidrawMessageFinished === true ? 1 : 0)
  hash = fnMixOptionalString(hash, message.errorMessage)
  hash = fnMixContent(hash, message.content)
  return hash.toString(36)
}

export function fnGetChatHistoryScrollKey(messageHistory: readonly TChatHistoryItem[]) {
  const startIndex = messageHistory.length > MAX_KEY_ITEMS
    ? messageHistory.length - MAX_KEY_ITEMS
    : 0
  const fingerprints: string[] = []

  for (let index = startIndex; index < messageHistory.length; index += 1) {
    const item = messageHistory[index]
    if (item) {
      fingerprints.push(fnGetItemFingerprint(item))
    }
  }

  return `${messageHistory.length}:${startIndex}:${fingerprints.join(".")}`
}

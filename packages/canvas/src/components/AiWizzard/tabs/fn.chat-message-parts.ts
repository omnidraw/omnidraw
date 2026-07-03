export type TChatMessagePart =
  | { kind: "image"; alt: string; src: string }
  | { kind: "text"; text: string }

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

function fnGetPartFromObject(part: Record<string, unknown>): TChatMessagePart | undefined {
  const text = fnGetString(part.text)

  if (text !== undefined) {
    return { kind: "text", text }
  }

  const type = fnGetString(part.type)?.toLowerCase()

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

function fnGetPart(value: unknown): TChatMessagePart {
  if (typeof value === "string") {
    return { kind: "text", text: value }
  }

  const object = fnGetObject(value)
  const objectPart = object ? fnGetPartFromObject(object) : undefined

  if (objectPart) {
    return objectPart
  }

  return { kind: "text", text: fnStringifyUnknown(value) }
}

export function fnGetChatMessageParts(message: unknown): TChatMessagePart[] {
  const content = fnGetContent(message)

  if (Array.isArray(content)) {
    return content.map((part) => fnGetPart(part))
  }

  return [fnGetPart(content)]
}

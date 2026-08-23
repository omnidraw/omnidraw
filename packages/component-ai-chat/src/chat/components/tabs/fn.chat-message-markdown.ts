import { fnGetChatMessageLabel, fnGetChatMessageRole, fnIsChatMessageVisible } from "./fn.chat-message-label"
import { fnGetChatMessageParts } from "./fn.chat-message-parts"
import { fnNormalizeAssistantMarkdown } from "./fn.markdown"

function fnGetHeadingLabel(label: string) {
  return label
    .replace(/\s+/g, " ")
    .trim()
}

function fnGetTextPartMarkdown(args: { label: string; text: string }) {
  if (args.label === "assistant") {
    return fnNormalizeAssistantMarkdown(args.text)
  }

  return args.text.trim()
}

function fnGetImagePlaceholder(args: {
  byteSize?: number
  height?: number
  mimeType?: "image/png"
  toolResult: boolean
  width?: number
}) {
  const metadata = [
    args.mimeType,
    args.width !== undefined && args.height !== undefined ? `${args.width}x${args.height}` : undefined,
    args.byteSize !== undefined ? `${args.byteSize} bytes` : undefined,
  ].filter((value): value is string => value !== undefined)
  const label = args.toolResult ? "Tool-result image" : "Image omitted"
  return metadata.length > 0 ? `[${label}: ${metadata.join(", ")}]` : `[${label}]`
}

function fnEscapeImageAlt(alt: string) {
  return alt.replace(/[[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim().slice(0, 120) || "Chat image"
}

function fnGetImagePartMarkdown(args: {
  part: Extract<ReturnType<typeof fnGetChatMessageParts>[number], { kind: "image" }>
  toolResult: boolean
}) {
  if (args.toolResult || !/^https?:\/\//i.test(args.part.src.trim())) {
    return fnGetImagePlaceholder({
      byteSize: args.part.byteSize,
      height: args.part.height,
      mimeType: args.part.mimeType,
      toolResult: args.toolResult,
      width: args.part.width,
    })
  }

  return `![${fnEscapeImageAlt(args.part.alt)}](${args.part.src.trim()})`
}

export function fnSerializeChatMessagesAsMarkdown(messages: readonly unknown[]) {
  return messages
    .flatMap((message) => {
      if (!fnIsChatMessageVisible(message)) return []
      const parts = fnGetChatMessageParts(message)

      if (parts.length === 0) {
        return []
      }

      const label = fnGetHeadingLabel(fnGetChatMessageLabel(message))
      const toolResult = fnGetChatMessageRole(message) === "toolResult"
      const body = parts
        .map((part) => {
          if (part.kind === "image") {
            return fnGetImagePartMarkdown({ part, toolResult })
          }

          return fnGetTextPartMarkdown({ label, text: part.text })
        })
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join("\n\n")

      if (body.length === 0) {
        return []
      }

      return [`## ${label}\n\n${body}`]
    })
    .join("\n\n")
}

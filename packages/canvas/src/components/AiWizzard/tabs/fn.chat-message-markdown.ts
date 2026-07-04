import { fnGetChatMessageLabel } from "./fn.chat-message-label"
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

function fnGetImagePartMarkdown(args: { alt: string; src: string }) {
  return `![${args.alt}](${args.src})`
}

export function fnSerializeChatMessagesAsMarkdown(messages: readonly unknown[]) {
  return messages
    .flatMap((message) => {
      const parts = fnGetChatMessageParts(message)

      if (parts.length === 0) {
        return []
      }

      const label = fnGetHeadingLabel(fnGetChatMessageLabel(message))
      const body = parts
        .map((part) => {
          if (part.kind === "image") {
            return fnGetImagePartMarkdown(part)
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

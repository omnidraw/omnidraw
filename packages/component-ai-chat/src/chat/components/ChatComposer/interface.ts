import type { TAiChatToolIcon } from "../../../contracts.js"

export type TChatComposerMentionTarget =
  | { type: "resource"; resourceId: string }
  | { type: "widget"; name: string; source: "draft" | "published" }

export type TChatComposerMentionIcon =
  | { type: "resource"; kind: "kv" | "secretStore" | "db" }
  | { type: "widget"; icon: TAiChatToolIcon | null }

export type TChatComposerMention = {
  id: string
  label: string
  kind: string
  target?: TChatComposerMentionTarget
  icon?: TChatComposerMentionIcon
}

export type TChatComposerCommand = {
  id: string
  label: string
  description: string
}

export type TChatComposerImage = {
  id: string
  file: File
  previewUrl: string
}

export type TChatPromptImage = {
  name?: string
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  data: string
}

export type TChatComposerModel = {
  id: string
  input: readonly ("text" | "image")[]
  provider: string
  name: string
}

export type TChatComposerThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"

export type TChatComposerSubmit = {
  text: string
  mentions: TChatComposerMention[]
  command?: TChatComposerCommand
  images: TChatComposerImage[]
  model?: TChatComposerModel
  thinkingLevel: TChatComposerThinkingLevel
}

export type TChatComposerPreferenceChange = {
  model?: {
    provider: string
    modelId: string
  }
  thinkingLevel?: TChatComposerThinkingLevel
}

export type TChatComposerProps = {
  browser: TAiChatBrowserPort
  placeholder?: string
  mentions?: readonly TChatComposerMention[]
  commands?: readonly TChatComposerCommand[]
  models?: readonly TChatComposerModel[]
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  isRunning?: boolean
  isCanceling?: boolean
  isBusy?: boolean
  draftText?: string
  onDraftTextChange?: (text: string) => void
  onPreferenceChange?: (preference: TChatComposerPreferenceChange) => void
  onResolvedPreferenceChange?: (preference: TChatComposerPreferenceChange) => void
  onSubmit?: (value: TChatComposerSubmit) => void
  onCancel?: () => void
  onNewChat?: () => void
  onCopyChat?: () => void
}

export type TPromptSuggestionKind = "mention" | "command"

export type TPromptSuggestion = {
  kind: TPromptSuggestionKind
  from: number
  to: number
  query: string
}
import type { TAiChatBrowserPort } from "../../../ports"

export type TChatComposerMention = {
  id: string
  label: string
  kind: string
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
  input: ("text" | "image")[]
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

export type TChatComposerProps = {
  placeholder?: string
  mentions?: TChatComposerMention[]
  commands?: TChatComposerCommand[]
  models?: TChatComposerModel[]
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  isRunning?: boolean
  isCanceling?: boolean
  draftText?: string
  onDraftTextChange?: (text: string) => void
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

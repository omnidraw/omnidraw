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

export type TChatComposerModel = {
  id: string
  input: ("text" | "image")[]
  provider: string
  name: string
}

export type TChatComposerSubmit = {
  text: string
  mentions: TChatComposerMention[]
  command?: TChatComposerCommand
  images: TChatComposerImage[]
  model?: TChatComposerModel
}

export type TChatComposerProps = {
  placeholder?: string
  mentions?: TChatComposerMention[]
  commands?: TChatComposerCommand[]
  models?: TChatComposerModel[]
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: string
  onSubmit?: (value: TChatComposerSubmit) => void
}

export type TPromptSuggestionKind = "mention" | "command"

export type TPromptSuggestion = {
  kind: TPromptSuggestionKind
  from: number
  to: number
  query: string
}

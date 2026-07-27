function fnNormalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function fnTrimOuterBlankLines(value: string) {
  const lines = fnNormalizeLineEndings(value).split("\n")

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift()
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop()
  }

  return lines.join("\n")
}

function fnGetMarkdownFenceOpening(line: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*(md|markdown)[ \t]*$/i)

  if (!match) {
    return undefined
  }

  return {
    marker: match[1][0],
    length: match[1].length,
  }
}

function fnIsFenceClosing(line: string, opening: { marker: string; length: number }) {
  const trimmed = line.trim()

  if (!trimmed.startsWith(opening.marker.repeat(opening.length))) {
    return false
  }

  for (const char of trimmed) {
    if (char !== opening.marker) {
      return false
    }
  }

  return true
}

export function fnNormalizeAssistantMarkdown(value: string) {
  const trimmed = fnTrimOuterBlankLines(value)
  const lines = trimmed.split("\n")

  if (lines.length < 2) {
    return value
  }

  const opening = fnGetMarkdownFenceOpening(lines[0])

  if (!opening || !fnIsFenceClosing(lines[lines.length - 1], opening)) {
    return value
  }

  return lines.slice(1, -1).join("\n")
}

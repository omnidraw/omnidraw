export type TMarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; href: string; text: string }

export type TMarkdownBlock =
  | { kind: "blockquote"; children: TMarkdownInline[] }
  | { kind: "code"; code: string; language?: string }
  | { kind: "heading"; children: TMarkdownInline[]; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "list"; items: TMarkdownInline[][]; ordered: boolean }
  | { kind: "paragraph"; children: TMarkdownInline[] }
  | { align: Array<"center" | "left" | "right">; headers: TMarkdownInline[][]; kind: "table"; rows: TMarkdownInline[][][] }

function fnNormalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function fnIsBlank(line: string) {
  return line.trim() === ""
}

function fnGetFenceOpening(line: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*([^`]*)$/)

  if (!match) {
    return undefined
  }

  return {
    marker: match[1][0],
    length: match[1].length,
    language: match[2].trim() || undefined,
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

function fnIsBlockStart(line: string) {
  return Boolean(
    fnGetFenceOpening(line)
    || line.match(/^#{1,6}[ \t]+/)
    || line.match(/^[ \t]*[-*+][ \t]+/)
    || line.match(/^[ \t]*\d+[.)][ \t]+/)
    || fnIsTableStart(line)
    || line.match(/^[ \t]*>[ \t]?/),
  )
}

function fnSplitTableRow(line: string) {
  const trimmed = line.trim()
  const withoutStart = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const withoutEnd = withoutStart.endsWith("|") ? withoutStart.slice(0, -1) : withoutStart

  return withoutEnd.split("|").map((cell) => cell.trim())
}

function fnGetTableAlignments(line: string) {
  const cells = fnSplitTableRow(line)

  if (cells.length === 0) {
    return undefined
  }

  const alignments: Array<"center" | "left" | "right"> = []

  for (const cell of cells) {
    if (!cell.match(/^:?-{3,}:?$/)) {
      return undefined
    }

    const left = cell.startsWith(":")
    const right = cell.endsWith(":")

    if (left && right) {
      alignments.push("center")
    } else if (right) {
      alignments.push("right")
    } else {
      alignments.push("left")
    }
  }

  return alignments
}

function fnIsTableStart(line: string, nextLine?: string) {
  if (!line.includes("|")) {
    return false
  }

  return nextLine !== undefined && fnGetTableAlignments(nextLine) !== undefined
}

function fnSanitizeMarkdownHref(href: string) {
  const value = href.trim()
  const lowerValue = value.toLowerCase()

  if (
    lowerValue.startsWith("http://")
    || lowerValue.startsWith("https://")
    || lowerValue.startsWith("mailto:")
    || lowerValue.startsWith("/")
    || lowerValue.startsWith("#")
  ) {
    return value
  }

  return "#"
}

function fnPushTextInline(parts: TMarkdownInline[], text: string) {
  if (text.length === 0) {
    return
  }

  const previous = parts[parts.length - 1]

  if (previous?.kind === "text") {
    previous.text += text
    return
  }

  parts.push({ kind: "text", text })
}

export function fnParseMarkdownInline(text: string): TMarkdownInline[] {
  const parts: TMarkdownInline[] = []
  let index = 0

  while (index < text.length) {
    const codeStart = text.indexOf("`", index)
    const linkStart = text.indexOf("[", index)
    const strongStarStart = text.indexOf("**", index)
    const strongUnderscoreStart = text.indexOf("__", index)
    const starts = [codeStart, linkStart, strongStarStart, strongUnderscoreStart]
      .filter((candidate) => candidate >= 0)
      .sort((a, b) => a - b)
    const nextStart = starts[0]

    if (nextStart === undefined) {
      fnPushTextInline(parts, text.slice(index))
      break
    }

    fnPushTextInline(parts, text.slice(index, nextStart))

    if (nextStart === codeStart) {
      const codeEnd = text.indexOf("`", codeStart + 1)

      if (codeEnd < 0) {
        fnPushTextInline(parts, text.slice(codeStart))
        break
      }

      parts.push({ kind: "code", text: text.slice(codeStart + 1, codeEnd) })
      index = codeEnd + 1
      continue
    }

    if (nextStart === linkStart) {
      const labelEnd = text.indexOf("]", linkStart + 1)
      const hrefStart = labelEnd >= 0 ? text.indexOf("(", labelEnd + 1) : -1
      const hrefEnd = hrefStart >= 0 ? text.indexOf(")", hrefStart + 1) : -1

      if (labelEnd < 0 || hrefStart !== labelEnd + 1 || hrefEnd < 0) {
        fnPushTextInline(parts, text.slice(linkStart, linkStart + 1))
        index = linkStart + 1
        continue
      }

      parts.push({
        kind: "link",
        text: text.slice(linkStart + 1, labelEnd),
        href: fnSanitizeMarkdownHref(text.slice(hrefStart + 1, hrefEnd)),
      })
      index = hrefEnd + 1
      continue
    }

    const delimiter = nextStart === strongStarStart ? "**" : "__"
    const strongEnd = text.indexOf(delimiter, nextStart + delimiter.length)

    if (strongEnd < 0) {
      fnPushTextInline(parts, text.slice(nextStart, nextStart + delimiter.length))
      index = nextStart + delimiter.length
      continue
    }

    parts.push({
      kind: "strong",
      text: text.slice(nextStart + delimiter.length, strongEnd),
    })
    index = strongEnd + delimiter.length
  }

  return parts
}

export function fnParseMarkdownBlocks(value: string): TMarkdownBlock[] {
  const lines = fnNormalizeLineEndings(value).split("\n")
  const blocks: TMarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (fnIsBlank(line)) {
      index += 1
      continue
    }

    const fence = fnGetFenceOpening(line)

    if (fence) {
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !fnIsFenceClosing(lines[index], fence)) {
        codeLines.push(lines[index])
        index += 1
      }

      blocks.push({ kind: "code", code: codeLines.join("\n"), language: fence.language })
      index += index < lines.length ? 1 : 0
      continue
    }

    const heading = line.match(/^(#{1,6})[ \t]+(.+)$/)

    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: fnParseMarkdownInline(heading[2]),
      })
      index += 1
      continue
    }

    if (fnIsTableStart(line, lines[index + 1])) {
      const headers = fnSplitTableRow(line).map((cell) => fnParseMarkdownInline(cell))
      const align = fnGetTableAlignments(lines[index + 1]) ?? headers.map(() => "left" as const)
      const rows: TMarkdownInline[][][] = []
      index += 2

      while (index < lines.length && lines[index].includes("|") && !fnIsBlank(lines[index])) {
        rows.push(fnSplitTableRow(lines[index]).map((cell) => fnParseMarkdownInline(cell)))
        index += 1
      }

      blocks.push({ kind: "table", headers, align, rows })
      continue
    }

    const unorderedList = line.match(/^[ \t]*[-*+][ \t]+(.+)$/)
    const orderedList = line.match(/^[ \t]*\d+[.)][ \t]+(.+)$/)

    if (unorderedList || orderedList) {
      const ordered = Boolean(orderedList)
      const items: TMarkdownInline[][] = []

      while (index < lines.length) {
        const item = ordered
          ? lines[index].match(/^[ \t]*\d+[.)][ \t]+(.+)$/)
          : lines[index].match(/^[ \t]*[-*+][ \t]+(.+)$/)

        if (!item) {
          break
        }

        items.push(fnParseMarkdownInline(item[1]))
        index += 1
      }

      blocks.push({ kind: "list", ordered, items })
      continue
    }

    const blockquote = line.match(/^[ \t]*>[ \t]?(.*)$/)

    if (blockquote) {
      const quoteLines: string[] = []

      while (index < lines.length) {
        const quote = lines[index].match(/^[ \t]*>[ \t]?(.*)$/)

        if (!quote) {
          break
        }

        quoteLines.push(quote[1])
        index += 1
      }

      blocks.push({ kind: "blockquote", children: fnParseMarkdownInline(quoteLines.join(" ")) })
      continue
    }

    const paragraphLines: string[] = []

    while (index < lines.length && !fnIsBlank(lines[index]) && (paragraphLines.length === 0 || !fnIsBlockStart(lines[index]))) {
      paragraphLines.push(lines[index])
      index += 1
    }

    blocks.push({ kind: "paragraph", children: fnParseMarkdownInline(paragraphLines.join(" ")) })
  }

  return blocks
}

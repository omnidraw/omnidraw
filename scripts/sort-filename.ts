#!/usr/bin/env bun

/**
 * @file Sorts legacy FILES.md filepath table rows by path.
 */

const FILES_PATH = new URL("../FILES.md", import.meta.url)

function sortTableRows(tableRows: string[]): string[] {
  return [...tableRows].sort((left, right) => {
    const leftPath = getFilepathValue(left)
    const rightPath = getFilepathValue(right)
    return leftPath.localeCompare(rightPath)
  })
}

function getFilepathValue(row: string): string {
  const cells = row.split("|").map((cell) => cell.trim())
  return cells[2]?.replace(/^`|`$/g, "") ?? ""
}

function isTableRow(line: string): boolean {
  return line.startsWith("| ")
}

function isTableHeader(line: string): boolean {
  return line === "| status | filepath | human comment | oneliner when to use |"
}

function isTableDivider(line: string): boolean {
  return line === "|---|---|---|---|"
}

function isFileRow(line: string): boolean {
  return isTableRow(line) && !isTableHeader(line) && !isTableDivider(line)
}

function sortFilesMarkdownTables(markdown: string): string {
  const lines = markdown.split("\n")
  const nextLines: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    nextLines.push(line)

    if (!isTableHeader(line)) {
      continue
    }

    const divider = lines[index + 1]
    if (divider !== undefined) {
      nextLines.push(divider)
      index += 1
    }

    const tableRows: string[] = []

    while (isFileRow(lines[index + 1] ?? "")) {
      index += 1
      tableRows.push(lines[index])
    }

    nextLines.push(...sortTableRows(tableRows))
  }

  return `${nextLines.join("\n")}\n`
}

const input = await Bun.file(FILES_PATH).text()
const output = sortFilesMarkdownTables(input)

if (output !== input) {
  await Bun.write(FILES_PATH, output)
}

import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { formatLintReport, lintFunctionalCorePaths, parseArgs } from "../functional-core-lint"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })))
})

async function createTempRoot(): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "functional-core-lint-"))
  tempDirs.push(tempDir)
  return tempDir
}

describe("functional-core-lint", () => {
  test("parses --help", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "help", subpaths: [] })
  })

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument: --wat")
  })

  test("lints fn/fx/tx files and ignores node_modules", async () => {
    const rootDir = await createTempRoot()
    await mkdir(path.join(rootDir, "src"), { recursive: true })
    await mkdir(path.join(rootDir, "node_modules/pkg"), { recursive: true })

    await Bun.write(
      path.join(rootDir, "src/fn.bad.ts"),
      [
        "export const wrong = 1",
        "",
      ].join("\n"),
    )

    await Bun.write(
      path.join(rootDir, "src/tx.good.ts"),
      [
        "export type TPortalThing = {}",
        "export type TArgsThing = {}",
        "",
        "export function txDoThing(portal: TPortalThing, args: TArgsThing) {",
        "  return portal",
        "}",
        "",
      ].join("\n"),
    )

    await Bun.write(
      path.join(rootDir, "node_modules/pkg/fx.bad.ts"),
      [
        "export const bad = 1",
        "",
      ].join("\n"),
    )

    const result = await lintFunctionalCorePaths(rootDir, ["src", "node_modules"])

    expect(result.files).toEqual(["src/fn.bad.ts", "src/tx.good.ts"])
    expect(result.reports).toHaveLength(1)
    expect(result.reports[0]).toEqual({
      path: "src/fn.bad.ts",
      errors: ['line 1: exported value "wrong" not allowed; export functions or types only'],
    })

    const report = formatLintReport(result)
    expect(report).toContain("[RULES OVERVIEW]")
    expect(report).toContain("[src/fn.bad.ts]")
    expect(report).toContain('- line 1: exported value "wrong" not allowed; export functions or types only')
    expect(report).not.toContain("fn.bad.ts: line 1")
    expect(report).not.toContain("node_modules/pkg/fx.bad.ts")
  })

  test("returns ok without rules overview when no violations are found", async () => {
    const rootDir = await createTempRoot()
    await mkdir(path.join(rootDir, "src"), { recursive: true })

    await Bun.write(
      path.join(rootDir, "src/tx.good.ts"),
      [
        "export type TPortalThing = {}",
        "export type TArgsThing = {}",
        "",
        "export function txDoThing(portal: TPortalThing, args: TArgsThing) {",
        "  return portal",
        "}",
        "",
      ].join("\n"),
    )

    const result = await lintFunctionalCorePaths(rootDir, ["src"])
    const report = formatLintReport(result)

    expect(report).toBe("ok")
  })
})

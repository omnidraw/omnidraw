#!/usr/bin/env bun

/**
 * @file Packages current dist artifacts and uploads them to a GitHub release.
 *
 * Default behavior:
 * - Reads dist/release-manifest.json
 * - Creates platform archives in dist/ (*.tar.gz and *.zip)
 * - Copies per-platform checksum files into dist/checksums/*.sha256
 * - Creates release if missing; otherwise uploads assets to existing release
 * - Generates release notes via API and strips author attribution
 */

import path from "path"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs"
import type { TReleaseChannel } from "./release-channel"

type TReleaseManifest = {
  version: string
  channel: TReleaseChannel
  targets: Record<
    string,
    {
      packageName: string
      checksumPath: string
      os: string
      arch: string
    }
  >
}

type TArgs = {
  tag?: string
  notesFile?: string
  failIfExists: boolean
}

type TCmdResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function parseArgs(argv: string[]): TArgs {
  const inlineTag = argv.find((arg) => arg.startsWith("--tag="))?.slice("--tag=".length)
  const tagIndex = argv.indexOf("--tag")
  const flagTag = tagIndex >= 0 ? argv[tagIndex + 1] : undefined

  const inlineNotesFile = argv.find((arg) => arg.startsWith("--notes-file="))?.slice("--notes-file=".length)
  const notesFileIndex = argv.indexOf("--notes-file")
  const flagNotesFile = notesFileIndex >= 0 ? argv[notesFileIndex + 1] : undefined

  return {
    tag: inlineTag ?? flagTag,
    notesFile: inlineNotesFile ?? flagNotesFile,
    failIfExists: argv.includes("--fail-if-exists"),
  }
}

async function runCommand(command: string[], cwd: string): Promise<TCmdResult> {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { exitCode, stdout, stderr }
}

async function assertGhAuth(rootDir: string): Promise<void> {
  const result = await runCommand(["gh", "auth", "status"], rootDir)
  if (result.exitCode !== 0) {
    throw new Error("GitHub CLI is not authenticated. Run `gh auth login` first.")
  }
}

function collectAssetFiles(distDir: string): string[] {
  const entries = readdirSync(distDir)
  const files: string[] = []

  for (const name of entries) {
    if (name.endsWith(".tar.gz") || name.endsWith(".zip")) {
      files.push(path.join(distDir, name))
    }
  }

  const manifestPath = path.join(distDir, "release-manifest.json")
  if (existsSync(manifestPath)) {
    files.push(manifestPath)
  }

  const checksumsDir = path.join(distDir, "checksums")
  if (existsSync(checksumsDir)) {
    for (const name of readdirSync(checksumsDir)) {
      if (name.endsWith(".sha256")) {
        files.push(path.join(checksumsDir, name))
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

function removeOldArchiveAssets(distDir: string): void {
  for (const name of readdirSync(distDir)) {
    if (name.endsWith(".tar.gz") || name.endsWith(".zip")) {
      rmSync(path.join(distDir, name), { force: true })
    }
  }
}

async function packDist(rootDir: string, manifest: TReleaseManifest): Promise<void> {
  const distDir = path.join(rootDir, "dist")

  console.log("[release] Cleaning previous archive assets...")
  removeOldArchiveAssets(distDir)

  for (const target of Object.values(manifest.targets)) {
    const packageDir = path.join(distDir, target.packageName)
    if (!existsSync(packageDir)) {
      throw new Error(`Missing package directory: ${packageDir}`)
    }

    const isWindows = target.os === "win32"

    if (isWindows) {
      const zipName = `${target.packageName}.zip`
      console.log(`[release] Packing ${zipName}`)
      const result = await runCommand(["zip", "-rq", zipName, target.packageName], distDir)
      if (result.exitCode !== 0) {
        throw new Error(`Failed to zip ${target.packageName}: ${result.stderr || result.stdout}`)
      }
    } else {
      const tarName = `${target.packageName}.tar.gz`
      console.log(`[release] Packing ${tarName}`)
      const result = await runCommand(["tar", "-czf", tarName, "-C", `${target.packageName}/bin`, "vibecanvas"], distDir)
      if (result.exitCode !== 0) {
        throw new Error(`Failed to tar ${target.packageName}: ${result.stderr || result.stdout}`)
      }
    }
  }

  const checksumsDir = path.join(distDir, "checksums")
  rmSync(checksumsDir, { recursive: true, force: true })
  mkdirSync(checksumsDir, { recursive: true })

  console.log("[release] Collecting checksum files...")
  for (const target of Object.values(manifest.targets)) {
    const source = path.join(rootDir, target.checksumPath)
    if (!existsSync(source)) {
      throw new Error(`Missing checksum file: ${source}`)
    }
    const destination = path.join(checksumsDir, `${target.packageName}.sha256`)
    cpSync(source, destination)
  }
}

async function releaseExists(rootDir: string, tag: string): Promise<boolean> {
  const result = await runCommand(["gh", "release", "view", tag], rootDir)
  return result.exitCode === 0
}

async function generateReleaseNotes(rootDir: string, tag: string): Promise<string> {
  const args = [
    "gh", "api",
    "repos/{owner}/{repo}/releases/generate-notes",
    "--method", "POST",
    "--field", `tag_name=${tag}`,
    "--jq", ".body",
  ]

  const result = await runCommand(args, rootDir)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to generate release notes: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function readReleaseNotes(notesFile: string): Promise<string> {
  if (!existsSync(notesFile)) {
    throw new Error(`Release notes file not found: ${notesFile}`)
  }

  const notes = await Bun.file(notesFile).text()
  const trimmed = notes.trim()
  if (!trimmed) {
    throw new Error(`Release notes file is empty: ${notesFile}`)
  }

  return trimmed
}

export function stripAuthorAttribution(notes: string): string {
  const lines = notes.split("\n")
  const newContributorsIndex = lines.findIndex((line) =>
    /^##\s+New Contributors/i.test(line),
  )

  const changelogLines =
    newContributorsIndex >= 0 ? lines.slice(0, newContributorsIndex) : lines
  const preservedLines =
    newContributorsIndex >= 0 ? lines.slice(newContributorsIndex) : []

  const cleaned = changelogLines.map((line) =>
    line.replace(/ by @[\w-]+ in (https:\/\/)/g, " in $1"),
  )

  return [...cleaned, ...preservedLines].join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rootDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
  const distDir = path.join(rootDir, "dist")
  const manifestPath = path.join(distDir, "release-manifest.json")

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Run build first.`)
  }

  await assertGhAuth(rootDir)

  const manifest = await Bun.file(manifestPath).json() as TReleaseManifest
  const tag = args.tag ?? `v${manifest.version}`

  console.log(`[release] Preparing assets for ${tag}`)
  await packDist(rootDir, manifest)

  const assets = collectAssetFiles(distDir)
  if (assets.length === 0) {
    throw new Error("No assets found to upload.")
  }

  const exists = await releaseExists(rootDir, tag)

  if (exists) {
    if (args.failIfExists) {
      throw new Error(`Release ${tag} already exists. Refusing to overwrite an existing release.`)
    }

    console.log(`[release] Release ${tag} exists. Uploading assets with --clobber...`)
    const upload = await runCommand(["gh", "release", "upload", tag, ...assets, "--clobber"], rootDir)
    if (upload.exitCode !== 0) {
      throw new Error(`Failed to upload assets: ${upload.stderr || upload.stdout}`)
    }
  } else {
    const cleanedNotes = args.notesFile
      ? await readReleaseNotes(args.notesFile)
      : stripAuthorAttribution(await generateReleaseNotes(rootDir, tag))

    console.log(`[release] Creating release ${tag} and uploading assets...`)
    const createArgs = ["gh", "release", "create", tag, ...assets, "--title", tag, "--notes", cleanedNotes, "--verify-tag"]
    if (manifest.channel !== "stable") {
      createArgs.push("--prerelease")
    }

    const create = await runCommand(createArgs, rootDir)
    if (create.exitCode !== 0) {
      throw new Error(`Failed to create release: ${create.stderr || create.stdout}`)
    }

    if (create.stdout.trim()) {
      console.log(create.stdout.trim())
    }
  }

  const view = await runCommand(["gh", "release", "view", tag, "--json", "url", "--jq", ".url"], rootDir)
  if (view.exitCode === 0 && view.stdout.trim()) {
    console.log(`[release] Done: ${view.stdout.trim()}`)
  } else {
    console.log(`[release] Done: ${tag}`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

#!/usr/bin/env bun

/**
 * @file Publishes built vibecanvas platform packages and the wrapper package to npm.
 *
 * Behavior:
 * - Auth supports either:
 *   - npm trusted publishing in GitHub Actions (OIDC)
 *   - classic `NPM_TOKEN` in env
 * - Uses `bun pm view <name>@<version>` to detect already-published versions.
 * - Packs each package with `npm pack` then publishes tarballs with npm.
 * - For each package, always runs `npm publish --dry-run` before real publish.
 * - Publishes in parallel (configurable with --concurrency).
 * - Safe to retry: already-published versions are skipped.
 *
 * Tag notes:
 * - --tag latest  -> default stable channel used by `npm i vibecanvas`
 * - --tag beta    -> opt-in channel used by `npm i vibecanvas@beta`
 * - --tag nightly -> opt-in channel used by `npm i vibecanvas@nightly`
 * - if --tag is omitted, it is inferred from apps/vibecanvas/package.json version
 *
 * Usage examples:
 * - NPM_TOKEN=xxxx bun run scripts/publish-npm.ts
 * - NPM_TOKEN=xxxx bun run scripts/publish-npm.ts --tag beta --concurrency 6
 * - NPM_TOKEN=xxxx bun run scripts/publish-npm.ts --no-wrapper
 */

import path from "path"
import { unlinkSync } from "fs"
import { inferNpmTagFromVersion, readWrapperVersion } from "./release-channel"

type TReleaseManifest = {
  targets: Record<string, { packageName: string }>
}

type TPackageTask = {
  dir: string
  name: string
  version: string
}

type TPackageResult = {
  task: TPackageTask
  status: "published" | "skipped" | "failed"
  message: string
}

type TArgs = {
  tag: string
  concurrency: number
  includeWrapper: boolean
}

type TCmdResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type TPublishAuthMode = "trusted-publisher" | "token"

function parseArgs(argv: string[]): TArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    if (index < 0) return undefined
    return argv[index + 1]
  }

  const inlineTag = argv.find((arg) => arg.startsWith("--tag="))?.slice("--tag=".length)
  const tag = inlineTag ?? get("--tag")

  const inlineConcurrency = argv.find((arg) => arg.startsWith("--concurrency="))?.slice("--concurrency=".length)
  const concurrencyRaw = inlineConcurrency ?? get("--concurrency") ?? "10"
  const concurrencyNum = Number(concurrencyRaw)

  if (!Number.isInteger(concurrencyNum) || concurrencyNum < 1) {
    throw new Error(`Invalid --concurrency value: ${concurrencyRaw}`)
  }

  const inlineNetworkConcurrency = argv
    .find((arg) => arg.startsWith("--network-concurrency="))
    ?.slice("--network-concurrency=".length)
  const networkConcurrencyRaw = inlineNetworkConcurrency ?? get("--network-concurrency")

  if (networkConcurrencyRaw !== undefined) {
    console.warn("[publish] --network-concurrency is deprecated and ignored")
  }

  return {
    tag: tag ?? "",
    concurrency: concurrencyNum,
    includeWrapper: !argv.includes("--no-wrapper"),
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

function progressBar(done: number, total: number, width = 28): string {
  if (total <= 0) return "[----------------------------]"
  const ratio = Math.max(0, Math.min(1, done / total))
  const filled = Math.round(ratio * width)
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`
}

function shortMessage(result: TPackageResult): string {
  const first = result.message.split("\n")[0]
  return first.length > 120 ? `${first.slice(0, 117)}...` : first
}

function resolvePublishAuthMode(): TPublishAuthMode {
  const token = process.env.NPM_TOKEN?.trim()
  if (token) {
    return "token"
  }

  const hasGithubOidc =
    process.env.GITHUB_ACTIONS === "true" &&
    Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL) &&
    Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)

  if (hasGithubOidc) {
    return "trusted-publisher"
  }

  throw new Error(
    "No npm auth available. Use NPM_TOKEN, or run in GitHub Actions with npm trusted publishing and id-token: write.",
  )
}

async function isPublished(task: TPackageTask, rootDir: string): Promise<boolean> {
  const result = await runCommand(["bun", "pm", "view", `${task.name}@${task.version}`, "version"], rootDir)
  return result.exitCode === 0
}

async function assertNpmPublishAuth(rootDir: string, authMode: TPublishAuthMode): Promise<void> {
  const registry = await runCommand(["npm", "config", "get", "registry"], rootDir)

  if (registry.exitCode === 0) {
    console.log(`[publish] npm registry=${registry.stdout.trim()}`)
  }

  if (authMode === "trusted-publisher") {
    console.log("[publish] using npm trusted publishing (OIDC); skipping npm whoami preflight")
    return
  }

  const whoami = await runCommand(["npm", "whoami"], rootDir)

  if (whoami.exitCode !== 0) {
    const details = (whoami.stderr || whoami.stdout).trim()
    throw new Error(
      [
        `[publish] npm auth preflight failed (mode=${authMode})`,
        "npm whoami failed before publishing.",
        details,
      ].join("\n"),
    )
  }

  console.log(`[publish] npm authenticated as ${whoami.stdout.trim()}`)
}

async function npmPack(task: TPackageTask): Promise<{ tarball: string | null; error: string | null }> {
  const pack = await runCommand(["npm", "pack", "--json"], task.dir)
  if (pack.exitCode !== 0) {
    return {
      tarball: null,
      error: `npm pack failed\n${pack.stderr || pack.stdout}`,
    }
  }

  try {
    const output = JSON.parse(pack.stdout) as Array<{ filename?: string }>
    const filename = output[0]?.filename
    if (!filename) {
      return {
        tarball: null,
        error: `npm pack output missing filename\n${pack.stdout}`,
      }
    }
    return {
      tarball: path.join(task.dir, filename),
      error: null,
    }
  } catch {
    return {
      tarball: null,
      error: `failed parsing npm pack output\n${pack.stdout}`,
    }
  }
}

async function publishOne(task: TPackageTask, args: TArgs, rootDir: string): Promise<TPackageResult> {
  const alreadyPublished = await isPublished(task, rootDir)
  if (alreadyPublished) {
    return {
      task,
      status: "skipped",
      message: "already published",
    }
  }

  const packed = await npmPack(task)
  if (!packed.tarball) {
    return {
      task,
      status: "failed",
      message: packed.error ?? "pack failed",
    }
  }

  try {
    const dryRun = await runCommand(
      ["npm", "publish", packed.tarball, "--access", "public", "--tag", args.tag, "--dry-run"],
      task.dir,
    )
    if (dryRun.exitCode !== 0) {
      return {
        task,
        status: "failed",
        message: `dry-run failed\n${dryRun.stderr || dryRun.stdout}`,
      }
    }

    const publish = await runCommand(
      ["npm", "publish", packed.tarball, "--access", "public", "--tag", args.tag, "--provenance"],
      task.dir,
    )
    if (publish.exitCode !== 0) {
      return {
        task,
        status: "failed",
        message: `publish failed\n${publish.stderr || publish.stdout}`,
      }
    }

    return {
      task,
      status: "published",
      message: "published successfully",
    }
  } finally {
    try {
      unlinkSync(packed.tarball)
    } catch {
      // ignore cleanup errors
    }
  }
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) return
      results[currentIndex] = await worker(items[currentIndex])
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  await Promise.all(workers)
  return results
}

async function loadTasks(rootDir: string, includeWrapper: boolean): Promise<TPackageTask[]> {
  const distDir = path.join(rootDir, "dist")
  const manifestPath = path.join(distDir, "release-manifest.json")
  const manifestFile = Bun.file(manifestPath)

  if (!(await manifestFile.exists())) {
    throw new Error(`Missing release manifest: ${manifestPath}`)
  }

  const manifest = await manifestFile.json() as TReleaseManifest
  const tasks: TPackageTask[] = []

  for (const target of Object.values(manifest.targets)) {
    const dir = path.join(distDir, target.packageName)
    const pkgPath = path.join(dir, "package.json")
    const pkg = await Bun.file(pkgPath).json() as { name: string; version: string }
    tasks.push({ dir, name: pkg.name, version: pkg.version })
  }

  tasks.sort((a, b) => a.name.localeCompare(b.name))

  if (includeWrapper) {
    const wrapperDir = path.join(distDir, "vibecanvas")
    const wrapperPkgPath = path.join(wrapperDir, "package.json")
    const wrapperPkgFile = Bun.file(wrapperPkgPath)

    if (await wrapperPkgFile.exists()) {
      const pkg = await wrapperPkgFile.json() as { name: string; version: string }
      tasks.push({ dir: wrapperDir, name: pkg.name, version: pkg.version })
    }
  }

  return tasks
}

async function main() {
  const rootDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
  const version = await readWrapperVersion(rootDir)
  const parsedArgs = parseArgs(process.argv.slice(2))
  const args: TArgs = {
    ...parsedArgs,
    tag: parsedArgs.tag || inferNpmTagFromVersion(version),
  }

  const authMode = resolvePublishAuthMode()
  console.log(`[publish] auth mode=${authMode}`)
  await assertNpmPublishAuth(rootDir, authMode)

  const tasks = await loadTasks(rootDir, args.includeWrapper)
  if (tasks.length === 0) {
    console.log("[publish] No packages found in dist/")
    return
  }

  console.log(`[publish] Found ${tasks.length} package(s)`)
  console.log(`[publish] tag=${args.tag} concurrency=${args.concurrency}`)
  for (const task of tasks) {
    console.log(`  - ${task.name}@${task.version}`)
  }

  let finished = 0
  const total = tasks.length

  const results = await mapWithConcurrency(tasks, args.concurrency, async (task) => {
    console.log(`\n[publish:start] ${task.name}@${task.version}`)
    const result = await publishOne(task, args, rootDir)
    finished += 1
    console.log(`[publish:done]  ${task.name}@${task.version} -> ${result.status} (${shortMessage(result)})`)
    console.log(`[progress] ${progressBar(finished, total)} ${finished}/${total}`)
    return result
  })

  const published = results.filter((r) => r.status === "published")
  const skipped = results.filter((r) => r.status === "skipped")
  const failed = results.filter((r) => r.status === "failed")

  console.log("\n[publish] Summary")
  console.log(`- published: ${published.length}`)
  console.log(`- skipped: ${skipped.length}`)
  console.log(`- failed: ${failed.length}`)

  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`\n[failed] ${result.task.name}@${result.task.version}`)
      console.error(result.message)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

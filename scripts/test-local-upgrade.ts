#!/usr/bin/env bun
/**
 * @file Builds two signed local binaries and exercises transactional upgrades against a loopback release server.
 *
 * macOS arm64 only. The test never reads or writes the user's real Vibecanvas installation.
 * Pass --keep-temp to retain fixtures for inspection.
 */

import path from "path"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs"
import { createHash } from "crypto"
import { tmpdir } from "os"

const rootDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
const entitlementsPath = path.join(rootDir, "scripts/vibecanvas.entitlements.plist")
const packageName = "vibecanvas-darwin-arm64"
const archiveName = `${packageName}.tar.gz`
const checksumName = `${packageName}.sha256`
const keepTemp = process.argv.includes("--keep-temp")
const testRoot = mkdtempSync(path.join(tmpdir(), "vibecanvas-local-upgrade-"))

type TCommandResult = { exitCode: number; stdout: string; stderr: string }
type TReleaseFixture = { archivePath: string; checksumPath: string }

async function resolveTestVersions(): Promise<{ versionA: string; versionB: string }> {
  const packageJson = await Bun.file(path.join(rootDir, "apps/vibecanvas/package.json")).json() as { version?: string }
  const versionA = packageJson.version
  const match = versionA?.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!versionA || !match) throw new Error(`Expected a stable semantic version in apps/vibecanvas/package.json, received ${versionA ?? "<missing>"}`)
  return { versionA, versionB: `${match[1]}.${match[2]}.${Number(match[3]) + 1}` }
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

async function run(command: string[], options: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<TCommandResult> {
  const proc = Bun.spawn({
    cmd: command,
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timeout = options.timeoutMs
    ? setTimeout(() => { timedOut = true; proc.kill("SIGKILL") }, options.timeoutMs)
    : undefined
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]).finally(() => { if (timeout) clearTimeout(timeout) })
  if (timedOut) throw new Error(`Command timed out: ${command.join(" ")}`)
  return { exitCode, stdout, stderr }
}

async function runChecked(command: string[], options?: Parameters<typeof run>[1]): Promise<TCommandResult> {
  const result = await run(command, options)
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

async function buildVersion(version: string, releaseBase: string, destination: string, reuseAssets: boolean): Promise<void> {
  console.log(`[local-upgrade] Building ${version}...`)
  const args = [process.execPath, "run", "scripts/build.ts", "--single", "--skip-wrapper"]
  if (reuseAssets) args.push("--reuse-assets")
  await runChecked(args, {
    env: {
      VIBECANVAS_BUILD_VERSION: version,
      VIBECANVAS_BUILD_RELEASE_DOWNLOAD_BASE: releaseBase,
    },
    timeoutMs: 10 * 60_000,
  })
  const builtPackage = path.join(rootDir, "dist", packageName)
  if (!existsSync(path.join(builtPackage, "bin/vibecanvas"))) throw new Error(`Build ${version} did not produce ${packageName}`)
  cpSync(builtPackage, destination, { recursive: true })
}

async function packageFixture(packageDir: string, fixtureDir: string, checksumOverride?: string): Promise<TReleaseFixture> {
  mkdirSync(fixtureDir, { recursive: true })
  const archivePath = path.join(fixtureDir, archiveName)
  const checksumPath = path.join(fixtureDir, checksumName)
  await runChecked(["tar", "-czf", archivePath, "-C", packageDir, "bin", "native"])
  const binaryPath = path.join(packageDir, "bin/vibecanvas")
  await Bun.write(checksumPath, `${checksumOverride ?? sha256(binaryPath)}  vibecanvas\n`)
  return { archivePath, checksumPath }
}

async function buildHangingFixture(nativeSource: string, fixtureDir: string): Promise<TReleaseFixture> {
  const packageDir = path.join(testRoot, "hanging-package")
  const sourcePath = path.join(testRoot, "hanging-candidate.ts")
  mkdirSync(path.join(packageDir, "bin"), { recursive: true })
  await Bun.write(sourcePath, "setInterval(() => {}, 1_000); await new Promise(() => {});\n")
  const outputPath = path.join(packageDir, "bin/vibecanvas")
  const result = await Bun.build({ entrypoints: [sourcePath], compile: { target: "bun-darwin-arm64", outfile: outputPath } })
  if (!result.success) throw new Error(`Failed to compile hanging fixture: ${result.logs.join("\n")}`)
  await runChecked(["codesign", "--force", "--options", "runtime", "--entitlements", entitlementsPath, "--sign", "-", outputPath])
  await runChecked(["codesign", "--verify", "--deep", "--strict", "--verbose=4", outputPath])
  cpSync(nativeSource, path.join(packageDir, "native"), { recursive: true })
  return packageFixture(packageDir, fixtureDir)
}

function installVersion(packageDir: string, homeDir: string): { binaryPath: string; nativeDir: string } {
  const binaryPath = path.join(homeDir, ".vibecanvas/bin/vibecanvas")
  const nativeDir = path.join(homeDir, ".vibecanvas/native")
  mkdirSync(path.dirname(binaryPath), { recursive: true })
  rmSync(nativeDir, { recursive: true, force: true })
  copyFileSync(path.join(packageDir, "bin/vibecanvas"), binaryPath)
  chmodSync(binaryPath, 0o755)
  cpSync(path.join(packageDir, "native"), nativeDir, { recursive: true })
  return { binaryPath, nativeDir }
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) throw new Error(`${message}\nExpected: ${expected}\nActual:   ${actual}`)
}

function directoryHashes(directory: string): string[] {
  const results: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else results.push(`${path.relative(directory, absolute)}:${sha256(absolute)}`)
    }
  }
  visit(directory)
  return results.sort()
}

async function main(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The local upgrade integration test currently requires macOS arm64")
  }

  let activeFixture: TReleaseFixture | null = null
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (!activeFixture) return new Response("fixture unavailable", { status: 503 })
      const pathname = new URL(request.url).pathname
      if (pathname.endsWith(`/${archiveName}`)) return new Response(Bun.file(activeFixture.archivePath))
      if (pathname.endsWith(`/${checksumName}`)) return new Response(Bun.file(activeFixture.checksumPath))
      return new Response("not found", { status: 404 })
    },
  })

  try {
    const { versionA, versionB } = await resolveTestVersions()
    const releaseBase = `http://127.0.0.1:${server.port}`
    const packageA = path.join(testRoot, "package-a")
    const packageB = path.join(testRoot, "package-b")
    await buildVersion(versionA, releaseBase, packageA, false)
    await buildVersion(versionB, releaseBase, packageB, true)

    const validFixture = await packageFixture(packageB, path.join(testRoot, "release-valid"))
    const badChecksumFixture = await packageFixture(packageB, path.join(testRoot, "release-bad-checksum"), "0".repeat(64))
    const hangingFixture = await buildHangingFixture(path.join(packageB, "native"), path.join(testRoot, "release-hanging"))

    const homeDir = path.join(testRoot, "home")
    const childEnv = {
      HOME: homeDir,
      VIBECANVAS_HOME: path.join(testRoot, "vibecanvas-home"),
    }

    console.log("[local-upgrade] Scenario 1/3: validated A -> B replacement")
    let installed = installVersion(packageA, homeDir)
    const aHash = sha256(installed.binaryPath)
    activeFixture = validFixture
    const success = await run([installed.binaryPath, "upgrade", "--target-version", versionB], { env: childEnv, timeoutMs: 30_000 })
    if (success.exitCode !== 0) throw new Error(`Successful upgrade exited ${success.exitCode}\n${success.stdout}\n${success.stderr}`)
    assertEqual(sha256(installed.binaryPath), sha256(path.join(packageB, "bin/vibecanvas")), "Installed binary does not match B")
    assertEqual(directoryHashes(installed.nativeDir).join("\n"), directoryHashes(path.join(packageB, "native")).join("\n"), "Installed native addons do not match B")
    const reported = await runChecked([installed.binaryPath, "--version"], { env: childEnv, timeoutMs: 10_000 })
    assertEqual(reported.stdout.trim(), versionB, "Installed binary reports the wrong version")
    if (existsSync(`${installed.binaryPath}.upgrade-backup`) || existsSync(`${installed.binaryPath}.upgrade-new`)) {
      throw new Error("Successful upgrade left binary staging files behind")
    }

    console.log("[local-upgrade] Scenario 2/3: checksum mismatch preserves A")
    installed = installVersion(packageA, homeDir)
    activeFixture = badChecksumFixture
    const checksumFailure = await run([installed.binaryPath, "upgrade", "--target-version", versionB], { env: childEnv, timeoutMs: 30_000 })
    if (!`${checksumFailure.stdout}\n${checksumFailure.stderr}`.includes("Checksum mismatch")) {
      throw new Error(`Checksum failure was not reported\n${checksumFailure.stdout}\n${checksumFailure.stderr}`)
    }
    assertEqual(sha256(installed.binaryPath), aHash, "Checksum failure changed the installed binary")

    console.log("[local-upgrade] Scenario 3/3: hanging candidate preserves A")
    installed = installVersion(packageA, homeDir)
    activeFixture = hangingFixture
    const hangingFailure = await run([installed.binaryPath, "upgrade", "--target-version", versionB], { env: childEnv, timeoutMs: 30_000 })
    if (!`${hangingFailure.stdout}\n${hangingFailure.stderr}`.includes("timed out after 8s")) {
      throw new Error(`Hanging candidate timeout was not reported\n${hangingFailure.stdout}\n${hangingFailure.stderr}`)
    }
    assertEqual(sha256(installed.binaryPath), aHash, "Hanging candidate changed the installed binary")

    console.log(`[local-upgrade] PASS: all scenarios completed in ${testRoot}`)
  } finally {
    server.stop(true)
    if (!keepTemp) rmSync(testRoot, { recursive: true, force: true })
    else console.log(`[local-upgrade] Preserved fixtures: ${testRoot}`)
  }
}

main().catch((error) => {
  console.error(`[local-upgrade] FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  if (!keepTemp) rmSync(testRoot, { recursive: true, force: true })
  process.exit(1)
})

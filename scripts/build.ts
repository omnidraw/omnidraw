#!/usr/bin/env bun
/**
 * @file Builds vibecanvas distribution packages, embedded assets, checksums, and release manifests.
 *
 * Creates standalone executables for supported platforms:
 * - macOS (arm64, x64)
 * - Linux (arm64, x64, musl variants, baseline)
 *
 * Usage:
 *   bun scripts/build.ts              # Build all platforms
 *   bun scripts/build.ts --single     # Build current platform only
 *   bun scripts/build.ts --channel beta
 *   VIBECANVAS_BUILD_VERSION=0.0.1 bun scripts/build.ts --single
 *
 * If --channel is omitted, the channel is inferred from apps/vibecanvas/package.json:
 * - *-beta* -> beta
 * - *-nightly* -> nightly
 * - everything else -> stable
 */

import path from "path"
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "fs"
import { Glob } from "bun"
import { createHash } from "crypto"
import { inferReleaseChannelFromVersion, readWrapperVersion, type TReleaseChannel } from "./release-channel"
import { tmpdir } from "os"
import { createRequire } from "module"

// ============================================================
// Configuration
// ============================================================

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const rootDir = path.join(__dirname, "..")
const cliDir = path.join(rootDir, "apps/cli")
const frontendDir = path.join(rootDir, "apps/frontend")
const sdkDir = path.join(rootDir, "packages/sdk")
const wrapperDir = path.join(rootDir, "apps/vibecanvas")
const wrapperBinPath = path.join(wrapperDir, "bin/vibecanvas")
const serviceDbMigrationsDir = path.join(rootDir, "packages/service-db/src/DbServiceTurso/migration-files")
const forbiddenBinaryMarkers = [
  "wasm_bindgen_output/nodejs/automerge_wasm_bg.wasm",
] as const
const suspiciousBinaryMarkers = ["/home/runner/work/"] as const
const darwinEntitlementsPath = path.join(__dirname, "vibecanvas.entitlements.plist")
const require = createRequire(import.meta.url)

// Platform targets
const targets = [
  { os: "darwin", arch: "arm64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
] as const

type Target = (typeof targets)[number]
type ReleaseManifestTarget = {
  packageName: string
  version: string
  channel: TReleaseChannel
  os: string
  arch: string
  abi: string | null
  baseline: boolean
  binaryPath: string
  checksumPath: string
  checksumSha256: string
}

type TNativeAddonConfig = {
  packageName: string
  fileName: string
}

const tursoNativeAddons = {
  "darwin-arm64": {
    packageName: "@tursodatabase/database-darwin-arm64",
    fileName: "turso.darwin-arm64.node",
  },
  "linux-arm64": {
    packageName: "@tursodatabase/database-linux-arm64-gnu",
    fileName: "turso.linux-arm64-gnu.node",
  },
  "linux-x64": {
    packageName: "@tursodatabase/database-linux-x64-gnu",
    fileName: "turso.linux-x64-gnu.node",
  },
  "win32-x64": {
    packageName: "@tursodatabase/database-win32-x64-msvc",
    fileName: "turso.win32-x64-msvc.node",
  },
} as const satisfies Record<string, TNativeAddonConfig>
const tursoNativeAddonVersion = "0.6.1"

// ============================================================
// Helper Functions
// ============================================================

function buildPackageName(target: Target): string {
  return [
    "vibecanvas",
    target.os,
    target.arch,
    "avx2" in target && !target.avx2 ? "baseline" : undefined,
    "abi" in target ? target.abi : undefined,
  ]
    .filter(Boolean)
    .join("-")
}

function buildBunTarget(target: Target): string {
  return [
    "bun",
    target.os,
    target.arch,
    "avx2" in target && !target.avx2 ? "baseline" : undefined,
    "abi" in target ? target.abi : undefined,
  ]
    .filter(Boolean)
    .join("-")
}

function getTursoNativeAddon(target: Target): TNativeAddonConfig {
  const key = `${target.os}-${target.arch}` as keyof typeof tursoNativeAddons
  const addon = tursoNativeAddons[key]
  if (!addon) {
    throw new Error(`No Turso native addon is available for ${buildPackageName(target)}`)
  }
  return addon
}

function resolveTursoNativeAddonSource(addon: TNativeAddonConfig): string {
  try {
    return Bun.resolveSync(addon.packageName, path.join(rootDir, "package.json"))
  } catch {
    return ""
  }
}

async function fetchTursoNativeAddonSource(addon: TNativeAddonConfig): Promise<{ sourcePath: string; cleanupPath: string }> {
  const cleanupPath = mkdtempSync(path.join(tmpdir(), "vibecanvas-turso-native-"))
  const packResult = await Bun.$`npm pack ${addon.packageName}@${tursoNativeAddonVersion} --json --pack-destination ${cleanupPath}`.quiet()
  if (packResult.exitCode !== 0) {
    rmSync(cleanupPath, { recursive: true, force: true })
    throw new Error(`Failed to fetch ${addon.packageName}@${tursoNativeAddonVersion}: ${packResult.stderr.toString()}`)
  }

  const packEntries = JSON.parse(packResult.stdout.toString()) as Array<{ filename: string }>
  const tarballPath = path.join(cleanupPath, packEntries[0]?.filename ?? "")
  if (!existsSync(tarballPath)) {
    rmSync(cleanupPath, { recursive: true, force: true })
    throw new Error(`npm pack did not create a tarball for ${addon.packageName}`)
  }

  await Bun.$`tar -xzf ${tarballPath} -C ${cleanupPath}`.quiet()
  const sourcePath = path.join(cleanupPath, "package", addon.fileName)
  if (!existsSync(sourcePath)) {
    rmSync(cleanupPath, { recursive: true, force: true })
    throw new Error(`Fetched ${addon.packageName} did not contain ${addon.fileName}`)
  }

  return { sourcePath, cleanupPath }
}

async function copyTursoNativeAddon(target: Target, distDir: string): Promise<string> {
  const addon = getTursoNativeAddon(target)
  let sourcePath = resolveTursoNativeAddonSource(addon)
  let cleanupPath: string | null = null
  if (!sourcePath) {
    const fetched = await fetchTursoNativeAddonSource(addon)
    sourcePath = fetched.sourcePath
    cleanupPath = fetched.cleanupPath
  }

  const nativeDir = path.join(distDir, "native")
  const outputPath = path.join(nativeDir, addon.fileName)

  try {
    await Bun.$`mkdir -p ${nativeDir}`
    copyFileSync(sourcePath, outputPath)
  } finally {
    if (cleanupPath) {
      rmSync(cleanupPath, { recursive: true, force: true })
    }
  }

  return outputPath
}

async function assertTursoNativeEncryptionSupport(nativeAddonPath: string): Promise<void> {
  const nativeAddon = Buffer.from(await Bun.file(nativeAddonPath).arrayBuffer()).toString("latin1")
  if (!nativeAddon.includes("EncryptionCipher") || !nativeAddon.includes("Aegis256")) {
    throw new Error(`Turso native addon does not expose AEGIS-256 encryption support: ${nativeAddonPath}`)
  }
}

function assertHostTursoNativeEncryptionExport(target: string, nativeAddonPath: string): void {
  if (target !== `${process.platform}-${process.arch}`) return
  const nativeBinding = require(nativeAddonPath) as {
    EncryptionCipher?: { Aegis256?: unknown };
  }
  if (nativeBinding.EncryptionCipher?.Aegis256 === undefined) {
    throw new Error(`Host Turso native addon does not export EncryptionCipher.Aegis256: ${nativeAddonPath}`)
  }
}

async function assertAllTursoNativeAddonsSupportEncryption(): Promise<void> {
  for (const [target, addon] of Object.entries(tursoNativeAddons)) {
    let sourcePath = resolveTursoNativeAddonSource(addon)
    let cleanupPath: string | null = null
    if (!sourcePath) {
      const fetched = await fetchTursoNativeAddonSource(addon)
      sourcePath = fetched.sourcePath
      cleanupPath = fetched.cleanupPath
    }
    try {
      await assertTursoNativeEncryptionSupport(sourcePath)
      assertHostTursoNativeEncryptionExport(target, sourcePath)
      console.log(`Verified Turso AEGIS-256 native support for ${target}`)
    } finally {
      const loadedWindowsHostAddon = process.platform === "win32" && target === `${process.platform}-${process.arch}`
      if (cleanupPath && !loadedWindowsHostAddon) rmSync(cleanupPath, { recursive: true, force: true })
    }
  }
}

async function assertHostTursoNativeAddonSupportsEncryption(): Promise<void> {
  const target = `${process.platform}-${process.arch}`
  const expectedTarget = process.env.VIBECANVAS_EXPECTED_NATIVE_TARGET
  if (expectedTarget && target !== expectedTarget) {
    throw new Error(`Native encryption verification expected ${expectedTarget} but is running on ${target}`)
  }
  const addon = tursoNativeAddons[target as keyof typeof tursoNativeAddons]
  if (!addon) throw new Error(`No pinned Turso native addon is configured for host ${target}`)
  let sourcePath = resolveTursoNativeAddonSource(addon)
  let cleanupPath: string | null = null
  if (!sourcePath) {
    const fetched = await fetchTursoNativeAddonSource(addon)
    sourcePath = fetched.sourcePath
    cleanupPath = fetched.cleanupPath
  }
  try {
    await assertTursoNativeEncryptionSupport(sourcePath)
    assertHostTursoNativeEncryptionExport(target, sourcePath)
    console.log(`Dynamically verified Turso EncryptionCipher.Aegis256 for ${target}`)
  } finally {
    // Windows keeps a loaded native module locked until process exit. CI runners
    // discard their temporary workspace after this one-purpose verification.
    if (cleanupPath && process.platform !== "win32") rmSync(cleanupPath, { recursive: true, force: true })
  }
}

function parseChannelArg(argv: string[], fallback: TReleaseChannel): TReleaseChannel {
  const inlineArg = argv.find((arg) => arg.startsWith("--channel="))
  if (inlineArg) {
    const value = inlineArg.slice("--channel=".length)
    if (value === "stable" || value === "beta" || value === "nightly") {
      return value
    }
    console.error(`Invalid --channel value: ${value}`)
    console.error("Allowed values: stable, beta, nightly")
    process.exit(1)
  }

  const channelIdx = argv.indexOf("--channel")
  if (channelIdx >= 0) {
    const value = argv[channelIdx + 1]
    if (value === "stable" || value === "beta" || value === "nightly") {
      return value
    }
    console.error(`Invalid --channel value: ${value ?? "<missing>"}`)
    console.error("Allowed values: stable, beta, nightly")
    process.exit(1)
  }

  return fallback
}

async function writeChecksumFile(binaryPath: string): Promise<{ checksumPath: string; checksumSha256: string }> {
  const buffer = await Bun.file(binaryPath).arrayBuffer()
  const checksumSha256 = createHash("sha256").update(Buffer.from(buffer)).digest("hex")
  const binaryName = path.basename(binaryPath)
  const checksumPath = `${binaryPath}.sha256`
  await Bun.write(checksumPath, `${checksumSha256}  ${binaryName}\n`)
  return { checksumPath, checksumSha256 }
}

async function assertPortableBinary(binaryPath: string): Promise<void> {
  const fileBuffer = await Bun.file(binaryPath).arrayBuffer()
  const binaryText = Buffer.from(fileBuffer).toString("latin1")
  const matchedMarkers = forbiddenBinaryMarkers.filter((marker) => binaryText.includes(marker))
  const matchedSuspiciousMarkers = suspiciousBinaryMarkers.filter((marker) => binaryText.includes(marker))

  if (matchedMarkers.length > 0) {
    throw new Error(
      `Binary portability guard failed for ${binaryPath}. Found forbidden markers: ${matchedMarkers.join(", ")}`,
    )
  }

  if (matchedSuspiciousMarkers.length > 0) {
    console.warn(
      `   ! portability warning: found suspicious markers in ${path.basename(binaryPath)}: ${matchedSuspiciousMarkers.join(", ")}`,
    )
  }
}

async function signAndVerifyDarwinBinary(binaryPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Darwin release binaries must be built and signed on macOS")
  }
  const identity = process.env.VIBECANVAS_CODESIGN_IDENTITY || "-"
  const sign = await Bun.$`codesign --force --options runtime --entitlements ${darwinEntitlementsPath} --sign ${identity} ${binaryPath}`.quiet()
  if (sign.exitCode !== 0) throw new Error(`codesign failed: ${sign.stderr.toString()}`)
  const verify = await Bun.$`codesign --verify --deep --strict --verbose=4 ${binaryPath}`.quiet()
  if (verify.exitCode !== 0) throw new Error(`codesign verification failed: ${verify.stderr.toString()}`)
}

// ============================================================
// SPA Bundling
// ============================================================

async function buildSdkPackage(): Promise<void> {
  console.log("   Running SDK build...")
  const sdkBuild = await Bun.$`bun run --filter @vibecanvas/sdk build`.quiet()
  if (sdkBuild.exitCode !== 0) {
    console.error("SDK build failed:")
    console.error(sdkBuild.stderr.toString())
    console.error(sdkBuild.stdout.toString())
    process.exit(1)
  }

  const widgetBundlePath = path.join(sdkDir, "dist/widget.js")
  if (!existsSync(widgetBundlePath)) {
    throw new Error(`SDK widget bundle not found after build: ${widgetBundlePath}`)
  }
}

async function bundleSpaAssets(): Promise<string[]> {
  const frontendDistDir = path.join(frontendDir, "dist")
  const publicDir = path.join(cliDir, "public")

  // Build frontend using Vite (SolidJS needs Vite's plugin system)
  console.log("   Running frontend build...")
  const viteBuild = await Bun.$`bun run --filter @vibecanvas/frontend build`.quiet()
  if (viteBuild.exitCode !== 0) {
    console.error("Frontend build failed:")
    console.error(viteBuild.stderr.toString())
    process.exit(1)
  }

  // Clean old assets and copy fresh frontend build to public/
  rmSync(path.join(publicDir, "assets"), { recursive: true, force: true })
  await Bun.$`mkdir -p ${publicDir}`
  await Bun.$`cp -r ${frontendDistDir}/* ${publicDir}/`.quiet()

  // Collect bundled files
  const bundledFiles: string[] = []
  const publicGlob = new Glob("**/*")
  for await (const file of publicGlob.scan(publicDir)) {
    const filePath = path.join(publicDir, file)
    const stat = await Bun.file(filePath).stat()
    if (stat.isFile()) {
      bundledFiles.push(file)
      console.log(`   ${file} (${(stat.size / 1024).toFixed(1)} KB)`)
    }
  }

  return bundledFiles
}

async function generateEmbeddedAssets(bundledFiles: string[]): Promise<void> {
  const indexFileIdx = bundledFiles.indexOf("index.html")

  const imports = bundledFiles
    .map((f, i) => `import asset${i} from './public/${f}' with { type: "file" };`)
    .join("\n")

  const embeddedAssetsCode = `// Auto-generated file - do not edit
${imports}

const embeddedAssets = new Map<string, string>([
${bundledFiles
      .map((f, i) => {
        const route = `/${f}`
        if (f === "index.html") {
          return `  ["/", asset${i}],\n  ["${route}", asset${i}],`
        }
        return `  ["${route}", asset${i}],`
      })
      .join("\n")}
]);

const spaFallbackAsset = ${indexFileIdx >= 0 ? `asset${indexFileIdx}` : "null"};

export function getEmbeddedAsset(pathname: string): string | null {
  return embeddedAssets.get(pathname) ?? null;
}

export function getSpaFallbackAsset(): string | null {
  return spaFallbackAsset;
}
`

  await Bun.write(path.join(cliDir, "embedded-assets.ts"), embeddedAssetsCode)
  console.log(`   Generated embedded-assets.ts (${bundledFiles.length} files)`)
}

async function collectMigrationFiles(): Promise<string[]> {
  const migrationFiles: string[] = []
  const migrationGlob = new Glob("**/*")

  for await (const file of migrationGlob.scan(serviceDbMigrationsDir)) {
    const filePath = path.join(serviceDbMigrationsDir, file)
    const stat = await Bun.file(filePath).stat()
    if (stat.isFile() && file.endsWith('.sql')) {
      migrationFiles.push(file)
    }
  }

  migrationFiles.sort()
  return migrationFiles
}

async function generateEmbeddedMigrations(migrationFiles: string[]): Promise<void> {
  const imports = migrationFiles
    .map((f, i) => `import migration${i} from './DbServiceTurso/migration-files/${f}' with { type: "file" };`)
    .join("\n");

  const embeddedMigrationsCode = `// Auto-generated file - do not edit
${imports}

const embeddedMigrationPaths = new Map<string, string>([
${migrationFiles.map((f, i) => `  [${JSON.stringify(f)}, migration${i}],`).join("\n")}
]);

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()];
}

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null;
}
`

  await Bun.write(path.join(rootDir, "packages/service-db/src/_embedded-migrations.ts"), embeddedMigrationsCode)
  console.log(`   Generated embedded-migrations.ts (${migrationFiles.length} files)`)
}

// ============================================================
// Main Build Process
// ============================================================

async function main() {
  if (process.argv.includes("--verify-native-encryption-host-only")) {
    await assertHostTursoNativeAddonSupportsEncryption()
    return
  }
  if (process.argv.includes("--verify-native-encryption-only")) {
    await assertAllTursoNativeAddonsSupportEncryption()
    return
  }

  const automergeResolvedEntrypoint = Bun.resolveSync("@automerge/automerge", path.join(frontendDir, "package.json"))
  const automergeBase64Entrypoint = path.join(path.dirname(automergeResolvedEntrypoint), "fullfat_base64.js")
  if (!existsSync(automergeBase64Entrypoint)) {
    throw new Error(`Automerge base64 entrypoint not found: ${automergeBase64Entrypoint}`)
  }

  // Read release metadata from wrapper package.json
  const wrapperSourcePkg = await Bun.file(path.join(wrapperDir, "package.json")).json() as {
    description?: string
    license?: string
  }
  const version = process.env.VIBECANVAS_BUILD_VERSION || await readWrapperVersion(rootDir)
  const releaseDownloadBase = process.env.VIBECANVAS_BUILD_RELEASE_DOWNLOAD_BASE || "https://github.com/vibecanvas/vibecanvas/releases/download"
  const description = wrapperSourcePkg.description ?? "Vibecanvas binary package"
  const license = wrapperSourcePkg.license ?? "ISC"

  // Parse flags
  const singleFlag = process.argv.includes("--single")
  const platformArg = process.argv.find((arg) => arg.startsWith("--platform="))?.slice("--platform=".length)
  const skipWrapperFlag = process.argv.includes("--skip-wrapper")
  const reuseAssetsFlag = process.argv.includes("--reuse-assets")
  const inferredChannel = inferReleaseChannelFromVersion(version)
  const channel = parseChannelArg(process.argv, inferredChannel)

  process.env.VIBECANVAS_VERSION = version
  process.env.VIBECANVAS_COMPILED = "true"
  process.env.VIBECANVAS_CHANNEL = channel

  // Filter targets
  const filteredTargets = platformArg
    ? targets.filter((target) => target.os === platformArg)
    : singleFlag
    ? targets.filter(
      (t) =>
        t.os === process.platform &&
        t.arch === process.arch &&
        !("avx2" in t && !t.avx2)
    )
    : targets

  if (filteredTargets.length === 0) {
    console.error(`No matching target for ${process.platform}-${process.arch}`)
    process.exit(1)
  }

  console.log(`\nBuilding vibecanvas v${version}`)
  console.log(`Channel: ${channel}`)
  console.log(`Targets: ${filteredTargets.length}\n`)

  // Clean and create dist directory
  await Bun.$`rm -rf ${rootDir}/dist`
  await Bun.$`mkdir -p ${rootDir}/dist`

  // Phase 1: Build SDK package consumed by widget sandbox and bundle SPA assets
  if (reuseAssetsFlag) {
    console.log("[1/4] Reusing previously generated SPA assets and migrations...")
  } else {
    console.log("[1/4] Bundling SPA assets...")
    await buildSdkPackage()
    const bundledFiles = await bundleSpaAssets()

    // Phase 2: Generate embedded assets module
    console.log("\n[2/4] Generating embedded assets...")
    await generateEmbeddedAssets(bundledFiles)

    // Phase 3: Generate embedded migrations module
    console.log("\n[3/4] Generating embedded migrations...")
    const migrationFiles = await collectMigrationFiles()
    await generateEmbeddedMigrations(migrationFiles)
  }

  // Phase 4: Build each target
  console.log("\n[4/4] Compiling executables...")

  const manifestTargets: Record<string, ReleaseManifestTarget> = {}
  const failedTargets: string[] = []
  for (const target of filteredTargets) {
    const name = buildPackageName(target)
    console.log(`   Building ${name}...`)

    const distDir = `${rootDir}/dist/${name}`
    await Bun.$`mkdir -p ${distDir}/bin`

    const bunTarget = buildBunTarget(target)

    try {
      const outputPath = `${distDir}/bin/vibecanvas`

      // Compile cli with Bun using build-time constants via --define
      const result = await Bun.build({
        entrypoints: [`${rootDir}/apps/cli/src/main.ts`],
        compile: {
          target: bunTarget as any,
          outfile: outputPath,
        },
        minify: true,
        define: {
          VIBECANVAS_VERSION: JSON.stringify(version),
          VIBECANVAS_COMPILED: "true",
          VIBECANVAS_CHANNEL: JSON.stringify(channel),
          VIBECANVAS_RELEASE_DOWNLOAD_BASE: JSON.stringify(releaseDownloadBase),
        },
        plugins: [
          {
            name: "alias-automerge-base64-entrypoint",
            setup(build) {
              build.onResolve({ filter: /^@automerge\/automerge$/ }, () => {
                return { path: automergeBase64Entrypoint }
              })
            },
          },
        ],
      })

      if (!result.success) {
        console.error(`   ✗ ${name}:`, result.logs)
        failedTargets.push(name)
        continue
      }

      await assertPortableBinary(outputPath)
      if (target.os === "darwin") await signAndVerifyDarwinBinary(outputPath)
      const nativeAddonPath = await copyTursoNativeAddon(target, distDir)
      await assertTursoNativeEncryptionSupport(nativeAddonPath)

      // Create platform package.json
      await Bun.write(
        `${distDir}/package.json`,
        JSON.stringify(
          {
            name,
            version,
            os: [target.os],
            cpu: [target.arch],
            bin: {
              vibecanvas: "./bin/vibecanvas",
            },
            description: `${description} (${target.os} ${target.arch})`,
            author: "Omar Ezzat",
            repository: {
              type: "git",
              url: "https://github.com/vibecanvas/vibecanvas",
            },
            homepage: "https://vibecanvas.dev",
            license,
          },
          null,
          2
        )
      )

      const { checksumPath, checksumSha256 } = await writeChecksumFile(outputPath)
      manifestTargets[name] = {
        packageName: name,
        version,
        channel,
        os: target.os,
        arch: target.arch,
        abi: "abi" in target ? target.abi : null,
        baseline: "avx2" in target && !target.avx2,
        binaryPath: path.relative(rootDir, outputPath),
        checksumPath: path.relative(rootDir, checksumPath),
        checksumSha256,
      }

      console.log(`   ✓ ${name} (${path.relative(distDir, nativeAddonPath)})`)
    } catch (error) {
      console.error(`   ✗ ${name}:`, error)
      failedTargets.push(name)
    }
  }

  if (failedTargets.length > 0) {
    throw new Error(`Failed to build release target${failedTargets.length === 1 ? "" : "s"}: ${failedTargets.join(", ")}`)
  }

  await Bun.write(
    `${rootDir}/dist/release-manifest.json`,
    JSON.stringify(
      {
        version,
        channel,
        generatedAt: new Date().toISOString(),
        targets: manifestTargets,
      },
      null,
      2
    )
  )
  console.log("   ✓ release-manifest.json")

  // Copy wrapper package to dist
  if (!skipWrapperFlag) {
    console.log(`\nCopying wrapper package...`)
    if (!existsSync(wrapperBinPath)) {
      throw new Error(`Wrapper launcher not found at ${wrapperBinPath}`)
    }

    await Bun.$`cp -r ${wrapperDir} ${rootDir}/dist/vibecanvas`

    // Update version in wrapper package.json
    const wrapperPkgPath = `${rootDir}/dist/vibecanvas/package.json`
    const wrapperPkg = await Bun.file(wrapperPkgPath).json()
    wrapperPkg.version = version

    // Update optionalDependencies versions
    if (wrapperPkg.optionalDependencies) {
      for (const dep of Object.keys(wrapperPkg.optionalDependencies)) {
        wrapperPkg.optionalDependencies[dep] = version
      }
    }

    await Bun.write(wrapperPkgPath, JSON.stringify(wrapperPkg, null, 2))
    chmodSync(path.join(rootDir, "dist/vibecanvas/bin/vibecanvas"), 0o755)
    console.log(`   ✓ vibecanvas (wrapper)`)
  }

  console.log(`\n✓ Build complete! Packages in dist/\n`)
  console.log(`To test locally:`)
  if (singleFlag && filteredTargets.length > 0) {
    const name = buildPackageName(filteredTargets[0])
    console.log(`  ./dist/${name}/bin/vibecanvas`)
  } else {
    console.log(`  ./dist/vibecanvas-darwin-arm64/bin/vibecanvas`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

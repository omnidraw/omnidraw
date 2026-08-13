#!/usr/bin/env bun

import path from "path"
import { mkdirSync, rmSync } from "fs"

const sdkDir = path.join(import.meta.dir, "..")
const distDir = path.join(sdkDir, "dist")
const functionClientSubpathDir = path.join(sdkDir, "function-client")
const serverSubpathDir = path.join(sdkDir, "server")
const widgetSubpathDir = path.join(sdkDir, "widget")
const packageManifest = await Bun.file(path.join(sdkDir, "package.json")).json()

rmSync(distDir, { recursive: true, force: true })
rmSync(functionClientSubpathDir, { recursive: true, force: true })
rmSync(serverSubpathDir, { recursive: true, force: true })
rmSync(widgetSubpathDir, { recursive: true, force: true })

const typescriptPackagePath = Bun.resolveSync("typescript/package.json", path.join(sdkDir, "package.json"))
const tscPath = path.join(path.dirname(typescriptPackagePath), "bin", "tsc")
const tsc = Bun.spawnSync({
  cmd: ["bun", tscPath, "-p", "tsconfig.build.json"],
  cwd: sdkDir,
  stdout: "inherit",
  stderr: "inherit",
})

if (tsc.exitCode !== 0) {
  process.exit(tsc.exitCode)
}

const result = await Bun.build({
  entrypoints: [
    path.join(sdkDir, "src/index.ts"),
    path.join(sdkDir, "src/contract.ts"),
    path.join(sdkDir, "src/manifest.ts"),
    path.join(sdkDir, "src/artifact.ts"),
    path.join(sdkDir, "src/guest.ts"),
    path.join(sdkDir, "src/host.ts"),
    path.join(sdkDir, "src/resource.ts"),
    path.join(sdkDir, "src/function.ts"),
    path.join(sdkDir, "src/state.ts"),
    path.join(sdkDir, "src/tool-icon.ts"),
    path.join(sdkDir, "src/conformance.ts"),
    path.join(sdkDir, "src/widget.ts"),
    path.join(sdkDir, "src/function-client.ts"),
    path.join(sdkDir, "src/server.ts"),
    path.join(sdkDir, "src/fn.portable-build.ts"),
    path.join(sdkDir, "src/fn.offline-check.ts"),
  ],
  target: "browser",
  format: "esm",
  root: path.join(sdkDir, "src"),
  external: [
    "@omnidraw/capsule",
    "@omnidraw/capsule/authoring-inspection",
    "@omnidraw/capsule/guest",
    "@omnidraw/capsule/protocol",
    "@omnidraw/capsule/schema",
    "effect",
    "lucide-static",
  ],
  outdir: distDir,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Internal adapter declarations may name implementation dependencies. They are
// bundled into host.js and are deliberately absent from the published type ABI.
rmSync(path.join(distDir, "internal/capsule"), { recursive: true, force: true })
rmSync(path.join(distDir, "internal/browser-host.d.ts"), { force: true })
rmSync(path.join(distDir, "internal/effect-runtime.d.ts"), { force: true })

const cli = await Bun.build({
  entrypoints: [path.join(sdkDir, "src/cli.mjs")],
  target: "node",
  format: "esm",
  outdir: distDir,
  naming: "cli.js",
  define: {
    __OMNIDRAW_SDK_VERSION__: JSON.stringify(packageManifest.version),
  },
  external: ["effect", "lucide-static"],
})

if (!cli.success) {
  for (const log of cli.logs) console.error(log)
  process.exit(1)
}

async function writeSubpathFallback(subpathDir: string, distName: string) {
  mkdirSync(subpathDir, { recursive: true })
  await Bun.write(path.join(subpathDir, "package.json"), JSON.stringify({
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
  }, null, 2))
  await Bun.write(path.join(subpathDir, "index.js"), `export * from "../dist/${distName}.js";\n`)
  await Bun.write(path.join(subpathDir, "index.d.ts"), `export * from "../dist/${distName}";\n`)
}

await writeSubpathFallback(functionClientSubpathDir, "function-client")
await writeSubpathFallback(serverSubpathDir, "server")
await writeSubpathFallback(widgetSubpathDir, "widget")

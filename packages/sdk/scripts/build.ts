#!/usr/bin/env bun

import path from "path"
import { mkdirSync, rmSync } from "fs"

const sdkDir = path.join(import.meta.dir, "..")
const distDir = path.join(sdkDir, "dist")
const actorSubpathDir = path.join(sdkDir, "actor")
const widgetSubpathDir = path.join(sdkDir, "widget")

rmSync(distDir, { recursive: true, force: true })
rmSync(actorSubpathDir, { recursive: true, force: true })
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
    path.join(sdkDir, "src/widget.ts"),
    path.join(sdkDir, "src/actor.ts"),
  ],
  target: "browser",
  format: "esm",
  external: ["@arrow-js/core"],
  outdir: distDir,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
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

await writeSubpathFallback(actorSubpathDir, "actor")
await writeSubpathFallback(widgetSubpathDir, "widget")

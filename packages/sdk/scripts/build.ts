#!/usr/bin/env bun

import path from "path"
import { rmSync } from "fs"

const sdkDir = path.join(import.meta.dir, "..")
const distDir = path.join(sdkDir, "dist")

rmSync(distDir, { recursive: true, force: true })

const tscPath = Bun.resolveSync("typescript/lib/tsc.js", path.join(sdkDir, "package.json"))
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

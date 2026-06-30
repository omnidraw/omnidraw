import { platform, arch } from "os"
import path from "path"
import { createRequire } from "module"
import { getPathInstallInstruction } from "./install-instructions.mjs"

const require = createRequire(import.meta.url)

const os = platform()
const cpu = arch()

if (os === "win32") {
  console.warn("vibecanvas: Windows builds are not currently published.")
}

const baseName = ["vibecanvas", os, cpu].join("-")

// Try to find the platform binary
const attempts = [baseName, `${baseName}-baseline`, `${baseName}-musl`]

let found = false
for (const pkgName of attempts) {
  try {
    require.resolve(`${pkgName}/package.json`)
    console.log(`vibecanvas: found ${pkgName} binary`)
    found = true
    break
  } catch {
    // Try next
  }
}

if (!found) {
  console.warn(`vibecanvas: no binary for ${os}-${cpu}`)
  console.warn(`vibecanvas: will try fallback at runtime`)
}

function getBunGlobalBinPath() {
  if (process.env.BUN_INSTALL) {
    return path.join(process.env.BUN_INSTALL, "bin")
  }

  if (os === "win32") {
    const homeDir = process.env.USERPROFILE || process.env.HOME || "~"
    return path.join(homeDir, ".bun", "bin")
  }

  const homeDir = process.env.HOME || "~"
  return path.join(homeDir, ".bun", "bin")
}

function isBinPathInPath(binPath) {
  const envPath = process.env.PATH || ""
  const delimiter = os === "win32" ? ";" : ":"
  const normalizedBinPath = path.normalize(binPath)
  const pathEntries = envPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)

  return pathEntries.some((entry) => path.normalize(entry) === normalizedBinPath)
}

const shellPath = process.env.SHELL || process.env.ComSpec || ""
const bunGlobalBinPath = getBunGlobalBinPath()
const installInstruction = getPathInstallInstruction({
  platform: os,
  shellPath,
  binPath: bunGlobalBinPath,
  pathConfigured: isBinPathInPath(bunGlobalBinPath),
})

console.log(installInstruction.message)
if (!installInstruction.message.includes("already contains")) {
  console.log(`vibecanvas: run -> ${installInstruction.command}`)
  console.log(`vibecanvas: ${installInstruction.hint}`)
}

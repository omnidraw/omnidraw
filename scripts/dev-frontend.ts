#!/usr/bin/env bun
/**
 * @file Runs the frontend with live builds for its public UI dependencies.
 */

import path from "node:path"

const rootDir = path.resolve(import.meta.dir, "..")
const bunExec = process.execPath

type TDevProcess = {
  name: string
  process: ReturnType<typeof Bun.spawn>
}

function spawnDevProcess(args: {
  name: string
  cwd: string
  command: string[]
}): TDevProcess {
  console.log(`[dev] ${args.name}: ${args.command.join(" ")}`)
  return {
    name: args.name,
    process: Bun.spawn({
      cmd: args.command,
      cwd: args.cwd,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  }
}

const frontendArgs = process.argv.slice(2)
const processes: TDevProcess[] = []
let stopping = false

async function stopProcesses(exitCode: number): Promise<never> {
  for (const child of processes) {
    child.process.kill("SIGTERM")
  }

  await Promise.race([
    Promise.allSettled(processes.map((child) => child.process.exited)),
    Bun.sleep(2_000),
  ])

  for (const child of processes) {
    if (child.process.exitCode === null) {
      child.process.kill("SIGKILL")
    }
  }

  process.exit(exitCode)
}

async function shutdown(exitCode: number): Promise<void> {
  if (stopping) return
  stopping = true
  await stopProcesses(processes.length === 0 ? 1 : exitCode)
}

process.on("SIGINT", () => {
  void shutdown(130)
})

process.on("SIGTERM", () => {
  void shutdown(143)
})

try {
  processes.push(spawnDevProcess({
    name: "canvas-contract",
    cwd: path.join(rootDir, "packages/canvas-contract"),
    command: [bunExec, "run", "dev"],
  }))
  processes.push(spawnDevProcess({
    name: "theme",
    cwd: path.join(rootDir, "packages/theme"),
    command: [bunExec, "run", "dev"],
  }))
  processes.push(spawnDevProcess({
    name: "canvas-bundle",
    cwd: path.join(rootDir, "packages/canvas"),
    command: [bunExec, "run", "dev:bundle"],
  }))
  processes.push(spawnDevProcess({
    name: "canvas-types",
    cwd: path.join(rootDir, "packages/canvas"),
    command: [bunExec, "run", "dev:types"],
  }))
  processes.push(spawnDevProcess({
    name: "ai-chat-bundle",
    cwd: path.join(rootDir, "packages/component-ai-chat"),
    command: [bunExec, "x", "vite", "build", "--watch", "--mode", "dev-watch"],
  }))
  processes.push(spawnDevProcess({
    name: "ai-chat-types",
    cwd: path.join(rootDir, "packages/component-ai-chat"),
    command: [bunExec, "x", "tsc", "-p", "tsconfig.dev.json", "--watch", "--preserveWatchOutput"],
  }))
  processes.push(spawnDevProcess({
    name: "frontend",
    cwd: path.join(rootDir, "apps/frontend"),
    command: [
      bunExec,
      "run",
      "dev",
      ...(frontendArgs.length > 0 ? ["--", ...frontendArgs] : []),
    ],
  }))

  const firstExit = await Promise.race(
    processes.map(async (child) => ({
      child,
      exitCode: await child.process.exited,
    })),
  )

  if (!stopping) {
    console.error(
      `[dev] ${firstExit.child.name} exited with code ${firstExit.exitCode}`,
    )
    await shutdown(firstExit.exitCode === 0 ? 0 : firstExit.exitCode || 1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await shutdown(1)
}
